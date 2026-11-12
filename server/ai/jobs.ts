import type { Db } from "./store";
import { runPlatformAgent } from "./agents/runner";
import type { PlatformAgentId } from "./agents/registry";
import { pool } from "../db";

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
export async function processNextAiJob(db: Db, execute: typeof runPlatformAgent = runPlatformAgent): Promise<boolean> {
  const claimed=(await db.query(`UPDATE ai_jobs j SET state='running', attempts=attempts+1
    WHERE id=(SELECT j2.id FROM ai_jobs j2 JOIN ai_agents a ON a.id=j2.agent_id
      WHERE j2.state='queued' AND a.enabled=true ORDER BY j2.created_at,j2.id LIMIT 1)
      AND state='queued' RETURNING id,agent_id,kind,ref_id`)).rows[0];
  if(!claimed)return false;
  try{
    const email=(await db.query(`SELECT id,subject,from_address,to_address,text_body
      FROM email_inbox WHERE id=$1 AND tenant_id IS NULL`,[claimed.ref_id])).rows[0];
    if(!email)throw new Error("INBOX_NOT_FOUND");
    const attachments=(await db.query(`SELECT filename,content_type,size_bytes FROM inbound_attachments
      WHERE inbox_id=$1 ORDER BY id`,[claimed.ref_id])).rows;
    // Never pass attachment contents, storage references, or DMC-private messages to the model.
    const prompt=JSON.stringify({email:{id:email.id,from:email.from_address,to:email.to_address,
      subject:email.subject,text:email.text_body},attachments:attachments.map(a=>({
        name:a.filename,type:a.content_type,size:a.size_bytes
      }))});
    const result=await execute(db,claimed.agent_id as PlatformAgentId,{trigger:"inbound_email",prompt});
    const state=result.status==="done"?"done":result.status==="disabled"?"queued":"failed";
    await db.query("UPDATE ai_jobs SET state=$2,run_id=$3,last_error=$4 WHERE id=$1",
      [claimed.id,state,result.runId,state==="failed"?result.status:null]);
  }catch(e){
    await db.query("UPDATE ai_jobs SET state='failed',last_error=$2 WHERE id=$1",
      [claimed.id,String((e as Error).message||e).slice(0,500)]);
  }
  return true;
}

let timer: NodeJS.Timeout|null=null;
export function startAiWorker(intervalMs=30000){
  if(timer||process.env.AI_WORKER==="off")return;
  const tick=()=>{void processNextAiJob(pool).catch(e=>console.error("AI worker",e))};
  timer=setInterval(tick,intervalMs);
  timer.unref();
}
