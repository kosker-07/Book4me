import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {queuePlatformInbox,processNextAiJob} from "../../server/ai/jobs";
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
  await db.query("UPDATE ai_agents SET enabled=true WHERE id='support'");
  let prompt="";
  const fake=async (_db:any,_id:any,input:any):Promise<RunResult>=>{prompt=input.prompt;return {runId:null,status:"done",text:"",approvals:[]}};
  await processNextAiJob(db,fake);
  assert.ok(prompt.includes("Hello"));
  assert.ok(!prompt.includes("Confidential"));
  assert.ok(!prompt.includes("support@private.example"));
});
