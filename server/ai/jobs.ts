import type { Db } from "./store";
import { randomUUID } from "node:crypto";
import { runPlatformAgent } from "./agents/runner";
import type { PlatformAgentId } from "./agents/registry";
import { pool } from "../db";

/** Defense in depth: prevent known DMC names and sensitive pricing terms entering prompts. */
export function redactInboundPrompt(value: string, dmcNames: string[]): string {
  let result = value.replace(/\b(?:net\s*(?:price|rate)|margin|platform\s*fee)\b[^\n,;}]*/gi, "[REDACTED]");
  for (const name of dmcNames.filter(n => n.length >= 3)) {
    const escaped = name.replace(/[.*+?^$\x7b\x7d()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "gi"), "[REDACTED_DMC]");
  }
  return result;
}
export const MAIL_AGENTS: Record<string, PlatformAgentId> = {
  reservations: "reservations", accounting: "accounting", contracts: "contracts", support: "support"
};

/** Queues platform mail only. A duplicate webhook never creates a duplicate job. */
export async function queuePlatformInbox(db: Db, inboxId: string): Promise<boolean> {
  const r=await db.query(`INSERT INTO ai_jobs(agent_id,kind,ref_id)
    SELECT CASE function_name
      WHEN 'reservations' THEN 'reservations' WHEN 'accounting' THEN 'accounting'
      WHEN 'contracts' THEN 'contracts' WHEN 'support' THEN 'support' END,
      'inbound_email', id FROM email_inbox
    WHERE id=$1 AND tenant_id IS NULL
      AND function_name IN ('reservations','accounting','contracts','support')
    ON CONFLICT(kind,ref_id) DO NOTHING RETURNING id`,[inboxId]);
  return Boolean(r.rows[0]);
}

/** One atomic claim, with disabled agents remaining queued. */
export async function renewAiJobLease(db: Db, jobId: string, token: string): Promise<boolean> {
  const updated=await db.query(`UPDATE ai_jobs
    SET lease_expires_at=now()+interval '15 minutes'
    WHERE id=$1 AND lease_token=$2 AND state='running'
      AND lease_expires_at>now() RETURNING id`,[jobId,token]);
  return updated.rows.length===1;
}

/** A worker owns its job while heartbeats succeed; the lease is a crash detector, not a deadline. */
export async function processNextAiJob(db: Db, execute: typeof runPlatformAgent = runPlatformAgent): Promise<boolean> {
  const token=randomUUID();
  const claimed=(await db.query(`UPDATE ai_jobs j SET state='running', attempts=j.attempts+1, lease_token=$1, lease_expires_at=now()+interval '15 minutes'
    WHERE id=(SELECT j2.id FROM ai_jobs j2 JOIN ai_agents a ON a.id=j2.agent_id
      WHERE a.enabled=true AND j2.attempts<3 AND (j2.state='queued' OR (j2.state='running' AND j2.lease_expires_at<now())) ORDER BY j2.created_at,j2.id LIMIT 1)
      AND (j.state='queued' OR (j.state='running' AND j.lease_expires_at<now())) RETURNING j.id,j.agent_id,j.kind,j.ref_id`,[token])).rows[0];
  if(!claimed)return false;
  let leaseHealthy=true;
  let renewing=false;
  const heartbeat=setInterval(()=>{
    if(renewing)return;
    renewing=true;
    void renewAiJobLease(db,claimed.id,token)
      .then(ok=>{if(!ok)leaseHealthy=false})
      .catch(()=>{leaseHealthy=false})
      .finally(()=>{renewing=false});
  },60000);
  heartbeat.unref();
  try{
    const email=(await db.query(`SELECT id,subject,from_address,to_address,text_body
      FROM email_inbox WHERE id=$1 AND tenant_id IS NULL`,[claimed.ref_id])).rows[0];
    if(!email)throw new Error("INBOX_NOT_FOUND");
    const attachments=(await db.query(`SELECT filename,content_type,size_bytes FROM inbound_attachments
      WHERE inbox_id=$1 ORDER BY id`,[claimed.ref_id])).rows;
    // Never pass attachment contents, storage references, or DMC-private messages to the model.
    const names=(await db.query("SELECT name FROM agencies WHERE type='master'")).rows.map(r=>String(r.name));
    const prompt=redactInboundPrompt(JSON.stringify({email:{id:email.id,from:email.from_address,to:email.to_address,
      subject:email.subject,text:email.text_body},attachments:attachments.map(a=>({
        name:a.filename,type:a.content_type,size:a.size_bytes
      }))}),names);
    const result=await execute(db,claimed.agent_id as PlatformAgentId,{trigger:"inbound_email",prompt});
    if(!leaseHealthy)throw new Error("AI_JOB_LEASE_LOST");
    const state=result.status==="done"?"done":result.status==="disabled"?"queued":"failed";
    await db.query("UPDATE ai_jobs SET state=$3,run_id=$4,last_error=$5,lease_token=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_token=$2",
      [claimed.id,token,state,result.runId,state==="failed"?result.status:null]);
  }catch(e){
    await db.query("UPDATE ai_jobs SET state='failed',last_error=$3,lease_token=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_token=$2",
      [claimed.id,token,String((e as Error).message||e).slice(0,500)]);
  }finally{
    clearInterval(heartbeat);
  }
  return true;
}

let timer: NodeJS.Timeout|null=null;
let activeWorkers=0;
export function startAiWorker(intervalMs=30000){
  if(timer||process.env.AI_WORKER==="off")return;
  const tick=()=>{
    void (async()=>{
      // One base worker, with up to two helpers when queued work accumulates.
      const pending=(await pool.query("SELECT count(*)::int AS n FROM ai_jobs WHERE state='queued'")).rows[0]?.n??0;
      const target=pending>=10?3:pending>=4?2:1;
      while(activeWorkers<target){
        activeWorkers++;
        void processNextAiJob(pool).catch(e=>console.error("AI worker",e))
          .finally(()=>{activeWorkers--});
      }
    })().catch(e=>console.error("AI worker scheduler",e));
  };
  timer=setInterval(tick,intervalMs);
  timer.unref();
}
