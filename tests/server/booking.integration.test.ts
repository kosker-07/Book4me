// Integration tests against a real PostgreSQL database with all server/migrations applied.
// Required: DATABASE_URL pointing to a THROWAWAY database (every test truncates all tables).
// In CI (CI=true) a missing DATABASE_URL is a failure, not a skip.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const DB_URL = process.env.DATABASE_URL;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "integration-test-secret-at-least-32-chars";
if (!DB_URL && process.env.CI) throw new Error("DATABASE_URL is required for integration tests in CI.");
const skip = DB_URL ? false : "DATABASE_URL not set; integration tests skipped locally";

// Fixed ids: rate plan ids are ordered so the deterministic tie-break (lowest id) is predictable.
const id = (prefix: string, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const M1 = id("a", 1), M2 = id("a", 2), SA = id("a", 3), SB = id("a", 4);
const H1 = id("c", 1), H2 = id("c", 2), R1 = id("d", 1), R2 = id("d", 2), RU = id("d", 3);
const RP1 = id("b", 1);   // H1/R1 AI EUR net 100 — winner for agency A
const RP2 = id("b", 2);   // H1/R1 AI EUR net 120 — equivalent, more expensive
const RP3 = id("b", 3);   // H1/R1 BB EUR net 80  — cheaper but NOT equivalent (different board)
const RPUSD = id("b", 4); // H1/RU AI USD net 50  — needs an exchange rate
const RPH2 = id("b", 5);  // H2/R2 AI EUR net 200 — other master agency's hotel

let server: Server, base = "", pool: any, hashPassword: (p: string) => string;
const tok: Record<string, string> = {};
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const CHECK_IN = day(30), NIGHT2 = day(31), CHECK_OUT = day(32);
const STAY = { checkIn: CHECK_IN, checkOut: CHECK_OUT, rooms: 1, adults: 2, children: 1, childAges: [5] };
const GUEST = { firstName: "Ali", lastName: "Veli", adults: 2, children: 1, childAges: [5], email: "ali@example.com", phone: "+90 555 111 22 33", nationality: "TR" };
const OP_NOTE = "Late arrival around 23:00";

async function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await res.text();
  let json: any = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { /* non-JSON */ }
  return { status: res.status, body: json, raw };
}
const search = (token: string, overrides: object = {}) => call("POST", "/api/agency/searches", { ...STAY, ...overrides }, token);
const book = (token: string, quoteId: string, key = randomUUID(), body: object = {}) =>
  call("POST", "/api/agency/bookings", { quoteId, guest: GUEST, operationNote: OP_NOTE, ...body }, token, { "Idempotency-Key": key });
const findResult = (results: any[], hotelId: string, board: string) => results.filter(r => r.hotel.id === hotelId && r.board === board);
async function winnerQuote(token: string, hotelId = H1, board = "AI") {
  const s = await search(token);
  assert.equal(s.status, 200, s.raw);
  const hits = findResult(s.body.results, hotelId, board);
  assert.equal(hits.length, 1, `expected exactly one ${board} result for hotel ${hotelId}`);
  return hits[0];
}
const reserved = async (ratePlanId: string) =>
  (await pool.query("SELECT stay_date::text AS d, reserved FROM inventory_daily WHERE rate_plan_id=$1 ORDER BY stay_date", [ratePlanId])).rows.map((r: any) => r.reserved);
const count = async (table: string) => (await pool.query(`SELECT count(*)::int AS c FROM ${table}`)).rows[0].c;
async function tableSnapshot() {
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")).rows.map((r: any) => r.tablename);
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t] = await count(t);
  const inventory = (await pool.query("SELECT id, rate_plan_id, stay_date::text, price::text, allotment, reserved FROM inventory_daily ORDER BY id")).rows;
  return { counts, inventory };
}

