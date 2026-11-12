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

test("F1 marketplace sale: operator book B 220 / A 200 / revenue 20; B's book sub 264 / B 264; nothing before approval", { skip }, async () => {
  const w = await world();
  const bk = await book(w.t.subB!);
  assert.equal(bk.total, "264.00");
  assert.equal((await lines(bk.id)).length, 0, "pending booking posts nothing");
  assert.equal((await setStatus(w, bk.id, "approved")).status, 200);
  assert.deepEqual(await lines(bk.id), [
    { book_owner_id: null, kind: "booking", party_kind: "dmc", party_agency_id: w.b, debit: "220.00", credit: "0.00" },
    { book_owner_id: null, kind: "booking", party_kind: "dmc", party_agency_id: w.a, debit: "0.00", credit: "200.00" },
    { book_owner_id: null, kind: "booking", party_kind: "platform_revenue", party_agency_id: null, debit: "0.00", credit: "20.00" },
    { book_owner_id: w.b, kind: "booking", party_kind: "sub", party_agency_id: w.subB, debit: "264.00", credit: "0.00" },
    { book_owner_id: w.b, kind: "booking", party_kind: "dmc", party_agency_id: w.b, debit: "0.00", credit: "264.00" }]);
});

test("F2 isolation: a DMC sees its own book and only its own operator lines; another DMC 404; sub-agency 403", { skip }, async () => {
  const w = await world();
  const bk = await book(w.t.subB!); await setStatus(w, bk.id, "approved");
  const op = (await request("GET", "/api/finance/ledger", w.t.admin!)).body;
  assert.equal(op.entries.length, 1); assert.equal(op.entries[0].lines.length, 3);
  const bOp = (await request("GET", "/api/finance/ledger?book=operator", w.t.masterB!)).body;
  assert.deepEqual(bOp.entries[0].lines.map((l: any) => [l.partyId, l.debit]), [[w.b, "220.00"]]);
  assert.ok(!JSON.stringify(bOp).includes("Alpha") && !JSON.stringify(bOp).includes("revenue"), "no seller, no margin");
  const bOwn = (await request("GET", "/api/finance/ledger", w.t.masterB!)).body;
  assert.equal(bOwn.entries.length, 1); assert.equal(bOwn.entries[0].lines[0].party, "Bravo Sub");
  const aBal = (await request("GET", "/api/finance/balances?book=operator", w.t.masterA!)).body.items;
  assert.deepEqual(aBal.map((x: any) => [x.party_name, x.balance]), [["Alpha DMC", "-200.00"]]);
  assert.equal((await request("GET", "/api/finance/ledger?book=own", w.t.masterC!)).body.entries.length, 0);
  const foreign = await request("GET", `/api/finance/ledger?book=${w.b}`, w.t.masterA!), missing = await request("GET", `/api/finance/ledger?book=${randomUUID()}`, w.t.masterA!);
  assert.deepEqual([foreign.status, foreign.body], [missing.status, missing.body]); assert.equal(foreign.status, 404);
  assert.equal((await request("GET", "/api/finance/ledger", w.t.subB!)).status, 403);
  assert.equal((await request("GET", `/api/finance/ledger?book=${w.b}`, w.t.admin!)).body.entries.length, 1, "operator can read a DMC book");
});

test("F3 the ledger is append-only and every entry must balance", { skip }, async () => {
  const w = await world();
  const bk = await book(w.t.subB!); await setStatus(w, bk.id, "approved");
  await assert.rejects(pool.query("UPDATE ledger_lines SET debit = debit + 1 WHERE debit > 0"), /append-only/);
  await assert.rejects(pool.query("DELETE FROM ledger_entries"), /append-only/);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const e = (await client.query("INSERT INTO ledger_entries(kind, currency, description) VALUES ('booking','EUR','manual') RETURNING id")).rows[0].id;
    await client.query("INSERT INTO ledger_lines(entry_id, party_kind, party_agency_id, debit) VALUES ($1,'dmc',$2,10)", [e, w.a]);
    await client.query("INSERT INTO ledger_lines(entry_id, party_kind, credit) VALUES ($1,'platform_revenue',9)", [e]);
    await assert.rejects(client.query("COMMIT"), /not balanced/);
  } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
});

test("F4 cancelling an approved booking posts mirror reversals; every balance returns to zero; no double reversal", { skip }, async () => {
  const w = await world();
  const bk = await book(w.t.subB!); await setStatus(w, bk.id, "approved");
  assert.equal((await setStatus(w, bk.id, "cancelled")).status, 200);
  const all = await lines(bk.id);
  assert.equal(all.filter(l => l.kind === "reversal").length, 5);
  const bal = (await pool.query(`SELECT e.book_owner_id, l.party_agency_id, l.party_kind, sum(l.debit - l.credit)::text AS b
    FROM ledger_entries e JOIN ledger_lines l ON l.entry_id = e.id GROUP BY 1,2,3`)).rows;
  assert.ok(bal.every((x: any) => Number(x.b) === 0), JSON.stringify(bal));
  await pool.query("SELECT ledger_reverse_booking($1, 'again')", [bk.id]);
  assert.equal((await lines(bk.id)).length, 10, "already reversed entries are not reversed twice");
});

test("F5 direct sale: platform fee in the operator book, sale in A's book; credit-pending bookings post nothing", { skip }, async () => {
  const w = await world();
  const bk = await book(w.t.subA!);
  assert.equal(bk.total, "230.00");
  await setStatus(w, bk.id, "approved");
  assert.deepEqual(await lines(bk.id), [
    { book_owner_id: null, kind: "booking", party_kind: "dmc", party_agency_id: w.a, debit: "10.00", credit: "0.00" },
    { book_owner_id: null, kind: "booking", party_kind: "platform_revenue", party_agency_id: null, debit: "0.00", credit: "10.00" },
    { book_owner_id: w.a, kind: "booking", party_kind: "sub", party_agency_id: w.subA, debit: "230.00", credit: "0.00" },
    { book_owner_id: w.a, kind: "booking", party_kind: "dmc", party_agency_id: w.a, debit: "0.00", credit: "230.00" }]);
  await pool.query("UPDATE agencies SET credit_limit_eur = 1 WHERE id = $1", [w.subA]);
  const waiting = await book(w.t.subA!);
  assert.equal(waiting.status, "awaiting_credit_approval");
  assert.equal((await lines(waiting.id)).length, 0, "no account entry without the DMC's approval");
});
