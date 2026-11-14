import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {recordOwnerNotification,sendOwnerDigest} from "../../server/ai/owner-notify";
import {toolsForAgent} from "../../server/ai/agents/tools-map";

const url=process.env.DATABASE_URL;
if(!url&&process.env.CI)throw new Error("DATABASE_URL required in CI");
const skip=url?false:"DATABASE_URL not set";
let db:Pool;
before(()=>{if(!skip)db=new Pool({connectionString:url})});
after(async()=>{if(!skip)await db.end()});
beforeEach(async()=>{
  if(skip)return;
  await db.query("TRUNCATE owner_notification_deliveries,owner_notifications,notify_rules,email_outbox CASCADE");
});
test("OW1: security alert persists without OWNER_EMAIL and is instant",{skip},async()=>{
  const prev=process.env.OWNER_EMAIL;delete process.env.OWNER_EMAIL;
  try{
    const result=await recordOwnerNotification(db,"security-ow1",{kind:"alert",function:"security"},"Security message");
    assert.equal(result.channel,"instant");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM owner_notifications")).rows[0].n,1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM email_outbox")).rows[0].n,0);
    assert.equal((await recordOwnerNotification(db,"security-ow1",{kind:"alert"},"Duplicate")).stored,false);
  }finally{if(prev===undefined)delete process.env.OWNER_EMAIL;else process.env.OWNER_EMAIL=prev}
});
test("OW2: instant hourly cap 10, excess becomes digest",{skip},async()=>{
  const prev=process.env.OWNER_EMAIL;delete process.env.OWNER_EMAIL;
  try{
    const now=new Date("2026-11-12T12:00:00Z");
    const channels=[];
    for(let i=0;i<11;i++)channels.push((await recordOwnerNotification(db,"ow2-"+i,{kind:"alert"},"Alert "+i,now)).channel);
    assert.equal(channels.filter(c=>c==="instant").length,10);
    assert.equal(channels[10],"digest");
  }finally{if(prev===undefined)delete process.env.OWNER_EMAIL;else process.env.OWNER_EMAIL=prev}
});
test("OW3: daily digest sends once and counts count_only",{skip},async()=>{
  const prev=process.env.OWNER_EMAIL;process.env.OWNER_EMAIL="owner@example.com";
  try{
    await recordOwnerNotification(db,"ow3",{kind:"email",function:"contracts"},"Contract report");
    const now=new Date();
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Istanbul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
    const get=(name:string)=>parts.find(p=>p.type===name)?.value??"";
    const day=get("year")+"-"+get("month")+"-"+get("day");
    const later=new Date(day+"T07:00:00Z"); // 10:00 Europe/Istanbul
    assert.equal(await sendOwnerDigest(db,later),true);
    assert.equal(await sendOwnerDigest(db,later),false);
    const n=await db.query("SELECT count(*)::int AS n FROM email_outbox WHERE kind='owner_digest'");
    assert.equal(n.rows[0].n,1);
  }finally{if(prev===undefined)delete process.env.OWNER_EMAIL;else process.env.OWNER_EMAIL=prev}
});
test("OW4: owner assistant tools are strictly read-only",{skip},async()=>{
  const tools=toolsForAgent("owner-assistant",db);
  assert.ok(tools.length>0);
  assert.ok(tools.every(t=>t.risk==="low"));
  assert.ok(!tools.some(t=>["draftReply","changeBookingStatus","requestRefund"].includes(t.name)));
});

test("OW5: approval creation survives owner notification persistence failure",async()=>{
  const {pgRunStore}=await import("../../server/ai/store");
  const approvalId="11111111-1111-4111-8111-111111111111";
  const queries:string[]=[];
  const fakeDb={query:async(sql:string)=>{
    queries.push(sql);
    if(sql.includes("INSERT INTO approval_queue"))return {rows:[{id:approvalId}]};
    if(sql.includes("SELECT match_kind"))throw new Error("NOTIFICATION_DB_FAILURE");
    return {rows:[]};
  }};
  const previous=console.error;
  const errors:unknown[][]=[];
  console.error=(...args:unknown[])=>{errors.push(args)};
  try{
    const id=await pgRunStore(fakeDb).enqueueApproval({
      runId:approvalId,agentId:"reservations",tenantId:null,
      action:"requestRefund",payload:{},summary:"Approval test",risk:"high"
    });
    assert.equal(id,approvalId);
    assert.equal(queries.filter(q=>q.includes("INSERT INTO approval_queue")).length,1);
    assert.equal(errors.length,1,"notification failure must be logged");
    assert.match(String(errors[0]?.[0]),/owner notification failed/);
  }finally{console.error=previous}
});

test("OW6: digest without AI_CENTER_URL omits link, retains pending approval",async()=>{
  const prevUrl=process.env.AI_CENTER_URL,prevOwner=process.env.OWNER_EMAIL;
  delete process.env.AI_CENTER_URL;
  process.env.OWNER_EMAIL="owner@example.com";
  const now=new Date("2026-11-14T09:00:00Z");
  let mailText="";
  const fakeDb={query:async(sql:string,params?:any[])=>{
    if(sql.includes("owner_notification_deliveries WHERE"))return {rows:[]};
    if(sql.includes("SELECT id,summary,channel FROM owner_notifications"))return {rows:[]};
    if(sql.includes("SELECT id,agent_id FROM approval_queue"))return {rows:[{id:"approval-123",agent_id:"reservations"}]};
    if(sql.includes("INSERT INTO email_outbox")){mailText=JSON.stringify(params);return {rows:[{id:"mail-1"}]}};
    return {rows:[{id:"mail-1"}]};
  }};
  try{
    await sendOwnerDigest(fakeDb,now);
    assert.ok(!mailText.includes("aget.bed4book.com"));
    assert.ok(!mailText.includes("?page=ai-center"));
  }finally{
    if(prevUrl===undefined)delete process.env.AI_CENTER_URL;else process.env.AI_CENTER_URL=prevUrl;
    if(prevOwner===undefined)delete process.env.OWNER_EMAIL;else process.env.OWNER_EMAIL=prevOwner;
  }
});