before(async () => {
  if (skip) return;
  ({ pool } = await import("../../server/db"));
  ({ hashPassword } = await import("../../server/security"));
  const { default: app } = await import("../../server/app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (skip) return;
  server.close();
  await pool.end();
});

beforeEach(async () => {
  if (skip) return;
  await pool.query(`TRUNCATE agencies, users, hotels, rooms, rate_plans, inventory_daily, agency_hotel_sales, bookings,
    booking_status_history, booking_nights, audit_logs, idempotency_keys, fx_rates, login_attempts, vouchers CASCADE`);
  await pool.query(`INSERT INTO agencies(id,name,type) VALUES ($1,'Master One','master'),($2,'Master Two','master'),($3,'Sub A','sub'),($4,'Sub B','sub')`, [M1, M2, SA, SB]);
  const pw = hashPassword("integration-password-1");
  const users: [string, string, string | null][] = [
    ["admin", "system_admin", null], ["bo", "back_office", null], ["m1", "master_agency", M1], ["m2", "master_agency", M2],
    ["a", "sub_agency", SA], ["b", "sub_agency", SB]
  ];
  for (const [name, role, agency] of users)
    await pool.query("INSERT INTO users(email,password_hash,role,agency_id) VALUES ($1,$2,$3,$4)", [`${name}@test.local`, pw, role, agency]);
  await pool.query(`INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ($1,$2,'Hotel One','Antalya','active'),($3,$4,'Hotel Two','Bodrum','active')`, [H1, M1, H2, M2]);
  await pool.query(`INSERT INTO rooms(id,hotel_id,name,max_adults,max_children) VALUES ($1,$2,'Double',2,2),($3,$4,'Double',2,2),($5,$2,'Suite',3,2)`, [R1, H1, R2, H2, RU]);
  await pool.query(`INSERT INTO rate_plans(id,room_id,board_name,currency,cancellation_policy) VALUES
    ($1,$6,'AI','EUR','{"freeUntilDays":7}'),($2,$6,'AI','EUR','{"freeUntilDays":7}'),($3,$6,'BB','EUR','{"freeUntilDays":7}'),
    ($4,$7,'AI','USD','{"freeUntilDays":7}'),($5,$8,'AI','EUR','{"freeUntilDays":7}')`, [RP1, RP2, RP3, RPUSD, RPH2, R1, RU, R2]);
  for (const [rp, net] of [[RP1, 100], [RP2, 120], [RP3, 80], [RPUSD, 50], [RPH2, 200]] as const)
    await pool.query("INSERT INTO inventory_daily(rate_plan_id,stay_date,price,allotment) VALUES ($1,$2,$4,5),($1,$3,$4,5)", [rp, CHECK_IN, NIGHT2, net]);
  const publish = (agency: string, hotel: string, rp: string, type: string, value: number) =>
    pool.query("INSERT INTO agency_hotel_sales(agency_id,hotel_id,rate_plan_id,markup_type,markup_value) VALUES ($1,$2,$3,$4,$5)", [agency, hotel, rp, type, value]);
  for (const rp of [RP1, RP2, RP3]) await publish(SA, H1, rp, "percent", 10);
  await publish(SA, H1, RPUSD, "percent", 10);
  await publish(SB, H1, RP1, "fixed", 5);
  await publish(SB, H2, RPH2, "percent", 0);
  for (const [name] of users) {
    const r = await call("POST", "/api/auth/login", { email: `${name}@test.local`, password: "integration-password-1" });
    assert.equal(r.status, 200, `login ${name}`);
    tok[name] = r.body.token;
  }
});

// ---------------------------------------------------------------- 1. search is read-only
test("01 search does not change inventory, bookings or any other table", { skip }, async () => {
  const before = await tableSnapshot();
  for (let i = 0; i < 3; i++) {
    const s = await search(tok.a!);
    assert.equal(s.status, 200, s.raw);
    assert.ok(s.body.results.length > 0);
  }
  assert.deepEqual(await tableSnapshot(), before);
});

test("01b hotel listing endpoint does not change inventory or bookings", { skip }, async () => {
  const before = await tableSnapshot();
  const r = await call("GET", "/api/agency/hotels", undefined, tok.a);
  assert.equal(r.status, 200);
  assert.deepEqual(await tableSnapshot(), before);
});

// ---------------------------------------------------------------- 2-5. atomic inventory
test("02 a missing inventory row returns 409 and changes nothing", { skip }, async () => {
  const q = await winnerQuote(tok.a!);
  await pool.query("DELETE FROM inventory_daily WHERE rate_plan_id=$1 AND stay_date=$2", [RP1, NIGHT2]);
  const r = await book(tok.a!, q.quoteId);
  assert.equal(r.status, 409, r.raw);
  assert.equal(r.body.error, "ALLOTMENT_UNAVAILABLE");
  assert.deepEqual(await reserved(RP1), [0]);
  assert.equal(await count("bookings"), 0);
});

test("03 concurrent bookings for the same dates never exceed allotment (5 rooms, 20 parallel requests)", { skip }, async () => {
  const q = await winnerQuote(tok.a!);
  const results = await Promise.all(Array.from({ length: 20 }, () => book(tok.a!, q.quoteId)));
  const statuses = results.map(r => r.status);
  assert.equal(statuses.filter(s => s === 201).length, 5, statuses.join(","));
  assert.equal(statuses.filter(s => s === 409).length, 15, statuses.join(","));
  assert.deepEqual(await reserved(RP1), [5, 5]);
  assert.equal(await count("bookings"), 5);
});

test("04 multi-night booking: failure on a later night rolls back earlier nights", { skip }, async () => {
  const q = await winnerQuote(tok.a!);
  await pool.query("UPDATE inventory_daily SET allotment=0 WHERE rate_plan_id=$1 AND stay_date=$2", [RP1, NIGHT2]);
  const r = await book(tok.a!, q.quoteId);
  assert.equal(r.status, 409);
  assert.deepEqual(await reserved(RP1), [0, 0]);
  assert.equal(await count("booking_nights"), 0);
});

test("05 parallel requests with the same Idempotency-Key create exactly one booking (no 500)", { skip }, async () => {
  const q = await winnerQuote(tok.a!), key = randomUUID();
  const results = await Promise.all(Array.from({ length: 10 }, () => book(tok.a!, q.quoteId, key)));
  assert.deepEqual(results.map(r => r.status), Array(10).fill(201), results.map(r => r.raw).join("\n"));
  assert.equal(new Set(results.map(r => r.body.id)).size, 1);
  assert.equal(await count("bookings"), 1);
  assert.deepEqual(await reserved(RP1), [1, 1]);
});

test("05b the same Idempotency-Key with a different payload is rejected with 422", { skip }, async () => {
  const q = await winnerQuote(tok.a!), key = randomUUID();
  assert.equal((await book(tok.a!, q.quoteId, key)).status, 201);
  const other = await book(tok.a!, q.quoteId, key, { operationNote: "Different note" });
  assert.equal(other.status, 422);
  assert.equal(await count("bookings"), 1);
});

test("05c legacy Idempotency-Key without request_hash (pre-002): matching retry replays, other content is 422, never a 2nd booking", { skip }, async () => {
  const q = await winnerQuote(tok.a!), key = randomUUID();
  const first = await book(tok.a!, q.quoteId, key);
  assert.equal(first.status, 201, first.raw);
  // Simulate a key stored before migration 002: fingerprint missing.
  await pool.query("UPDATE idempotency_keys SET request_hash = NULL WHERE key = $1", [key]);
  // Different content (another guest) under the legacy key → 422, nothing created, fingerprint still unbound.
  const other = await book(tok.a!, q.quoteId, key, { guest: { ...GUEST, firstName: "Başka" } });
  assert.equal(other.status, 422, other.raw);
  assert.equal(other.body.error, "IDEMPOTENCY_KEY_REUSED");
  assert.equal((await pool.query("SELECT request_hash FROM idempotency_keys WHERE key=$1", [key])).rows[0].request_hash, null);
  // Concurrent matching retries → the original booking is replayed, fingerprint bound once.
  const retries = await Promise.all(Array.from({ length: 5 }, () => book(tok.a!, q.quoteId, key)));
  assert.deepEqual(retries.map(r => r.status), Array(5).fill(201), retries.map(r => r.raw).join("\n"));
  assert.ok(retries.every(r => r.body.id === first.body.id));
  assert.notEqual((await pool.query("SELECT request_hash FROM idempotency_keys WHERE key=$1", [key])).rows[0].request_hash, null);
  // After binding, the normal rule applies.
  assert.equal((await book(tok.a!, q.quoteId, key, { operationNote: "Different note" })).status, 422);
  assert.equal(await count("bookings"), 1);
  assert.deepEqual(await reserved(RP1), [1, 1], "allotment decremented exactly once");
});

test("05d legacy key whose stored response has no booking id is refused (422), never re-executed", { skip }, async () => {
  const q = await winnerQuote(tok.a!), key = randomUUID();
  await pool.query("INSERT INTO idempotency_keys(agency_id, key, response, request_hash) VALUES ($1,$2,'{}'::jsonb,NULL)", [SA, key]);
  const r = await book(tok.a!, q.quoteId, key);
  assert.equal(r.status, 422, r.raw);
  assert.equal(await count("bookings"), 0);
  assert.deepEqual(await reserved(RP1), [0, 0]);
});

// ---------------------------------------------------------------- 6-12. authorization and cancellation
async function createBooking(token: string, hotelId = H1) {
  const q = await winnerQuote(token, hotelId);
  const r = await book(token, q.quoteId);
  assert.equal(r.status, 201, r.raw);
  return r.body.id as string;
}
const setStatus = (token: string, bookingId: string, status: string) =>
  call("PATCH", `/api/backoffice/bookings/${bookingId}/status`, { status }, token);

test("06 a sub-agency cannot read another agency's booking", { skip }, async () => {
  const bookingId = await createBooking(tok.a!);
  assert.equal((await call("GET", `/api/agency/bookings/${bookingId}`, undefined, tok.b)).status, 404);
  const list = await call("GET", "/api/agency/bookings", undefined, tok.b);
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 0);
  assert.equal((await call("GET", `/api/agency/bookings/${bookingId}`, undefined, tok.a)).status, 200);
});

