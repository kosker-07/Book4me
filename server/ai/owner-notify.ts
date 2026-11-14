import { pool } from "../db";
import type { Db } from "./store";
import { classifyImportance } from "./notify";
import type { NotifyItem, NotifyRule, Channel } from "./notify";
import { enqueueMail } from "../mail/outbox";

const owner=()=>process.env.OWNER_EMAIL?.trim()||"";
const escapeHtml=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const dayIstanbul=(d:Date)=>{
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Istanbul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
  const get=(name:string)=>parts.find(p=>p.type===name)?.value??"";
  return get("year")+"-"+get("month")+"-"+get("day");
};
const clockIstanbul=(d:Date)=>new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Istanbul",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(d);
export async function recordOwnerNotification(db:Db, eventKey:string,item:NotifyItem,summary:string,now=new Date()):Promise<{channel:Channel;stored:boolean}> {
  const rules=(await db.query("SELECT match_kind,match_value,channel,active FROM notify_rules WHERE active ORDER BY position,id")).rows as NotifyRule[];
  let channel=classifyImportance(item,rules);
  // Allocate one of ten unique slots for this UTC hour. Concurrent inserts cannot share a slot.
  const hour=new Date(now);hour.setUTCMinutes(0,0,0);
  const values=[eventKey,item.kind,item.function??null,item.risk??null,item.amountEur??null,item.fromDomain??null,summary.slice(0,500),channel];
  const row=(await db.query(`INSERT INTO owner_notifications(event_key,kind,function_name,risk,amount_eur,from_domain,summary,channel)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(event_key) DO NOTHING RETURNING id`,values)).rows[0];
  if(!row)return {channel,stored:false};
  if(channel==="instant"){
    const slot=(await db.query(`UPDATE owner_notifications n SET instant_hour=$2,instant_slot=slot.slot
      FROM (SELECT s AS slot FROM generate_series(1,10) s WHERE NOT EXISTS
        (SELECT 1 FROM owner_notifications x WHERE x.instant_hour=$2 AND x.instant_slot=s)
        ORDER BY s LIMIT 1) slot
      WHERE n.id=$1 AND n.instant_slot IS NULL RETURNING n.instant_slot`,[row.id,hour])).rows[0];
    if(!slot){channel="digest";await db.query("UPDATE owner_notifications SET channel='digest' WHERE id=$1",[row.id]);}
    else if(owner()){
      const mail={subject:"BED4BOOK alert",text:summary,html:"<p>"+escapeHtml(summary)+"</p>"};
      const sent=await enqueueMail(db,{tenantId:null,kind:"owner_instant",to:owner(),functionName:"noreply",mail,idempotencyKey:"owner:"+eventKey});
      await db.query(`INSERT INTO owner_notification_deliveries(notification_id,delivery_kind,delivery_day,outbox_id)
        VALUES($1,'instant',$2,$3) ON CONFLICT DO NOTHING`,[row.id,dayIstanbul(now),sent.id]);
    }
  }
  return {channel,stored:true};
}

export async function sendOwnerDigest(db:Db,now=new Date()):Promise<boolean>{
  if(clockIstanbul(now)<"08:30"||!owner())return false;
  const day=dayIstanbul(now);
  const existing=await db.query("SELECT 1 FROM owner_notification_deliveries WHERE delivery_kind='digest' AND delivery_day=$1",[day]);
  if(existing.rows[0])return false;
  const rows=(await db.query(`SELECT id,summary,channel FROM owner_notifications
    WHERE created_at > $1::timestamptz - interval '24 hours'
      AND created_at <= $1::timestamptz AND channel<>'never'
    ORDER BY created_at LIMIT 1000`,[now.toISOString()])).rows;
  const digest=rows.filter(x=>x.channel==="digest").slice(0,10).map(x=>x.summary);
  const count=rows.filter(x=>x.channel==="count_only").length;
  const approvals=(await db.query("SELECT id,agent_id FROM approval_queue WHERE state='pending' AND tenant_id IS NULL ORDER BY created_at LIMIT 10")).rows;
  const centerUrl=process.env.AI_CENTER_URL?.trim();
  const lines=[...digest,...approvals.map(a=>"Pending approval ("+a.agent_id+")"+(centerUrl?" — AI Center: "+centerUrl+"?page=ai-center&approval="+a.id:""))];
  if(count)lines.push("Other notifications: "+count);
  const text=lines.slice(0,10).map((x,i)=>(i+1)+". "+x).join("\n")||"No notifications today.";
  // Idempotent outbox key prevents duplicate email even across worker restarts.
  const sent=await enqueueMail(db,{tenantId:null,kind:"owner_digest",to:owner(),functionName:"noreply",
    idempotencyKey:"owner-digest:"+day,mail:{subject:"BED4BOOK daily summary — "+day,text,html:"<pre>"+escapeHtml(text)+"</pre>"}});
  await db.query(`INSERT INTO owner_notification_deliveries(notification_id,delivery_kind,delivery_day,outbox_id)
    VALUES(NULL,'digest',$1,$2) ON CONFLICT DO NOTHING`,[day,sent.id]);
  return true;
}

let timer:NodeJS.Timeout|null=null;
export function startOwnerDigestWorker(intervalMs=60000){
  if(timer||process.env.AI_WORKER==="off")return;
  timer=setInterval(()=>{void sendOwnerDigest(pool).catch(e=>console.error("owner digest",e))},intervalMs);
  timer.unref();
}
