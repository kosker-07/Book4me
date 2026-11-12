import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {queuePlatformInbox,processNextAiJob,renewAiJobLease,failExhaustedAiJobs} from "../../server/ai/jobs";
import type {RunResult} from "../../server/ai/runtime";

const url=process.env.DATABASE_URL;
if(!url&&process.env.CI)throw new Error("DATABASE_URL required in CI");
const skip=url?false:"DATABASE_URL not set";
let db:Pool, platformId:string,tenantId:string,privateId:string;
before(()=>{if(!skip)db=new Pool({connectionString:url})});
after(async()=>{if(!skip)await db.end()});
beforeEach(async()=>{
  if(skip)return;
  await db.query("TRUNCATE ai_jobs, email_inbox, ai_runs, agencies CASCADE");
  platformId=randomUUID();tenantId=randomUUID();privateId=randomUUID();
  await db.query("INSERT INTO agencies(id,name,type) VALUES($1,'Private DMC','master')",[tenantId]);
  await db.query("UPDATE ai_agents SET enabled=false WHERE id='support'");
  await db.query(`INSERT INTO email_inbox(id,tenant_id,provider_email_id,to_address,from_address,subject,function_name,text_body)
    VALUES($1,NULL,$2,'support@bed4book.com','guest@example.com','Help','support','Hello')`,
    [platformId,"platform-"+platformId]);
  await db.query(`INSERT INTO email_inbox(id,tenant_id,provider_email_id,to_address,from_address,subject,function_name,text_body)
    VALUES($1,$2,$3,'support@private.example','guest@example.com','Private','support','Confidential')`,
    [privateId,tenantId,"private-"+privateId]);
});
test("IN1: duplicate platform inbound creates one job",{skip},async()=>{
  assert.equal(await queuePlatformInbox(db,platformId),true);
  assert.equal(await queuePlatformInbox(db,platformId),false);
  const n=await db.query("SELECT count(*)::int AS n FROM ai_jobs WHERE ref_id=$1",[platformId]);
  assert.equal(n.rows[0].n,1);
});
test("IN2: tenant mail is never queued",{skip},async()=>{
  assert.equal(await queuePlatformInbox(db,privateId),false);
  const n=await db.query("SELECT count(*)::int AS n FROM ai_jobs");
  assert.equal(n.rows[0].n,0);
});
test("IN3: disabled agent remains queued and resumes when enabled",{skip},async()=>{
  await queuePlatformInbox(db,platformId);
  let called=0;
  const fake=async (_db:any,_id:any,_input:any):Promise<RunResult>=>{called++;return {runId:null,status:"done",text:"",approvals:[]}};
  assert.equal(await processNextAiJob(db,fake),false);
  assert.equal(called,0);
  await db.query("UPDATE ai_agents SET enabled=true WHERE id='support'");
  assert.equal(await processNextAiJob(db,fake),true);
  assert.equal(called,1);
  const row=(await db.query("SELECT state,attempts FROM ai_jobs WHERE ref_id=$1",[platformId])).rows[0];
  assert.equal(row.state,"done");assert.equal(row.attempts,1);
});
test("IN4: worker prompt excludes private mail and attachment content",{skip},async()=>{
  await queuePlatformInbox(db,platformId);
  await db.query("UPDATE email_inbox SET text_body=$2 WHERE id=$1",[platformId,"Hello Private DMC net price 123 EUR"]);
  await db.query("UPDATE ai_agents SET enabled=true WHERE id='support'");
  let prompt="";
  const fake=async (_db:any,_id:any,input:any):Promise<RunResult>=>{prompt=input.prompt;return {runId:null,status:"done",text:"",approvals:[]}};
  await processNextAiJob(db,fake);
  assert.ok(prompt.includes("Hello"));
  assert.ok(!prompt.includes("Confidential"));
  assert.ok(!prompt.includes("Private DMC"));
  assert.ok(!prompt.includes("123 EUR"));
  assert.ok(!prompt.includes("support@private.example"));
});

