import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { issueSession } from "../../server/security";
import { registerApprovalHandler } from "../../server/ai/approvals";

const url=process.env.DATABASE_URL;
if(!url&&process.env.CI)throw new Error("DATABASE_URL required in CI");
const skip=url?false:"DATABASE_URL not set";
process.env.SESSION_SECRET=process.env.SESSION_SECRET||"ai-center-integration-secret-32-characters";
let db:Pool, server:any, base:string;
let admin:string,bo:string,dmc:string,sub:string,approval:string;
const req=async (path:string,role:string,method="GET",body?:unknown)=>{
  const r=await fetch(base+path,{method,headers:{"content-type":"application/json","x-requested-with":"bed4book",
    authorization:"Bearer "+role},body:body===undefined?undefined:JSON.stringify(body)});
  const raw=await r.text();return {status:r.status,body:raw?JSON.parse(raw):null};
};
before(async()=>{
  if(skip)return;
  db=new Pool({connectionString:url});
  const {default:app}=await import("../../server/app");
  server=app.listen(0);
  base="http://127.0.0.1:"+server.address().port;
});
after(async()=>{if(skip)return;await new Promise<void>(r=>server.close(()=>r()));await db.end()});
beforeEach(async()=>{
  if(skip)return;
  await db.query("TRUNCATE agencies,users,ai_runs,ai_audit,approval_queue,approval_votes CASCADE");
  const master=randomUUID(), child=randomUUID();admin=randomUUID();bo=randomUUID();dmc=randomUUID();sub=randomUUID();approval=randomUUID();
  await db.query("INSERT INTO agencies(id,name,type) VALUES($1,'Test DMC','master')",[master]);
  await db.query("INSERT INTO agencies(id,name,type,parent_agency_id) VALUES($1,'Test subagency','sub',$2)",[child,master]);
  for(const [id,role,agency] of [[admin,"system_admin",null],[bo,"back_office",null],[dmc,"master_agency",master],[sub,"sub_agency",child]]){
    await db.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES($1,$2,'x',$3,$4)",[id,id+"@test.local",role,agency]);
  }
  const token=(id:string,role:any,agencyId:string|null)=>issueSession({sub:id,role,agencyId,ver:0},process.env.SESSION_SECRET!);
  admin=token(admin,"system_admin",null);bo=token(bo,"back_office",null);
  dmc=token(dmc,"master_agency",master);sub=token(sub,"sub_agency",child);
  await db.query("INSERT INTO approval_queue(id,agent_id,action,payload,summary,risk) VALUES($1,'support','draftReply','{}','Reply draft','medium')",[approval]);
});
test("AP2: back office reads and decides approvals but cannot change agent config; DMC and sub agency see 404",{skip},async()=>{
  assert.equal((await req("/api/ai/agents",bo)).status,200);
  assert.equal((await req("/api/ai/agents",dmc)).status,404);
  assert.equal((await req("/api/ai/agents",sub)).status,404);
  assert.equal((await req("/api/ai/agents/support",bo,"PATCH",{enabled:true})).status,403);
  assert.equal((await req("/api/ai/notify-rules",bo,"POST",{match_kind:"risk",match_value:"high",channel:"instant",position:1,active:true})).status,403);
  const rejected=await req("/api/ai/approvals/"+approval+"/reject",bo,"POST",{note:"back office decision"});
  assert.equal(rejected.status,200);assert.equal(rejected.body.state,"rejected");
  const vote=(await db.query("SELECT count(*)::int AS n FROM approval_votes WHERE approval_id=$1 AND decision='reject'",[approval])).rows[0].n;
  assert.equal(vote,1);
});
test("AP2b: back office approval executes the handler once",{skip},async()=>{
  let executed=0;
  registerApprovalHandler("ap2bOnce",async()=>{executed++;return "executed"});
  await db.query("UPDATE approval_queue SET action='ap2bOnce' WHERE id=$1",[approval]);
  const r=await req("/api/ai/approvals/"+approval+"/approve",bo,"POST",{});
  assert.equal(r.status,200);assert.equal(r.body.state,"approved");assert.equal(executed,1);
});
test("AP3: reject closes pending approval without executing it",{skip},async()=>{
  const r=await req("/api/ai/approvals/"+approval+"/reject",admin,"POST",{note:"Not approved"});
  assert.equal(r.status,200);assert.equal(r.body.state,"rejected");
  const state=(await db.query("SELECT state FROM approval_queue WHERE id=$1",[approval])).rows[0].state;
  assert.equal(state,"rejected");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM ai_runs")).rows[0].n,0);
});
test("AP4: disabling an agent persists and prevents activation",{skip},async()=>{
  const r=await req("/api/ai/agents/support",admin,"PATCH",{enabled:false,daily_token_budget:0});
  assert.equal(r.status,200);assert.equal(r.body.enabled,false);
  const bad=await req("/api/ai/agents/support",admin,"PATCH",{daily_token_budget:5000001});
  assert.equal(bad.status,400);
});
test("AP5: pending approval appears and disappears after approval",{skip},async()=>{
  registerApprovalHandler("ap5Once",async()=> "approved");
  await db.query("UPDATE approval_queue SET action='ap5Once' WHERE id=$1",[approval]);
  const before=await req("/api/ai/approvals?state=pending",admin);
  assert.equal(before.status,200);assert.ok(before.body.items.some((a:any)=>a.id===approval));
  const approved=await req("/api/ai/approvals/"+approval+"/approve",admin,"POST",{});
  assert.equal(approved.status,200);assert.equal(approved.body.state,"approved");
  const after=await req("/api/ai/approvals?state=pending",admin);
  assert.ok(!after.body.items.some((a:any)=>a.id===approval));
});