test("07 a sub-agency cannot cancel another agency's booking", { skip }, async () => {
  const bookingId = await createBooking(tok.a!);
  const r = await call("POST", `/api/agency/bookings/${bookingId}/cancel`, {}, tok.b);
  assert.equal(r.status, 404);
  assert.equal((await pool.query("SELECT status FROM bookings WHERE id=$1", [bookingId])).rows[0].status, "pending");
  assert.deepEqual(await reserved(RP1), [1, 1]);
});

test("08 a master agency has no cancel right, even for its own hotel", { skip }, async () => {
  const bookingId = await createBooking(tok.a!);
  const r = await setStatus(tok.m1!, bookingId, "cancelled");
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "CANCEL_NOT_ALLOWED");
  assert.equal((await pool.query("SELECT status FROM bookings WHERE id=$1", [bookingId])).rows[0].status, "pending");
  assert.deepEqual(await reserved(RP1), [1, 1]);
});

test("09 Back Office works platform-wide: all hotels and all bookings across master agencies", { skip }, async () => {
  const onH1 = await createBooking(tok.a!, H1), onH2 = await createBooking(tok.b!, H2);
  const list = await call("GET", "/api/backoffice/bookings", undefined, tok.bo);
  assert.equal(list.status, 200);
  assert.deepEqual(new Set(list.body.items.map((x: any) => x.id)), new Set([onH1, onH2]));
  const hotels = await call("GET", "/api/backoffice/hotels", undefined, tok.bo);
  assert.deepEqual(new Set(hotels.body.items.map((x: any) => x.id)), new Set([H1, H2]));
  assert.equal((await call("GET", `/api/backoffice/bookings/${onH2}`, undefined, tok.bo)).status, 200);
  assert.equal((await setStatus(tok.bo!, onH2, "approved")).status, 200);
  const me = await call("GET", "/api/me", undefined, tok.bo);
  assert.equal(me.body.agencyId, null, "Back Office is not bound to an agency tenant");
});

