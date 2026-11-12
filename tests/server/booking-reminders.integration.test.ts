import { VALID_TERMS } from "./fixtures/rate-plan-terms";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const skip = !process.env.DATABASE_URL ? "DATABASE_URL required" : false;
if (skip && process.env.CI) throw new Error("DATABASE_URL required in CI");
process.env.SESSION_SECRET ||= "booking-reminders-integration-secret-at-least-32";
process.env.MAIL_SECRET_KEY ||= randomBytes(32).toString("base64");
process.env.MAIL_WORKER = "off"; process.env.REMINDER_WORKER = "off";
let pool: any, server: Server, base: string, hashPassword: (s: string) => string, issueSession: (p: any, s: string) => string, rem: any;
async function request(method: string, p: string, token: string | null, body?: unknown) {
  const r = await fetch(base + p, { method, headers: { ...(token ? { authorization: "Bearer " + token } : {}), "content-type": "application/json", "Idempotency-Key": randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (r.headers.get("content-type") ?? "").includes("json") ? await r.json() as any : await r.text() };
}
before(async () => {
  if (skip) return;
  ({ pool } = await import("../../server/db"));
  ({ hashPassword, issueSession } = await import("../../server/security"));
  rem = await import("../../server/booking-reminders");
  const { default: app } = await import("../../server/app");
  server = app.listen(0); base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(async () => { if (!skip) { server.close(); await pool.end(); } });
beforeEach(async () => {
  if (skip) return;
  await pool.query(`TRUNCATE agencies, users, hotels, rooms, rate_plans, inventory_daily, agency_hotel_sales, bookings, booking_status_history, booking_reminders,
    booking_nights, audit_logs, idempotency_keys, fx_rates, login_attempts, vouchers, market_groups, fx_rate_history, proforma_counters, email_outbox CASCADE`);
});
const dayDate = (n: number) => new Date(Date.now() + n * 86400000);
const day = (n: number) => dayDate(n).toISOString().slice(0, 10);
const checkIn = day(40), mid = day(41), checkOut = day(42);

async function bookedWorld() {
  const id = () => randomUUID();
  const dmc = id(), sub = id(), h = id(), r = id(), p = id();
  await pool.query("INSERT INTO agencies(id,name,type,parent_agency_id) VALUES ($1,'DMC','master',NULL),($2,'Sub','sub',$1)", [dmc, sub]);
  const t: Record<string, string> = {};
  for (const [key, role, agencyId, email] of [["admin", "system_admin", null, "rem-admin@test.local"], ["sub", "sub_agency", sub, "agent@sub.test"]] as const) {
    const uid = id();
    await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES ($1,$2,$3,$4,$5)", [uid, email, hashPassword("integration-password-1"), role, agencyId]);
    t[key] = issueSession({ sub: uid, role, agencyId, ver: 0 }, process.env.SESSION_SECRET!);
  }
  await pool.query("INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ($1,$2,'Reminder Hotel','Antalya','active')", [h, dmc]);
  await pool.query("INSERT INTO rooms(id,hotel_id,name) VALUES ($1,$2,'Double')", [r, h]);
  await pool.query("INSERT INTO rate_plans(id,room_id,board_name,currency,cancellation_policy,payment_terms) VALUES ($1,$2,'BB','EUR',$3::jsonb,$4::jsonb)",
    [p, r, JSON.stringify(VALID_TERMS.cancellationPolicy), JSON.stringify(VALID_TERMS.paymentTerms)]);
  await pool.query("INSERT INTO inventory_daily(rate_plan_id,stay_date,price,allotment) VALUES ($1,$2,100,9),($1,$3,100,9)", [p, checkIn, mid]);
  assert.equal((await request("POST", "/api/admin/publications", t.admin!, { ratePlanId: p, agencyId: sub, markupType: "percent", markupValue: 0 })).status, 201);
  const s = await request("POST", "/api/agency/searches", t.sub!, { checkIn, checkOut, rooms: 1, adults: 2, children: 0, childAges: [],
    roomOccupancies: [{ adults: 2, children: 0, childAges: [] }], nationalities: ["TR"] });
  const b = await request("POST", "/api/agency/bookings", t.sub!, { quoteId: s.body.results[0].quoteId,
    guest: { firstName: "Test", lastName: "Guest", adults: 2, children: 0, childAges: [], email: "g@test.local", phone: "+905551112233", nationality: "TR" },
    otherGuests: [{ firstName: "Second", lastName: "Guest", type: "adult", nationality: "TR" }], operationNote: "Late arrival" });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  return { dmc, sub, booking: b.body.id as string };
}
// Payment term 14 days before check-in (day 40) => due on day 26; the early reminder goes on day 23.

test("R5 two reminders are planned once; the early one is sent to the agency's users with a read link, via the DMC as tenant", { skip }, async () => {
  const w = await bookedWorld();
  assert.equal(await rem.planReminders(pool), 2);
  assert.equal(await rem.planReminders(pool), 0, "idempotent");
  const rows = (await pool.query("SELECT kind, due_date::text, send_on::text FROM booking_reminders ORDER BY kind")).rows;
  assert.deepEqual(rows, [{ kind: "payment_due", due_date: day(26), send_on: day(26) }, { kind: "payment_due_soon", due_date: day(26), send_on: day(23) }]);
  assert.equal(await rem.sendDueReminders(pool, dayDate(22)), 0, "nothing before its day");
  assert.equal(await rem.sendDueReminders(pool, dayDate(23)), 1);
  assert.equal(await rem.sendDueReminders(pool, dayDate(23)), 0, "never twice");
  const mails = (await pool.query("SELECT tenant_id, to_address, subject, html, text_body, status, last_error FROM email_outbox")).rows;
  assert.equal(mails.length, 1);
  assert.equal(mails[0].tenant_id, w.dmc, "sent with the DMC's own mail settings, never the platform's");
  assert.equal(mails[0].to_address, "agent@sub.test");
  assert.match(mails[0].subject, /^Payment reminder /);
  assert.deepEqual([mails[0].status, mails[0].last_error], ["failed", "MAIL_NOT_CONFIGURED"], "no DMC mail settings yet: kept, not sent through BED4BOOK");
  const token = (await pool.query("SELECT read_token FROM booking_reminders WHERE kind='payment_due_soon'")).rows[0].read_token;
  assert.ok(mails[0].html.includes("/r/" + token) && mails[0].text_body.includes("/r/" + token));
  assert.doesNotMatch(mails[0].html, /net|margin|markup/i);
});

test("R5b the read link marks the reminder read and the second reminder is skipped; unknown tokens 404", { skip }, async () => {
  await bookedWorld();
  await rem.planReminders(pool);
  await rem.sendDueReminders(pool, dayDate(23));
  const token = (await pool.query("SELECT read_token FROM booking_reminders WHERE kind='payment_due_soon'")).rows[0].read_token;
  const read = await request("GET", "/r/" + token, null);
  assert.equal(read.status, 200); assert.match(read.body, /marked as read/);
  assert.equal((await request("GET", "/r/" + token, null)).status, 200, "repeat click is harmless");
  assert.equal((await request("GET", "/r/" + "x".repeat(32), null)).status, 404);
  assert.equal((await request("GET", "/r/<script>", null)).status, 404);
  assert.equal(await rem.sendDueReminders(pool, dayDate(26)), 0);
  assert.deepEqual((await pool.query("SELECT state, skip_reason FROM booking_reminders WHERE kind='payment_due'")).rows[0], { state: "skipped", skip_reason: "ALREADY_READ" });
  assert.equal(Number((await pool.query("SELECT count(*) AS n FROM email_outbox")).rows[0].n), 1);
});

test("R5c unread first reminder => the due-day reminder goes; a cancelled booking gets none", { skip }, async () => {
  const w = await bookedWorld();
  await rem.planReminders(pool);
  assert.equal(await rem.sendDueReminders(pool, dayDate(26)), 2, "both are due by then");
  await pool.query("TRUNCATE booking_reminders, email_outbox");
  await pool.query("UPDATE bookings SET status='cancelled' WHERE id=$1", [w.booking]);
  assert.equal(await rem.planReminders(pool), 0, "cancelled bookings are not planned");
});
