import { registerApprovalHandler } from "../approvals";
import type { Db } from "../store";
import { transition } from "../../booking-transition";
import type { PoolClient } from "pg";

const uuid = (v: unknown): string => {
  if (typeof v !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) throw new Error("INVALID_UUID");
  return v;
};
const text = (v: unknown, max: number): string => {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new Error("INVALID_INPUT");
  return v.trim();
};
const REPLY_FUNCTIONS = new Set(["support","reservations","accounting","contracts"]);
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
export const replyHtml = (body: string) => `<div style="font-family:Arial,sans-serif;max-width:560px">${escapeHtml(body).replace(/\r?\n/g, "<br>")}</div>`;
const platform = (tenantId: string | null) => {
  if (tenantId !== null) throw new Error("PLATFORM_ONLY");
};

/** Call this once during server startup. The approval gate owns exactly-once claims. */
export function registerPlatformApprovalHandlers(): void {
  registerApprovalHandler("draftReply", async (db, a) => {
    platform(a.tenant_id);
    const inboxId = uuid(a.payload.inboxId);
    const toAddress = text(a.payload.toAddress, 320);
    const subject = text(a.payload.subject, 250);
    const textBody = text(a.payload.textBody, 8000);
    const inbox = (await db.query("SELECT id, function_name FROM email_inbox WHERE id=$1 AND tenant_id IS NULL", [inboxId])).rows[0];
    if (!inbox) throw new Error("NOT_FOUND");
    // A human approval queues exactly one platform-owned email; the outbox worker sends it.
    // Idempotency is enforced by email_outbox_idem_idx even if the handler is retried.
    const outbox = await db.query(`INSERT INTO email_outbox
      (tenant_id,kind,function_name,to_address,subject,html,text_body,idempotency_key)
      VALUES(NULL,'ai_approved_reply',$5,$1,$2,$3,$6,$4)
      ON CONFLICT DO NOTHING RETURNING id`,
      // Reply from the address the mail came to; the body is plain text, escaped for the HTML part.
      [toAddress,subject,replyHtml(textBody),`ai-reply:${a.id}`,REPLY_FUNCTIONS.has(inbox.function_name) ? inbox.function_name : "support",textBody]);
    const result = await db.query(`INSERT INTO ai_reply_drafts(inbox_id,agent_id,to_address,subject,text_body,approval_id,state)
      SELECT $1,$2,$3,$4,$5,$6,'approved'
      WHERE NOT EXISTS (SELECT 1 FROM ai_reply_drafts WHERE approval_id=$6)
      RETURNING id`, [inboxId,a.agent_id,toAddress,subject,textBody,a.id]);
    return result.rows[0]?.id ?? outbox.rows[0]?.id ?? a.id;
  });
  registerApprovalHandler("flagBooking", async (db, a) => {
    platform(a.tenant_id);
    const bookingId = uuid(a.payload.bookingId), reason = text(a.payload.reason,500);
    const exists = (await db.query("SELECT id FROM bookings WHERE id=$1", [bookingId])).rows[0];
    if (!exists) throw new Error("NOT_FOUND");
    const result = await db.query("INSERT INTO ai_booking_flags(booking_id,agent_id,reason) VALUES($1,$2,$3) RETURNING id", [bookingId,a.agent_id,reason]);
    return result.rows[0]?.id;
  });
  registerApprovalHandler("requestRefund", async (db, a, approverId) => {
    platform(a.tenant_id);
    const bookingId = uuid(a.payload.bookingId), currency = text(a.payload.currency,3).toUpperCase(), reason = text(a.payload.reason,500);
    const amount = a.payload.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 999999999999.99 || !/^[A-Z]{3}$/.test(currency)) throw new Error("INVALID_INPUT");
    const booking = (await db.query("SELECT id FROM bookings WHERE id=$1", [bookingId])).rows[0];
    if (!booking) throw new Error("NOT_FOUND");
    const result = await db.query(`INSERT INTO refund_requests(booking_id,amount,currency,reason,state,requested_by_agent,approved_by)
      VALUES($1,$2,$3,$4,'requested',$5,$6) RETURNING id`, [bookingId,amount,currency,reason,a.agent_id,uuid(approverId)]);
    // This creates a request only. No payment, refund transfer, or ledger posting occurs.
    return result.rows[0]?.id;
  });
  registerApprovalHandler("changeBookingStatus", async (db, a, approverId) => {
    platform(a.tenant_id);
    const bookingId = uuid(a.payload.bookingId), status = text(a.payload.status,30);
    if (!["approved","rejected","cancelled"].includes(status)) throw new Error("INVALID_STATUS");
    const reason = text(a.payload.reason,500);
    const from = status === "cancelled" ? ["draft","pending","approved"] : ["pending"];
    const changed = await transition(db as PoolClient, { bookingId, to: status, from, scopeSql: "true", scopeParams: [], actorId: uuid(approverId), note: reason });
    if (!changed) throw new Error("BOOKING_TRANSITION_NOT_ALLOWED");
    return changed;
  });
}
