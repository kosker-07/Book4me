// Inbound mail: the webhook is verified first (Svix signature), then only metadata arrives; the body and
// attachments are fetched with the receiving API using the owner's own key (platform key or the DMC's key).
import { createHash } from "node:crypto";
import { recordOwnerNotification } from "../ai/owner-notify";
import { functionForAddress } from "./addresses";
import { fetchReceivedEmail, ReceivedEmail } from "./provider";
import type { Db } from "./outbox";

const ATTACHMENT_FUNCTIONS = new Set(["contracts", "accounting"]);
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export interface InboundEvent { type?: string; data?: { email_id?: string; from?: string; to?: string[]; subject?: string; message_id?: string } }
export interface InboundDeps { db: Db; apiKey: string; fetchEmail?: (apiKey: string, id: string) => Promise<ReceivedEmail>; download?: (url: string) => Promise<Buffer> }

/** Streams the attachment and stops as soon as it passes the limit, so an oversized file is never held in memory. */
const defaultDownload = async (url: string): Promise<Buffer> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`DOWNLOAD_${r.status}`);
  if (Number(r.headers.get("content-length") || 0) > MAX_ATTACHMENT_BYTES) { await r.body?.cancel(); throw new Error("ATTACHMENT_TOO_LARGE"); }
  const chunks: Buffer[] = []; let size = 0;
  const reader = r.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ATTACHMENT_BYTES) { await reader.cancel(); throw new Error("ATTACHMENT_TOO_LARGE"); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
};

export async function handleInbound(deps: InboundDeps, tenantId: string | null, event: InboundEvent): Promise<{ stored: boolean; deduplicated: boolean }> {
  const d = event?.data;
  if (event?.type !== "email.received" || !d?.email_id || !d.from || !Array.isArray(d.to) || !d.to[0]) return { stored: false, deduplicated: false };
  const to = String(d.to[0]).toLowerCase();
  const fn = tenantId ? null : functionForAddress(to);
  const row = (await deps.db.query(
    `INSERT INTO email_inbox(tenant_id, provider_email_id, message_id, to_address, from_address, subject, function_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
    [tenantId, d.email_id, d.message_id ?? null, to, String(d.from).slice(0, 320), String(d.subject ?? "").slice(0, 500), fn])).rows[0];
  if (!row) return { stored: true, deduplicated: true };
  try {
    const email = await (deps.fetchEmail ?? fetchReceivedEmail)(deps.apiKey, d.email_id);
    await deps.db.query("UPDATE email_inbox SET text_body = $2, html = $3, message_id = COALESCE(message_id, $4), body_status = 'fetched' WHERE id = $1", [row.id, email.text, email.html, email.messageId]);
    if (tenantId || (fn && ATTACHMENT_FUNCTIONS.has(fn))) {
      for (const a of email.attachments) {
        if (a.size > MAX_ATTACHMENT_BYTES) continue;
        let data: Buffer;
        try { data = await (deps.download ?? defaultDownload)(a.downloadUrl); }
        catch (e) { if ((e as Error).message === "ATTACHMENT_TOO_LARGE") continue; throw e; }
        if (data.length > MAX_ATTACHMENT_BYTES) continue;
        await deps.db.query(
          "INSERT INTO inbound_attachments(inbox_id, filename, content_type, size_bytes, sha256, data) VALUES ($1,$2,$3,$4,$5,$6)",
          [row.id, a.filename.slice(0, 255), a.contentType.slice(0, 100), data.length, createHash("sha256").update(data).digest("hex"), data]);
      }
    }
  } catch {
    await deps.db.query("UPDATE email_inbox SET body_status = 'failed' WHERE id = $1", [row.id]);
  }
  if (tenantId === null && fn === "security") {
    await recordOwnerNotification(deps.db,"security-email:"+row.id,{kind:"alert",function:"security"},
      "New BED4BOOK security mailbox message: "+String(d.subject??"").slice(0,200));
  }
  return { stored: true, deduplicated: false };
}