test("10 users without platform-wide rights cannot see across tenants", { skip }, async () => {
  const onH1 = await createBooking(tok.a!, H1), onH2 = await createBooking(tok.b!, H2);
  const list = await call("GET", "/api/backoffice/bookings", undefined, tok.m1);
  assert.deepEqual(list.body.items.map((x: any) => x.id), [onH1]);
  assert.equal((await call("GET", `/api/backoffice/bookings/${onH2}`, undefined, tok.m1)).status, 404);
  assert.equal((await setStatus(tok.m1!, onH2, "approved")).status, 404);
  const hotels = await call("GET", "/api/backoffice/hotels", undefined, tok.m1);
  assert.deepEqual(hotels.body.items.map((x: any) => x.id), [H1]);
  for (const path of ["/api/backoffice/bookings", "/api/backoffice/hotels", `/api/backoffice/bookings/${onH1}`])
    assert.equal((await call("GET", path, undefined, tok.a)).status, 403, path);
});

test("11 an approved booking can be cancelled by Back Office or by the system administrator", { skip }, async () => {
  const first = await createBooking(tok.a!), second = await createBooking(tok.a!);
  for (const b of [first, second]) assert.equal((await setStatus(tok.bo!, b, "approved")).status, 200);
  assert.deepEqual(await reserved(RP1), [2, 2]);
  const byBo = await setStatus(tok.bo!, first, "cancelled");
  assert.equal(byBo.status, 200);
  assert.equal(byBo.body.previousStatus, "approved");
  const byAdmin = await setStatus(tok.admin!, second, "cancelled");
  assert.equal(byAdmin.status, 200);
  assert.deepEqual(await reserved(RP1), [0, 0]);
});

