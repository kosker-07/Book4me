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
    const inbox = (await db.query("SELECT id FROM email_inbox WHERE id=$1 AND tenant_id IS NULL", [inboxId])).rows[0];
    if (!inbox) throw new Error("NOT_FOUND");
    const result = await db.query(`INSERT INTO ai_reply_drafts(inbox_id,agent_id,to_address,subject,text_body,approval_id,state)
      VALUES($1,$2,$3,$4,$5,$6,'approved') RETURNING id`, [inboxId,a.agent_id,toAddress,subject,textBody,a.id]);
    return result.rows[0]?.id;
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
