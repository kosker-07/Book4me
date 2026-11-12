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