test("11b a sub-agency cannot cancel its own approved booking", { skip }, async () => {
  const bookingId = await createBooking(tok.a!);
  await setStatus(tok.bo!, bookingId, "approved");
  const r = await call("POST", `/api/agency/bookings/${bookingId}/cancel`, {}, tok.a);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "CANCEL_NOT_ALLOWED");
  assert.deepEqual(await reserved(RP1), [1, 1]);
});

test("12 cancellation and rejection return inventory exactly once", { skip }, async () => {
  // sub-agency cancels its own pending booking, twice
  const own = await createBooking(tok.a!);
  assert.equal((await call("POST", `/api/agency/bookings/${own}/cancel`, {}, tok.a)).status, 200);
  assert.equal((await call("POST", `/api/agency/bookings/${own}/cancel`, {}, tok.a)).status, 409);
  assert.deepEqual(await reserved(RP1), [0, 0]);
  // Back Office cancels an approved booking, twice
  const approved = await createBooking(tok.a!);
  await setStatus(tok.bo!, approved, "approved");
  assert.equal((await setStatus(tok.bo!, approved, "cancelled")).status, 200);
  assert.equal((await setStatus(tok.bo!, approved, "cancelled")).status, 409);
  assert.deepEqual(await reserved(RP1), [0, 0]);
  // rejection releases, and a rejected booking cannot be cancelled afterwards
  const rejected = await createBooking(tok.a!);
  assert.equal((await setStatus(tok.bo!, rejected, "rejected")).status, 200);
  assert.equal((await setStatus(tok.bo!, rejected, "cancelled")).status, 409);
  assert.deepEqual(await reserved(RP1), [0, 0]);
  // parallel double cancel releases once
  const racy = await createBooking(tok.a!);
  await setStatus(tok.bo!, racy, "approved");
  const both = await Promise.all([setStatus(tok.bo!, racy, "cancelled"), setStatus(tok.admin!, racy, "cancelled")]);
  assert.deepEqual(both.map(r => r.status).sort(), [200, 409]);
  assert.deepEqual(await reserved(RP1), [0, 0]);
  const history = (await pool.query("SELECT count(*)::int AS c FROM booking_status_history WHERE booking_id=$1 AND to_status='cancelled'", [racy])).rows[0].c;
  assert.equal(history, 1);
});

// ---------------------------------------------------------------- 13-16. lowest price, no fallback, equivalence, privacy
test("13 the lowest-priced equivalent offer wins and only one result is returned for it", { skip }, async () => {
  const w = await winnerQuote(tok.a!, H1, "AI");
  assert.equal(w.total, "220.00"); // RP1: (100 + 10%) x 2 nights; RP2 would be 264.00
  const r = await book(tok.a!, w.quoteId);
  assert.equal((await pool.query("SELECT rate_plan_id FROM bookings WHERE id=$1", [r.body.id])).rows[0].rate_plan_id, RP1);
});

test("13b equal prices are resolved deterministically (lowest rate plan id)", { skip }, async () => {
  await pool.query("UPDATE inventory_daily SET price=100 WHERE rate_plan_id=$1", [RP2]);
  for (let i = 0; i < 3; i++) {
    const w = await winnerQuote(tok.a!, H1, "AI");
    const r = await book(tok.a!, w.quoteId);
    assert.equal((await pool.query("SELECT rate_plan_id FROM bookings WHERE id=$1", [r.body.id])).rows[0].rate_plan_id, RP1);
  }
});

test("14 when the winning offer fails, the second offer is not tried", { skip }, async () => {
  const w = await winnerQuote(tok.a!, H1, "AI");
  await pool.query("UPDATE inventory_daily SET allotment=0 WHERE rate_plan_id=$1", [RP1]);
  const r = await book(tok.a!, w.quoteId);
  assert.equal(r.status, 409);
  assert.equal(await count("bookings"), 0);
  assert.deepEqual(await reserved(RP2), [0, 0], "the more expensive equivalent offer must stay untouched");
});

