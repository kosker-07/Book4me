import { VALID_TERMS } from "./fixtures/rate-plan-terms";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const skip = !process.env.DATABASE_URL ? "DATABASE_URL required" : false;
if (skip && process.env.CI) throw new Error("DATABASE_URL required in CI");
process.env.SESSION_SECRET ||= "finance-ledger-integration-secret-at-least-32";
let pool: any, server: Server, base: string, hashPassword: (s: string) => string, issueSession: (p: any, s: string) => string;
async function request(method: string, p: string, token: string, body?: unknown) {
  const r = await fetch(base + p, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json", "Idempotency-Key": randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (r.headers.get("content-type") ?? "").includes("json") ? await r.json() as any : null };
}
before(async () => {
  if (skip) return;
  ({ pool } = await import("../../server/db"));
  ({ hashPassword, issueSession } = await import("../../server/security"));
  const { default: app } = await import("../../server/app");
  server = app.listen(0); base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(async () => { if (!skip) { server.close(); await pool.end(); } });
beforeEach(async () => {
  if (skip) return;
  await pool.query(`TRUNCATE ledger_lines, ledger_entries, agencies, users, hotels, rooms, rate_plans, inventory_daily, agency_hotel_sales, bookings, booking_status_history,
    booking_nights, audit_logs, idempotency_keys, fx_rates, login_attempts, vouchers, market_groups, fx_rate_history, proforma_counters CASCADE`);
});
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const checkIn = day(40), mid = day(41), checkOut = day(42);

/** DMC A owns the hotel (net 100/night x 2). Sub A (A's own) buys direct (+10%, A's platform fee 5%). Sub B (DMC B's)
 *  buys through the marketplace (platform margin 10%, B's markup 20%). DMC C is unrelated. */
async function world() {
  const id = () => randomUUID();
  const a = id(), b = id(), c = id(), subA = id(), subB = id(), h = id(), r = id(), p = id();
  for (const [agencyId, name, type, parent] of [[a, "Alpha DMC", "master", null], [b, "Bravo DMC", "master", null], [c, "Charlie DMC", "master", null],
    [subA, "Alpha Sub", "sub", a], [subB, "Bravo Sub", "sub", b]])
    await pool.query("INSERT INTO agencies(id,name,type,parent_agency_id) VALUES ($1,$2,$3,$4)", [agencyId, name, type, parent]);
  await pool.query("UPDATE agencies SET marketplace_markup_percent = 20 WHERE id = $1", [b]);
  await pool.query("UPDATE agencies SET platform_fee_percent = 5 WHERE id = $1", [a]);
  const t: Record<string, string> = {};
  for (const [key, role, agencyId] of [["admin", "system_admin", null], ["masterA", "master_agency", a], ["masterB", "master_agency", b], ["masterC", "master_agency", c],
    ["subA", "sub_agency", subA], ["subB", "sub_agency", subB]] as const) {
    const uid = id();
    await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES ($1,$2,$3,$4,$5)", [uid, `led-${key}@test.local`, hashPassword("integration-password-1"), role, agencyId]);
    t[key] = issueSession({ sub: uid, role, agencyId, ver: 0 }, process.env.SESSION_SECRET!);
  }
  await pool.query("INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ($1,$2,'Ledger Hotel','Antalya','active')", [h, a]);
  await pool.query("INSERT INTO rooms(id,hotel_id,name) VALUES ($1,$2,'Double')", [r, h]);
  await pool.query("INSERT INTO rate_plans(id,room_id,board_name,currency,cancellation_policy,payment_terms) VALUES ($1,$2,'BB','EUR',$3::jsonb,$4::jsonb)",
    [p, r, JSON.stringify(VALID_TERMS.cancellationPolicy), JSON.stringify(VALID_TERMS.paymentTerms)]);
  await pool.query("INSERT INTO inventory_daily(rate_plan_id,stay_date,price,allotment) VALUES ($1,$2,100,9),($1,$3,100,9)", [p, checkIn, mid]);
  assert.equal((await request("POST", "/api/admin/publications", t.admin!, { ratePlanId: p, agencyId: subA, markupType: "percent", markupValue: 10 })).status, 201);
  assert.equal((await request("POST", "/api/admin/distribution-rules", t.admin!, { sellerAgencyId: a, buyerAgencyId: b, effect: "allow", platformMarginPercent: 10 })).status, 201);
  return { a, b, c, subA, subB, t };
}
async function book(token: string) {
  const s = await request("POST", "/api/agency/searches", token, { checkIn, checkOut, rooms: 1, adults: 2, children: 0, childAges: [],
    roomOccupancies: [{ adults: 2, children: 0, childAges: [] }], nationalities: ["TR"] });
  const bk = await request("POST", "/api/agency/bookings", token, { quoteId: s.body.results[0].quoteId,
    guest: { firstName: "Test", lastName: "Guest", adults: 2, children: 0, childAges: [], email: "g@test.local", phone: "+905551112233", nationality: "TR" },
    otherGuests: [{ firstName: "Second", lastName: "Guest", type: "adult", nationality: "TR" }], operationNote: "Late arrival" });
  assert.equal(bk.status, 201, JSON.stringify(bk.body));
  return bk.body as { id: string; total: string; status: string };
}
const setStatus = (w: any, id: string, status: string) => request("PATCH", `/api/backoffice/bookings/${id}/status`, w.t.admin, { status });
const lines = async (bookingId: string) => (await pool.query(
  `SELECT e.book_owner_id, e.kind, l.party_kind, l.party_agency_id, l.debit::numeric(14,2)::text AS debit, l.credit::numeric(14,2)::text AS credit
     FROM ledger_entries e JOIN ledger_lines l ON l.entry_id = e.id WHERE e.booking_id = $1 ORDER BY e.kind, (e.book_owner_id IS NOT NULL), l.id`, [bookingId])).rows;


test("J8a tenant scopes, identical 404 and forbidden sub-agency on both finance endpoints", { skip }, async () => {
  const w = await world();
  const bk = await book(w.t.subB!); assert.equal((await setStatus(w, bk.id, "approved")).status, 200);
  for (const endpoint of ["balances", "ledger"]) {
    const path = "/api/finance/" + endpoint;
    const op = await request("GET", path, w.t.admin!);
    const aBook = await request("GET", path + "?book=" + w.a, w.t.admin!);
    const bBook = await request("GET", path + "?book=" + w.b, w.t.admin!);
    assert.equal(op.status, 200); assert.equal(aBook.status, 200); assert.equal(bBook.status, 200);
    const ownB = await request("GET", path, w.t.masterB!);
    assert.equal(ownB.status, 200); assert.equal(ownB.body.book, w.b);
    const bOperator = await request("GET", path + "?book=operator", w.t.masterB!);
    assert.equal(bOperator.status, 200); assert.equal(bOperator.body.book, "operator");
    const json = JSON.stringify(bOperator.body);
    assert.ok(!json.includes("Alpha DMC") && !json.includes(w.a), "seller must not leak into buyer operator view");
    const foreign = await request("GET", path + "?book=" + w.a, w.t.masterB!);
    const missing = await request("GET", path + "?book=" + randomUUID(), w.t.masterB!);
    assert.equal(foreign.status, 404); assert.deepEqual(foreign.body, missing.body);
    assert.equal((await request("GET", path, w.t.subB!)).status, 403);
  }
});

test("J8a ledger dates validate boundaries, reverse ranges and malformed dates", { skip }, async () => {
  const w = await world(); const bk = await book(w.t.subB!);
  assert.equal((await setStatus(w, bk.id, "approved")).status, 200);
  for (const q of ["from=2000-01-01&to=2099-12-31", "from=2000-01-01&to=2000-01-01", "from=2026-01-01", "to=2026-12-31"])
    assert.equal((await request("GET", "/api/finance/ledger?" + q, w.t.admin!)).status, 200, q);
  for (const q of ["from=2026-12-31&to=2026-01-01", "from=2026-02-30", "to=not-a-date", "from=2026-13-01"])
    assert.equal((await request("GET", "/api/finance/ledger?" + q, w.t.admin!)).status, 400, q);
});

test("J8a all operator journal entries balance by currency and book", { skip }, async () => {
  const w = await world(); const bk = await book(w.t.subB!);
  assert.equal((await setStatus(w, bk.id, "approved")).status, 200);
  const rows = (await pool.query(`SELECT e.id, e.currency, sum(l.debit)::numeric AS debits, sum(l.credit)::numeric AS credits
    FROM ledger_entries e JOIN ledger_lines l ON l.entry_id=e.id GROUP BY e.id,e.currency`)).rows;
  assert.ok(rows.length >= 2);
  for (const r of rows) assert.equal(Number(r.debits), Number(r.credits), JSON.stringify(r));
});