test("IN5: expired running job is recovered once and completed with a new lease",{skip},async()=>{
  await queuePlatformInbox(db,platformId);
  await db.query("UPDATE ai_agents SET enabled=true WHERE id='support'");
  await db.query("UPDATE ai_jobs SET state='running',attempts=1,lease_token=$2,lease_expires_at=now()-interval '1 minute' WHERE ref_id=$1",[platformId,randomUUID()]);
  let calls=0;
  const fake=async (_db:any,_id:any,_input:any):Promise<RunResult>=>{calls++;return {runId:null,status:"done",text:"",approvals:[]}};
  assert.equal(await processNextAiJob(db,fake),true);
  assert.equal(await processNextAiJob(db,fake),false);
  assert.equal(calls,1);
  const row=(await db.query("SELECT state,attempts,lease_token FROM ai_jobs WHERE ref_id=$1",[platformId])).rows[0];
  assert.equal(row.state,"done");assert.equal(row.attempts,2);assert.equal(row.lease_token,null);
});
test("IN6: active lease cannot be stolen by another worker",{skip},async()=>{
  await queuePlatformInbox(db,platformId);
  await db.query("UPDATE ai_agents SET enabled=true WHERE id='support'");
  await db.query("UPDATE ai_jobs SET state='running',attempts=1,lease_token=$2,lease_expires_at=now()+interval '5 minutes' WHERE ref_id=$1",[platformId,randomUUID()]);
  let calls=0;
  const fake=async (_db:any,_id:any,_input:any):Promise<RunResult>=>{calls++;return {runId:null,status:"done",text:"",approvals:[]}};
  assert.equal(await processNextAiJob(db,fake),false);
  assert.equal(calls,0);
});

test("IN7: heartbeat extends active job without ending its work",{skip},async()=>{
  await queuePlatformInbox(db,platformId);
  const token=randomUUID();
  const row=(await db.query("UPDATE ai_jobs SET state='running',attempts=1,lease_token=$2,lease_expires_at=now()+interval '2 minutes' WHERE ref_id=$1 RETURNING id",[platformId,token])).rows[0];
  assert.equal(await renewAiJobLease(db,row.id,token),true);
  const lease=(await db.query("SELECT state,lease_expires_at>now()+interval '14 minutes' AS extended FROM ai_jobs WHERE id=$1",[row.id])).rows[0];
  assert.equal(lease.state,"running");
  assert.equal(lease.extended,true);
});
test("IN8: stale worker cannot renew or complete another owner's lease",{skip},async()=>{
  await queuePlatformInbox(db,platformId);
  const stale=randomUUID(),current=randomUUID();
  const row=(await db.query("UPDATE ai_jobs SET state='running',attempts=2,lease_token=$2,lease_expires_at=now()+interval '15 minutes' WHERE ref_id=$1 RETURNING id",[platformId,current])).rows[0];
  assert.equal(await renewAiJobLease(db,row.id,stale),false);
  const changed=await db.query("UPDATE ai_jobs SET state='done' WHERE id=$1 AND lease_token=$2 RETURNING id",[row.id,stale]);
  assert.equal(changed.rows.length,0);
  assert.equal((await db.query("SELECT state FROM ai_jobs WHERE id=$1",[row.id])).rows[0].state,"running");
});

test("IN9: exhausted crashed job becomes visible failed, not stuck running",{skip},async()=>{
  await queuePlatformInbox(db,platformId);
  await db.query("UPDATE ai_jobs SET state='running',attempts=3,lease_token=$2,lease_expires_at=now()-interval '1 minute' WHERE ref_id=$1",[platformId,randomUUID()]);
  assert.equal(await failExhaustedAiJobs(db),1);
  assert.equal(await failExhaustedAiJobs(db),0);
  const row=(await db.query("SELECT state,last_error,lease_token FROM ai_jobs WHERE ref_id=$1",[platformId])).rows[0];
  assert.equal(row.state,"failed");assert.equal(row.last_error,"AI_JOB_RETRY_EXHAUSTED");
  assert.equal(row.lease_token,null);
});

test("IN10: two simultaneous workers claim a queued email at most once",{skip},async()=>{
  await queuePlatformInbox(db,platformId);
  await db.query("UPDATE ai_agents SET enabled=true WHERE id='support'");
  let executions=0;
  const fake=async (_db:any,_id:any,_input:any):Promise<RunResult>=>{
    executions++;
    await new Promise(resolve=>setTimeout(resolve,40));
    return {runId:null,status:"done",text:"",approvals:[]};
  };
  await Promise.all([processNextAiJob(db,fake),processNextAiJob(db,fake)]);
  assert.equal(executions,1);
  const row=(await db.query("SELECT state,attempts FROM ai_jobs WHERE ref_id=$1",[platformId])).rows[0];
  assert.equal(row.state,"done");
  assert.equal(row.attempts,1);
});