test("14b a price change after the search fails the booking instead of switching offers", { skip }, async () => {
  const w = await winnerQuote(tok.a!, H1, "AI");
  await pool.query("UPDATE inventory_daily SET price=101 WHERE rate_plan_id=$1", [RP1]);
  const r = await book(tok.a!, w.quoteId);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "PRICE_CHANGED");
  assert.deepEqual(await reserved(RP1), [0, 0]);
  assert.deepEqual(await reserved(RP2), [0, 0]);
});

test("15 equivalence: a cheaper offer with a different board does not replace the winner", { skip }, async () => {
  const s = await search(tok.a!);
  const ai = findResult(s.body.results, H1, "AI"), bb = findResult(s.body.results, H1, "BB");
  assert.equal(ai.length, 1);
  assert.equal(ai[0].total, "220.00");
  assert.equal(bb.length, 1);
  assert.equal(bb[0].total, "176.00"); // RP3: (80 + 10%) x 2 — separate equivalence class
});

test("15b an offer without an exchange rate is not evaluated; with a rate it is", { skip }, async () => {
  const suite = (results: any[]) => results.filter(r => r.room.name === "Suite");
  assert.equal(suite((await search(tok.a!)).body.results).length, 0);
  await pool.query("INSERT INTO fx_rates(currency, eur_per_unit, source) VALUES ('USD', 0.9, 'test')");
  const withRate = suite((await search(tok.a!)).body.results);
  assert.equal(withRate.length, 1);
  assert.equal(withRate[0].currency, "USD");
  assert.equal(withRate[0].total, "110.00"); // (50 + 10%) x 2 in USD
});

test("15c different sales conditions are separate products; conditions are not exposed (B4B-03)", { skip }, async () => {
  // RP2 (net 120) gets its own sales conditions: it no longer competes with RP1 (net 100) and is shown separately.
  await pool.query(`UPDATE rate_plans SET sales_conditions = '{"minStay": 2, "markets": ["UK"]}'::jsonb WHERE id = $1`, [RP2]);
  const s = await search(tok.a!);
  assert.equal(s.status, 200, s.raw);
  const ai = findResult(s.body.results, H1, "AI");
  assert.deepEqual(ai.map((r: any) => r.total).sort(), ["220.00", "264.00"], "both offers returned, each its own group");
  assert.ok(!s.raw.includes("minStay") && !s.raw.includes("markets"), "sales conditions are not leaked in the search response");
  // Same conditions on both (other key order): one group again, the cheaper one wins.
  await pool.query(`UPDATE rate_plans SET sales_conditions = '{"markets": ["UK"], "minStay": 2}'::jsonb WHERE id = $1`, [RP1]);
  const again = findResult((await search(tok.a!)).body.results, H1, "AI");
  assert.deepEqual(again.map((r: any) => r.total), ["220.00"]);
});

test("16 competitor offers and other agencies' data do not leak into a participant's response", { skip }, async () => {
  const a = await search(tok.a!);
  for (const secret of [RP1, RP2, RP3, RPUSD, M1, M2, SA, SB, "264.00", "\"net", "markup", "sell_price", "owner"])
    assert.ok(!a.raw.includes(secret), `agency A response leaks ${secret}`);
  const b = await search(tok.b!);
  const bWinner = findResult(b.body.results, H1, "AI");
  assert.equal(bWinner.length, 1);
  assert.equal(bWinner[0].total, "210.00"); // RP1 for B: (100 + 5 fixed) x 2
  for (const secret of ["220.00", "176.00", "BB", RP1, RP2, RP3])
    assert.ok(!b.raw.includes(secret), `agency B response leaks ${secret}`);
});

test("16b a sub-agency cannot book with another agency's quote", { skip }, async () => {
  const w = await winnerQuote(tok.a!);
  const r = await book(tok.b!, w.quoteId);
  assert.equal(r.status, 404);
  assert.equal(await count("bookings"), 0);
});

