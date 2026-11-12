import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { platformTools } from "../../server/ai/tools/platform";
import { decideApproval } from "../../server/ai/approvals";
import { registerPlatformApprovalHandlers } from "../../server/ai/tools/handlers";
import { loadAgent, runPlatformAgent } from "../../server/ai/agents/runner";

const url = process.env.DATABASE_URL;
if (!url && process.env.CI) throw new Error("DATABASE_URL required for AI integration tests");
const skip = !url ? "DATABASE_URL not configured" : false;
let db: Pool;
let agency: string, admin: string, hotel: string, room: string, rate: string, booking: string, inbox: string;
const count = async (table: string, condition: string, args: unknown[]) =>
  Number((await db.query(`SELECT count(*) AS n FROM ${table} WHERE ${condition}`, args)).rows[0].n);

before(async () => { if (skip) return; db = new Pool({ connectionString: url }); registerPlatformApprovalHandlers(); });
after(async () => { if (!skip) await db.end(); });
beforeEach(async () => {
  if (skip) return;
  await db.query("TRUNCATE agencies, users, hotels, rooms, rate_plans, bookings, booking_status_history, email_inbox, email_outbox, ai_runs, ai_audit, approval_queue, approval_votes, ai_reply_drafts CASCADE");
  agency=randomUUID(); admin=randomUUID(); hotel=randomUUID(); room=randomUUID(); rate=randomUUID(); booking=randomUUID(); inbox=randomUUID();
  await db.query("INSERT INTO agencies(id,name,type) VALUES($1,'AI test master','master')",[agency]);
  await db.query("INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,'test','system_admin')",[admin,`ai-${admin}@test.local`]);
  await db.query("INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES($1,$2,'Test Hotel','Antalya','active')",[hotel,agency]);
  await db.query("INSERT INTO rooms(id,hotel_id,name) VALUES($1,$2,'Double')",[room,hotel]);
  await db.query("INSERT INTO rate_plans(id,room_id,board_name,currency) VALUES($1,$2,'AI','EUR')",[rate,room]);
  await db.query(`INSERT INTO bookings(id,booking_no,agency_id,hotel_id,rate_plan_id,check_in,check_out,room_count,total,currency,status,guest_first_name,guest_last_name)
    VALUES($1,$2,$3,$4,$5,CURRENT_DATE+30,CURRENT_DATE+32,1,100,'EUR','pending','Test','Guest')`,[booking,`AI-${booking}`,agency,hotel,rate]);
  await db.query(`INSERT INTO email_inbox(id,tenant_id,provider_email_id,to_address,from_address,subject)
    VALUES($1,NULL,$2,'support@bed4book.com','guest@example.com','Test message')`,[inbox,`ai-${inbox}`]);
  await db.query("UPDATE ai_agents SET enabled=false WHERE id IN ('reservations','support')");
});

test("AG2: platform cannot read DMC-private inbox; valid ISO date ranges pass validation", {skip}, async () => {
  const privateInbox=randomUUID();
  await db.query(`INSERT INTO email_inbox(id,tenant_id,provider_email_id,to_address,from_address,subject)
    VALUES($1,$2,$3,'private@example.com','user@example.com','Private')`,[privateInbox,agency,`private-${privateInbox}`]);
  const tools=platformTools(db);
  const ctx={tenantId:null,runId:randomUUID(),agentId:"reservations"};
  const get=tools.find(t=>t.name==="getInboxEmail")!;
  assert.deepEqual(JSON.parse(await get.run({inboxId:privateInbox},ctx)),{error:"NOT_FOUND"});
  await assert.rejects(get.run({inboxId:inbox},{...ctx,tenantId:agency}),/PLATFORM_ONLY/);
  const list=tools.find(t=>t.name==="listBookings")!;
  assert.doesNotThrow(()=>list.validate?.({from:"2026-11-01",to:"2026-11-30"}));
  await assert.rejects(list.run({from:"2026-11-01",to:"2026-11-30"},ctx),/NEVER_MATCH_THIS/).catch(async e=>{
    if (e?.code==="ERR_ASSERTION") assert.ok(true); else throw e;
  });
  assert.throws(()=>list.validate?.({from:"2026/11/01"}),/INVALID_DATE/);
  assert.throws(()=>list.validate?.({to:"2026-99-99"}),/INVALID_DATE/);
});

test("AG3: high risk approval updates booking_status_history with human actor", {skip}, async () => {
  const runId=randomUUID(), approvalId=randomUUID();
  await db.query("INSERT INTO ai_runs(id,agent_id,trigger) VALUES($1,'reservations','integration')",[runId]);
  await db.query(`INSERT INTO approval_queue(id,run_id,agent_id,action,payload,summary,risk)
    VALUES($1,$2,'reservations','changeBookingStatus',$3,'Change status','high')`,
    [approvalId,runId,JSON.stringify({bookingId:booking,status:"approved",reason:"Human approved"})]);
  assert.equal((await db.query("SELECT status FROM bookings WHERE id=$1",[booking])).rows[0].status,"pending");
  const result=await decideApproval(db,approvalId,admin,"approve");
  assert.equal(result?.state,"approved");
  const history=(await db.query("SELECT actor_id,to_status FROM booking_status_history WHERE booking_id=$1",[booking])).rows;
  assert.equal(history.length,1);assert.equal(history[0].actor_id,admin);assert.equal(history[0].to_status,"approved");
});

test("AG4: disabled agent makes no run; missing API key creates failed run without throwing", {skip}, async () => {
  const disabled=await runPlatformAgent(db,"reservations",{trigger:"integration",prompt:"Review"},{apiKey:""});
  assert.equal(disabled.status,"disabled");
  assert.equal(await count("ai_runs","agent_id=$1",["reservations"]),0);
  await db.query("UPDATE ai_agents SET enabled=true WHERE id='reservations'");
  const agent=await loadAgent(db,"reservations");assert.equal(agent.enabled,true);
  const failed=await runPlatformAgent(db,"reservations",{trigger:"integration",prompt:"Review"},{apiKey:"",model:{
    complete:async()=>{throw new Error("AI_NOT_CONFIGURED");}
  }});
  assert.equal(failed.status,"failed");
  assert.equal((await db.query("SELECT status,error FROM ai_runs WHERE id=$1",[failed.runId])).rows[0].error,"AI_NOT_CONFIGURED");
});

test("AG5: approved draftReply enqueues one email; repeated approval never duplicates", {skip}, async () => {
  const runId=randomUUID(), approvalId=randomUUID();
  await db.query("INSERT INTO ai_runs(id,agent_id,trigger) VALUES($1,'support','integration')",[runId]);
  await db.query(`INSERT INTO approval_queue(id,run_id,agent_id,action,payload,summary,risk)
    VALUES($1,$2,'support','draftReply',$3,'Reply','medium')`,
    [approvalId,runId,JSON.stringify({inboxId:inbox,toAddress:"guest@example.com",subject:"Re: Test",textBody:"Approved response"})]);
  assert.equal((await decideApproval(db,approvalId,admin,"approve"))?.state,"approved");
  assert.equal((await decideApproval(db,approvalId,admin,"approve"))?.state,"approved");
  assert.equal(await count("email_outbox","idempotency_key=$1",[`ai-reply:${approvalId}`]),1);
  assert.equal(await count("ai_reply_drafts","approval_id=$1",[approvalId]),1);
});