test("AP1: approved action handler executes exactly once",{skip},async()=>{
  let executed=0;
  registerApprovalHandler("ap1Once",async()=>{executed++;return "executed"});
  await db.query("UPDATE approval_queue SET action='ap1Once' WHERE id=$1",[approval]);
  const first=await req("/api/ai/approvals/"+approval+"/approve",admin,"POST",{});
  const second=await req("/api/ai/approvals/"+approval+"/approve",admin,"POST",{});
  assert.equal(first.status,200);
  assert.equal(second.status,200);
  assert.equal(first.body.state,"approved");
  assert.equal(second.body.state,"approved");
  assert.equal(executed,1);
});

test("AP6 DMC and sub agency get the same 404 as a missing route on every AI Center path",{skip},async()=>{
  const run=(await db.query("INSERT INTO ai_runs(agent_id,trigger,status) VALUES('support','test','done') RETURNING id")).rows[0].id;
  await db.query("UPDATE approval_queue SET run_id=$2 WHERE id=$1",[approval,run]);
  // Reference: what the operator gets for an id that does not exist. A DMC must not be able to tell the difference.
  const missingRef=await req("/api/ai/runs/"+randomUUID(),admin);
  assert.equal(missingRef.status,404);
  const missingBody=missingRef.body;
  const reads=["/api/ai/agents","/api/ai/runs","/api/ai/runs/"+run,"/api/ai/approvals","/api/ai/approvals?state=pending","/api/ai/notify-rules"];
  for(const token of [dmc,sub]){
    for(const path of reads){
      const r=await req(path,token);
      assert.equal(r.status,404,path);assert.deepEqual(r.body,missingBody,path);
    }
    for(const d of ["approve","reject"]){
      const r=await req("/api/ai/approvals/"+approval+"/"+d,token,"POST",{});
      assert.equal(r.status,404,d);assert.deepEqual(r.body,missingBody,d);
    }
    assert.equal((await req("/api/ai/agents/support",token,"PATCH",{enabled:true})).status,404);
  }
  const state=(await db.query("SELECT state FROM approval_queue WHERE id=$1",[approval])).rows[0].state;
  assert.equal(state,"pending","no DMC or sub-agency call may change an approval");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM approval_votes")).rows[0].n,0);
  assert.equal((await req("/api/ai/runs/"+run,admin)).status,200,"the run exists for the operator");
});
test("AP7 two required approvals: the same user voting twice is not enough",{skip},async()=>{
  let executed=0;
  registerApprovalHandler("ap7Twice",async()=>{executed++;return "executed"});
  await db.query("UPDATE approval_queue SET action='ap7Twice',required_approvals=2 WHERE id=$1",[approval]);
  const first=await req("/api/ai/approvals/"+approval+"/approve",admin,"POST",{});
  const again=await req("/api/ai/approvals/"+approval+"/approve",admin,"POST",{});
  assert.equal(first.body.state,"pending");assert.equal(again.body.state,"pending");assert.equal(executed,0);
  const second=await req("/api/ai/approvals/"+approval+"/approve",bo,"POST",{});
  assert.equal(second.status,200);assert.equal(second.body.state,"approved");assert.equal(executed,1);
});