// ---------------------------------------------------------------- 17. guest validation
test("17 every mandatory guest field is validated by the backend", { skip }, async () => {
  const w = await winnerQuote(tok.a!);
  const cases: [string, object, string][] = [
    ["firstName", { guest: { ...GUEST, firstName: undefined } }, "guest.firstName"],
    ["lastName", { guest: { ...GUEST, lastName: " " } }, "guest.lastName"],
    ["adults", { guest: { ...GUEST, adults: undefined } }, "guest.adults"],
    ["children", { guest: { ...GUEST, children: undefined } }, "guest.children"],
    ["childAges", { guest: { ...GUEST, childAges: undefined } }, "guest.childAges"],
    ["childAges length", { guest: { ...GUEST, childAges: [5, 7] } }, "guest.childAges"],
    ["email", { guest: { ...GUEST, email: undefined } }, "guest.email"],
    ["email format", { guest: { ...GUEST, email: "not-an-email" } }, "guest.email"],
    ["phone", { guest: { ...GUEST, phone: undefined } }, "guest.phone"],
    ["nationality", { guest: { ...GUEST, nationality: undefined } }, "guest.nationality"],
    ["nationality format", { guest: { ...GUEST, nationality: "Turkey" } }, "guest.nationality"],
    ["operationNote", { operationNote: "" }, "operationNote"]
  ];
  for (const [label, body, field] of cases) {
    const r = await book(tok.a!, w.quoteId, randomUUID(), body);
    assert.equal(r.status, 400, `${label}: ${r.raw}`);
    assert.equal(r.body.error, "VALIDATION_FAILED");
    assert.ok(field in r.body.fields, `${label}: expected field error ${field}, got ${JSON.stringify(r.body.fields)}`);
  }
  assert.equal(await count("bookings"), 0);
  assert.deepEqual(await reserved(RP1), [0, 0]);
  const ok = await book(tok.a!, w.quoteId);
  assert.equal(ok.status, 201, ok.raw);
  const row = (await pool.query("SELECT guest_phone, guest_nationality, adults, children, child_ages, operation_note FROM bookings WHERE id=$1", [ok.body.id])).rows[0];
  assert.deepEqual(row, { guest_phone: "+90 555 111 22 33", guest_nationality: "TR", adults: 2, children: 1, child_ages: [5], operation_note: OP_NOTE });
});

test("17b booking occupancy must match the quoted occupancy", { skip }, async () => {
  const w = await winnerQuote(tok.a!);
  const r = await book(tok.a!, w.quoteId, randomUUID(), { guest: { ...GUEST, adults: 1 } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "QUOTE_OCCUPANCY_MISMATCH");
});

// ---------------------------------------------------------------- 18. price snapshot
test("18 the nightly price snapshot is not affected by later price or markup changes", { skip }, async () => {
  const w = await winnerQuote(tok.a!);
  const r = await book(tok.a!, w.quoteId);
  assert.equal(r.status, 201);
  await pool.query("UPDATE inventory_daily SET price=999 WHERE rate_plan_id=$1", [RP1]);
  await pool.query("UPDATE agency_hotel_sales SET markup_value=50 WHERE agency_id=$1 AND rate_plan_id=$2", [SA, RP1]);
  const detail = await call("GET", `/api/agency/bookings/${r.body.id}`, undefined, tok.a);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.total, "220.00");
  assert.deepEqual(detail.body.nights.map((n: any) => [n.date, n.sell_price]), [[CHECK_IN, "110.00"], [NIGHT2, "110.00"]]);
  const snap = (await pool.query("SELECT net_price::text, markup_type, markup_value::text FROM booking_nights WHERE booking_id=$1 ORDER BY stay_date", [r.body.id])).rows;
  assert.deepEqual(snap, [{ net_price: "100.00", markup_type: "percent", markup_value: "10.00" }, { net_price: "100.00", markup_type: "percent", markup_value: "10.00" }]);
});

// ---------------------------------------------------------------- input hardening
test("19 invalid ids and malformed input return 4xx, never 500", { skip }, async () => {
  assert.equal((await call("GET", "/api/agency/bookings/not-a-uuid", undefined, tok.a)).status, 404);
  assert.equal((await setStatus(tok.bo!, "not-a-uuid", "approved")).status, 404);
  assert.equal((await search(tok.a!, { checkIn: "2027-13-01" })).status, 400);
  assert.equal((await search(tok.a!, { checkIn: "2027-02-30" })).status, 400);
  assert.equal((await search(tok.a!, { checkIn: day(-1) })).status, 400);
  assert.equal((await book(tok.a!, "forged-quote")).status, 400);
  const res = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{bad" });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "INVALID_JSON" });
});
