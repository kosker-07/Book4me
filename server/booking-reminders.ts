// Payment reminders. The due date is check-in minus the rate plan's payment term (dueDaysBeforeCheckIn).
// Two reminders per open booking (pending/approved): SOON_DAYS before the due date and on it; the second is skipped
// once the first was read. Recipients are the booking agency's active users; the mail is queued with that agency's
// DMC as tenant, so it leaves with the DMC's own mail settings (never BED4BOOK's). Without them the outbox keeps it
// as failed/MAIL_NOT_CONFIGURED. Everything is idempotent: running twice never sends twice.
import { randomBytes } from "node:crypto";
import { enqueueMail, tenantOf } from "./mail/outbox";
import { paymentReminder } from "./mail/templates";

export interface Db { query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> }
export const SOON_DAYS = 3;
const OPEN = "('pending','approved')";
const day = (d: Date) => d.toISOString().slice(0, 10);

export function publicBaseUrl(): string {
  const v = (process.env.PUBLIC_BASE_URL || "https://agent.bed4book.com").replace(/\/+$/, "");
  return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(v) ? v : "https://agent.bed4book.com";
}

/** Creates the reminder rows for open bookings whose due date is still ahead. */
export async function planReminders(db: Db, now: Date = new Date()): Promise<number> {
  const rows = (await db.query(
    `SELECT b.id, (b.check_in - ((rp.payment_terms->>'dueDaysBeforeCheckIn')::int))::text AS due_date
       FROM bookings b JOIN rate_plans rp ON rp.id = b.rate_plan_id
      WHERE b.status IN ${OPEN} AND jsonb_typeof(rp.payment_terms->'dueDaysBeforeCheckIn') = 'number'
        AND b.check_in - ((rp.payment_terms->>'dueDaysBeforeCheckIn')::int) >= $1::date
        AND NOT EXISTS (SELECT 1 FROM booking_reminders r WHERE r.booking_id = b.id)`, [day(now)])).rows;
  let created = 0;
  for (const r of rows) {
    for (const [kind, offset] of [["payment_due_soon", SOON_DAYS], ["payment_due", 0]] as const) {
      const ins = await db.query(
        `INSERT INTO booking_reminders(booking_id, kind, due_date, send_on, read_token)
         VALUES ($1, $2, $3::date, GREATEST($3::date - $4::int, $5::date), $6) ON CONFLICT (booking_id, kind) DO NOTHING`,
        [r.id, kind, r.due_date, offset, day(now), randomBytes(24).toString("base64url")]);
      created += ins.rowCount ?? 0;
    }
  }
  return created;
}

/** Sends every reminder whose day has come. Returns how many reminders were sent. */
export async function sendDueReminders(db: Db, now: Date = new Date()): Promise<number> {
  const due = (await db.query(
    `SELECT r.id, r.kind, r.due_date::text AS due_date, r.read_token, b.id AS booking_id, b.booking_no, b.agency_id, b.status,
            b.total::text AS total, b.currency,
            (SELECT f.read_at IS NOT NULL FROM booking_reminders f WHERE f.booking_id = r.booking_id AND f.kind = 'payment_due_soon') AS first_read
       FROM booking_reminders r JOIN bookings b ON b.id = r.booking_id
      WHERE r.state = 'scheduled' AND r.send_on <= $1::date ORDER BY r.send_on, r.id LIMIT 500`, [day(now)])).rows;
  let sent = 0;
  for (const r of due) {
    const skip = !["pending", "approved"].includes(r.status) ? "BOOKING_NOT_OPEN" : r.kind === "payment_due" && r.first_read ? "ALREADY_READ" : null;
    if (skip) { await db.query("UPDATE booking_reminders SET state = 'skipped', skip_reason = $2 WHERE id = $1 AND state = 'scheduled'", [r.id, skip]); continue; }
    const claimed = await db.query("UPDATE booking_reminders SET state = 'sent', sent_at = $2 WHERE id = $1 AND state = 'scheduled'", [r.id, now]);
    if (!claimed.rowCount) continue;
    const tenant = await tenantOf(db, r.agency_id);
    const users = (await db.query("SELECT id, email FROM users WHERE agency_id = $1 AND active ORDER BY email", [r.agency_id])).rows;
    const mail = paymentReminder({ reference: r.booking_no, amountDue: r.total, currency: String(r.currency).trim(), dueDate: r.due_date,
                                   readUrl: `${publicBaseUrl()}/r/${r.read_token}` });
    for (const u of users) {
      try { await enqueueMail(db, { tenantId: tenant, kind: "payment_reminder", to: u.email, mail, idempotencyKey: `reminder:${r.id}:${u.id}` }); }
      catch (e) { console.error("reminder recipient skipped", (e as Error).message); }
    }
    sent++;
  }
  return sent;
}

/** Marks a reminder read from its link. Unknown tokens and repeated clicks are harmless. */
export async function markRead(db: Db, token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return false;
  const r = await db.query("UPDATE booking_reminders SET read_at = COALESCE(read_at, now()) WHERE read_token = $1 RETURNING id", [token]);
  return (r.rowCount ?? 0) > 0;
}

let timer: NodeJS.Timeout | null = null;
export function startReminderWorker(db: Db, intervalMs = 15 * 60_000) {
  if (timer || process.env.REMINDER_WORKER === "off") return;
  const tick = () => { planReminders(db).then(() => sendDueReminders(db)).catch(e => console.error("reminder worker", e?.message || e)); };
  timer = setInterval(tick, intervalMs);
  timer.unref();
}
