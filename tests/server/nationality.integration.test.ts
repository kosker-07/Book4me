// Nationality-based contract pricing, FX, price snapshots and proformas — integration tests against real
// PostgreSQL with all migrations applied. Required: DATABASE_URL pointing to a THROWAWAY database.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const DB_URL = process.env.DATABASE_URL;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "integration-test-secret-at-least-32-chars";
if (!DB_URL && process.env.CI) throw new Error("DATABASE_URL is required for integration tests in CI.");
const skip = DB_URL ? false : "DATABASE_URL not set; integration tests skipped locally";
const hasPdftotext = spawnSync("pdftotext", ["-v"]).status === 0;

const id = (p: string, n: number) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const M1 = id("a", 1), M2 = id("a", 2), SA = id("a", 3), SB = id("a", 4);
const H1 = id("c", 1), H2 = id("c", 2), R1 = id("d", 1), R2 = id("d", 2);
const RP_GEN = id("b", 1), RP_TR = id("b", 2), RP_DACH = id("b", 3), RP_UK = id("b", 4), RP_H2 = id("b", 5);
const C_TR = id("e", 1), C_DACH = id("e", 2), C_UK = id("e", 3);
const G_DACH = id("f", 1);

let server: Server, base = "", pool: any, hashPassword: (p: string) => string;
const tok: Record<string, string> = {};
const day = (o: number) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
const IN = day(20), N2 = day(21), OUT = day(22);
const stay = (nationalities: string[], extra: object = {}) => ({ checkIn: IN, checkOut: OUT, rooms: 1, adults: 2, children: 0, childAges: [], roomOccupancies: [{ adults: 2, children: 0, childAges: [] }], nationalities, ...extra });

async function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const buf = Buffer.from(await res.arrayBuffer()), raw = buf.toString("utf8");
  let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch { /* binary */ }
  return { status: res.status, body: json, raw, buf, headers: res.headers };
}
const search = (nats: string[], extra: object = {}, token = tok.a!) => call("POST", "/api/agency/searches", stay(nats, extra), token);
const ai = (results: any[]) => results.filter((r: any) => r.hotel.id === H1 && r.board === "AI");
/** Books the single H1/AI winner for the given nationalities (lead guest gets the first nationality). */
async function bookFor(nats: string[], opts: { extra?: object; token?: string; searchExtra?: object; draft?: boolean } = {}) {
  const s = await search(nats, opts.searchExtra ?? {}, opts.token ?? tok.a!);
  assert.equal(s.status, 200, s.raw);
  const w = ai(s.body.results); assert.equal(w.length, 1, `one AI winner expected for ${nats}: ${s.raw}`);
  const lead = nats[0];
  const r = await call("POST", "/api/agency/bookings", {
    quoteId: w[0].quoteId, draft: opts.draft,
    guest: { firstName: "Lead", lastName: "Guest", adults: 2, children: 0, childAges: [], email: "lead@example.com", phone: "+90 555 000 11 22", nationality: lead },
    otherGuests: [{ firstName: "Second", lastName: "Guest", type: "adult", nationality: lead }],
    operationNote: "Note", ...(opts.extra ?? {})
  }, opts.token ?? tok.a!, { "Idempotency-Key": randomUUID() });
  return { search: w[0], booking: r };
}
const reserved = async (rp: string) => (await pool.query("SELECT reserved FROM inventory_daily WHERE rate_plan_id=$1 ORDER BY stay_date", [rp])).rows.map((r: any) => r.reserved);
const count = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0].c as number;

before(async () => {
  if (skip) return;
  ({ pool } = await import("../../server/db"));
  ({ hashPassword } = await import("../../server/security"));
  const { default: app } = await import("../../server/app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { if (skip) return; server.close(); await pool.end(); });

beforeEach(async () => {
  if (skip) return;
  await pool.query(`TRUNCATE agencies, users, hotels, rooms, rate_plans, inventory_daily, agency_hotel_sales, bookings, booking_status_history,
    booking_nights, audit_logs, idempotency_keys, fx_rates, login_attempts, vouchers, market_groups, fx_rate_history, proforma_counters CASCADE`);
  await pool.query("UPDATE currencies SET active = true");
  await pool.query("INSERT INTO agencies(id,name,type) VALUES ($1,'Master One','master'),($2,'Master Two','master'),($3,'Sub A','sub'),($4,'Sub B','sub')", [M1, M2, SA, SB]);
  const pw = hashPassword("integration-password-1");
  const users: [string, string, string | null][] = [["admin", "system_admin", null], ["bo", "back_office", null], ["m1", "master_agency", M1],
    ["m2", "master_agency", M2], ["a", "sub_agency", SA], ["b", "sub_agency", SB]];
  for (const [n, role, ag] of users) await pool.query("INSERT INTO users(email,password_hash,role,agency_id) VALUES ($1,$2,$3,$4)", [`${n}@test.local`, pw, role, ag]);
  await pool.query("INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ($1,$2,'Hotel One','Antalya','active'),($3,$4,'Hotel Two','Bodrum','active')", [H1, M1, H2, M2]);
  await pool.query("INSERT INTO rooms(id,hotel_id,name,max_adults,max_children) VALUES ($1,$2,'Double',3,2),($3,$4,'Double',3,2)", [R1, H1, R2, H2]);
  // Same room, board and policies → one equivalence class; each rate plan sits in a different contract.
  await pool.query(`INSERT INTO rate_plans(id,room_id,board_name,currency,cancellation_policy) VALUES
    ($1,$6,'AI','EUR','{"freeUntilDays":7}'),($2,$6,'AI','EUR','{"freeUntilDays":7}'),($3,$6,'AI','EUR','{"freeUntilDays":7}'),
    ($4,$6,'AI','GBP','{"freeUntilDays":7}'),($5,$7,'AI','EUR','{"freeUntilDays":7}')`, [RP_GEN, RP_TR, RP_DACH, RP_UK, RP_H2, R1, R2]);
  await pool.query(`INSERT INTO hotel_contracts(id,hotel_id,code,name,currency,seller_legal_name,status) VALUES
    ($1,$4,'TR-MARKET','Turkey market','EUR','Hotel One Turizm A.Ş.','active'),
    ($2,$4,'DACH-MARKET','DACH market','EUR','Hotel One Turizm A.Ş.','active'),
    ($3,$4,'UK-MARKET','UK market','GBP','Hotel One Turizm A.Ş.','active')`, [C_TR, C_DACH, C_UK, H1]);
  await pool.query("UPDATE hotel_contracts SET seller_legal_name='Hotel One Turizm A.Ş.' WHERE is_default");
  for (const [rp, c] of [[RP_TR, C_TR], [RP_DACH, C_DACH], [RP_UK, C_UK]]) await pool.query("UPDATE contract_rate_plans SET contract_id=$2 WHERE rate_plan_id=$1", [rp, c]);
  await pool.query("INSERT INTO market_groups(id,code,name) VALUES ($1,'DACH','Germany, Austria, Switzerland')", [G_DACH]);
  await pool.query("INSERT INTO market_group_members(group_id,country_code) VALUES ($1,'DE'),($1,'AT'),($1,'CH')", [G_DACH]);
  const gen = (await pool.query("SELECT contract_id FROM contract_rate_plans WHERE rate_plan_id=$1", [RP_GEN])).rows[0].contract_id;
  await pool.query(`INSERT INTO contract_nationality_rules(contract_id,rule_type,country_code,market_group_id) VALUES
    ($1,'exclude','RU',NULL), ($2,'include','TR',NULL), ($3,'include',NULL,$5), ($3,'exclude','CH',NULL), ($4,'include','GB',NULL)`,
    [gen, C_TR, C_DACH, C_UK, G_DACH]);
  for (const [rp, net] of [[RP_GEN, 100], [RP_TR, 90], [RP_DACH, 80], [RP_UK, 70], [RP_H2, 120]] as const)
    await pool.query("INSERT INTO inventory_daily(rate_plan_id,stay_date,price,allotment) VALUES ($1,$2,$4,5),($1,$3,$4,5)", [rp, IN, N2, net]);
  for (const rp of [RP_GEN, RP_TR, RP_DACH, RP_UK])
    await pool.query("INSERT INTO agency_hotel_sales(agency_id,hotel_id,rate_plan_id,markup_type,markup_value) VALUES ($1,$2,$3,'percent',0)", [SA, H1, rp]);
  await pool.query("INSERT INTO agency_hotel_sales(agency_id,hotel_id,rate_plan_id,markup_type,markup_value) VALUES ($1,$2,$3,'percent',0)", [SB, H2, RP_H2]);
  await pool.query("INSERT INTO fx_rates(currency,eur_per_unit,source) VALUES ('GBP',1.2,'test'),('JPY',0.0062,'test'),('KWD',3,'test'),('USD',0.9,'test')");
  for (const [n] of users) {
    const r = await call("POST", "/api/auth/login", { email: `${n}@test.local`, password: "integration-password-1" });
    assert.equal(r.status, 200); tok[n] = r.body.token;
  }
});

// ---------------------------------------------------------------- eligibility and lowest price
test("N01 nationality is required: missing → 400 NATIONALITY_REQUIRED; wrong count or unknown code → 400", { skip }, async () => {
  const r = await call("POST", "/api/agency/searches", { checkIn: IN, checkOut: OUT, rooms: 1, adults: 2, children: 0, childAges: [], roomOccupancies: [{ adults: 2, children: 0, childAges: [] }] }, tok.a);
  assert.deepEqual([r.status, r.body.error], [400, "NATIONALITY_REQUIRED"]);
  assert.equal((await search(["TR"], { adults: 2, roomOccupancies: [{ adults: 2, children: 0, childAges: [] }] })).status, 200);
  assert.equal((await search(["TR", "XX"])).status, 400);
  assert.equal((await search(["TR", "Turkey"])).status, 400);
});

test("N02 exact inclusion: Turkish guests get the TR contract (cheapest eligible)", { skip }, async () => {
  const w = ai((await search(["TR"])).body.results);
  assert.equal(w.length, 1);
  assert.deepEqual([w[0].total, w[0].currency], ["180.00", "EUR"]); // TR 90 < general 100
});

test("N03 group inclusion: German guests get the DACH contract", { skip }, async () => {
  assert.equal(ai((await search(["DE"])).body.results)[0].total, "160.00");
});

test("N04 exclusion overrides inclusion: Swiss guests are excluded from DACH although CH is in the group", { skip }, async () => {
  const w = ai((await search(["CH"])).body.results);
  assert.equal(w.length, 1);
  assert.equal(w[0].total, "200.00"); // only the general contract remains
});

test("N05 no silent fallback: an excluded nationality with no other eligible contract gets no offer at all", { skip }, async () => {
  const s = await search(["RU"]);
  assert.equal(s.status, 200);
  assert.equal(ai(s.body.results).length, 0);
  for (const price of ["180.00", "160.00", "200.00", "140.00"]) assert.ok(!s.raw.includes(price), `must not show ${price}`);
});

test("N06 contract currency: British guests get the GBP contract when it is cheapest in EUR terms", { skip }, async () => {
  const w = ai((await search(["GB"])).body.results)[0];
  assert.deepEqual([w.total, w.currency], ["140.00", "GBP"]); // 140 GBP = 168 EUR < 200 EUR general
});

test("N07 precedence decides eligibility only: a cheaper general contract beats a more specific one", { skip }, async () => {
  await pool.query("UPDATE inventory_daily SET price=50 WHERE rate_plan_id=$1", [RP_GEN]);
  const w = ai((await search(["TR"])).body.results);
  assert.equal(w.length, 1);
  assert.equal(w[0].total, "100.00");
});

test("N08a excluded family nationality is not offered; eligible TR contract remains", { skip }, async () => {
  const s = await search(["TR"]);
  assert.equal(s.status, 200, s.raw);
  const offers = ai(s.body.results);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].total, "180.00");
  await pool.query("INSERT INTO contract_nationality_rules(contract_id,rule_type,country_code) VALUES ($1,'exclude','TR')", [C_TR]);
  const after = await search(["TR"]);
  assert.equal(after.status, 200, after.raw);
  assert.equal(ai(after.body.results)[0].total, "200.00");
});

test("N08b multiple nationalities are rejected for a single family", { skip }, async () => {
  const r = await search(["TR", "DE"]);
  assert.equal(r.status, 400, r.raw);
  assert.equal(r.body.details?.nationalities ?? r.body.fields?.nationalities ?? r.body.errors?.nationalities, "ONE_NATIONALITY_PER_FAMILY");
});

test("N08c omitted secondary nationality is stored as the family nationality", { skip }, async () => {
  const s = await search(["TR"]);
  const q = ai(s.body.results)[0];
  const b = await call("POST", "/api/agency/bookings", {
    quoteId: q.quoteId,
    guest: { firstName: "Lead", lastName: "Guest", adults: 2, children: 0, childAges: [], email: "lead@example.com", phone: "+90 555 000 11 22", nationality: "TR" },
    otherGuests: [{ firstName: "Second", lastName: "Guest", type: "adult" }],
    operationNote: "Note"
  }, tok.a, { "Idempotency-Key": randomUUID() });
  assert.equal(b.status, 201, b.raw);
  const detail = await call("GET", `/api/agency/bookings/${b.body.id}`, undefined, tok.a);
  assert.deepEqual(detail.body.guests.map((g: any) => g.nationality.trim()), ["TR", "TR"]);
  assert.deepEqual(detail.body.priceSnapshot.nationalities.map((n: string) => n.trim()), ["TR"]);
});

test("N08 family nationality: one code covers two guests; mismatched lead is rejected", { skip }, async () => {
  const w = ai((await search(["DE"])).body.results);
  assert.equal(w.length, 1);
  assert.equal(w[0].total, "160.00");
  const mismatch = await call("POST", "/api/agency/bookings", {
    quoteId: w[0].quoteId,
    guest: { firstName: "L", lastName: "G", adults: 2, children: 0, childAges: [], email: "l@example.com", phone: "+90 555 000 11 22", nationality: "TR" },
    otherGuests: [{ firstName: "X", lastName: "G", type: "adult", nationality: "RU" }], operationNote: "n"
  }, tok.a, { "Idempotency-Key": randomUUID() });
  assert.deepEqual([mismatch.status, mismatch.body.error], [409, "QUOTE_NATIONALITY_MISMATCH"]);
  assert.equal(await count("SELECT count(*)::int AS c FROM bookings"), 0);
  const accepted = await call("POST", "/api/agency/bookings", {
    quoteId: w[0].quoteId,
    guest: { firstName: "L", lastName: "G", adults: 2, children: 0, childAges: [], email: "l@example.com", phone: "+90 555 000 11 22", nationality: "DE" },
    otherGuests: [{ firstName: "X", lastName: "G", type: "adult", nationality: "RU" }], operationNote: "n"
  }, tok.a, { "Idempotency-Key": randomUUID() });
  assert.equal(accepted.status, 201, accepted.raw);
});

test("N09 eligibility changed after the quote → 409 at booking, no other contract is tried", { skip }, async () => {
  const s = await search(["DE"]);
  await pool.query("INSERT INTO contract_nationality_rules(contract_id,rule_type,country_code) VALUES ($1,'exclude','DE')", [C_DACH]);
  const w = ai(s.body.results)[0];
  const r = await call("POST", "/api/agency/bookings", {
    quoteId: w.quoteId,
    guest: { firstName: "L", lastName: "G", adults: 2, children: 0, childAges: [], email: "l@example.com", phone: "+90 555 000 11 22", nationality: "DE" },
    otherGuests: [{ firstName: "X", lastName: "G", type: "adult", nationality: "DE" }], operationNote: "n"
  }, tok.a, { "Idempotency-Key": randomUUID() });
  assert.deepEqual([r.status, r.body.error], [409, "NATIONALITY_NOT_ELIGIBLE"]);
  assert.deepEqual(await reserved(RP_DACH), [0, 0]);
  assert.deepEqual(await reserved(RP_GEN), [0, 0], "the general contract must not be used as a fallback");
  assert.equal(await count("SELECT count(*)::int AS c FROM bookings"), 0);
});

test("N10 contract validity must cover every night; an inactive contract fails the booking", { skip }, async () => {
  await pool.query("UPDATE hotel_contracts SET valid_to=$2 WHERE id=$1", [C_TR, IN]); // covers only the first night
  assert.equal(ai((await search(["TR"])).body.results)[0].total, "200.00");
  await pool.query("UPDATE hotel_contracts SET valid_to=NULL WHERE id=$1", [C_TR]);
  const s = await search(["TR"]);
  await pool.query("UPDATE hotel_contracts SET status='inactive' WHERE id=$1", [C_TR]);
  const w = ai(s.body.results)[0];
  const r = await call("POST", "/api/agency/bookings", {
    quoteId: w.quoteId, guest: { firstName: "L", lastName: "G", adults: 2, children: 0, childAges: [], email: "l@example.com", phone: "+90 555 000 11 22", nationality: "TR" },
    otherGuests: [{ firstName: "X", lastName: "G", type: "adult", nationality: "TR" }], operationNote: "n"
  }, tok.a, { "Idempotency-Key": randomUUID() });
  assert.deepEqual([r.status, r.body.error], [409, "CONTRACT_NOT_AVAILABLE"]);
  assert.deepEqual(await reserved(RP_GEN), [0, 0]);
});

// ---------------------------------------------------------------- FX
test("N11 missing or stale FX rate excludes the offer (not treated as rate 1)", { skip }, async () => {
  await pool.query("DELETE FROM fx_rates WHERE currency='GBP'");
  assert.deepEqual(ai((await search(["GB"])).body.results).map((w: any) => [w.total, w.currency]), [["200.00", "EUR"]]);
  await pool.query("INSERT INTO fx_rates(currency,eur_per_unit,source,valid_at) VALUES ('GBP',1.2,'test', now() - interval '100 hours')");
  assert.deepEqual(ai((await search(["GB"])).body.results).map((w: any) => w.currency), ["EUR"]);
});

test("N12 FX rate changed between quote and booking → 409 PRICE_CHANGED (FX_RATE_CHANGED), nothing reserved", { skip }, async () => {
  const bookQuote = (quoteId: string, nat: string) => call("POST", "/api/agency/bookings", {
    quoteId, guest: { firstName: "L", lastName: "G", adults: 2, children: 0, childAges: [], email: "l@example.com", phone: "+90 555 000 11 22", nationality: nat },
    otherGuests: [{ firstName: "X", lastName: "G", type: "adult", nationality: nat }], operationNote: "n"
  }, tok.a, { "Idempotency-Key": randomUUID() });
  const expectFxChanged = async (r: any, label: string) =>
    assert.deepEqual([r.status, r.body.error, r.body.reason], [409, "PRICE_CHANGED", "FX_RATE_CHANGED"], label);
  // (a) contract currency GBP, paid in GBP
  const a = ai((await search(["GB"])).body.results)[0];
  // (b) contract currency GBP, paid in EUR: only the contract-currency rate can detect the change
  const b = ai((await search(["GB"], { paymentCurrency: "EUR" })).body.results)[0];
  await pool.query("UPDATE fx_rates SET eur_per_unit=1.21, valid_at=now() WHERE currency='GBP'");
  await expectFxChanged(await bookQuote(a.quoteId, "GB"), "GBP paid in GBP");
  await expectFxChanged(await bookQuote(b.quoteId, "GB"), "GBP paid in EUR (contract-currency rate changed)");
  assert.deepEqual(await reserved(RP_UK), [0, 0]);
  // (c) contract currency EUR, paid in USD: only the payment-currency rate can detect the change
  const c = ai((await search(["TR"], { paymentCurrency: "USD" })).body.results)[0];
  await pool.query("UPDATE fx_rates SET eur_per_unit=0.91, valid_at=now() WHERE currency='USD'");
  await expectFxChanged(await bookQuote(c.quoteId, "TR"), "EUR paid in USD (payment-currency rate changed)");
  assert.deepEqual(await reserved(RP_TR), [0, 0]);
  assert.equal(await count("SELECT count(*)::int AS c FROM bookings"), 0);
});

test("N13 payment currency conversion and the immutable snapshot (contract, nationalities, FX)", { skip }, async () => {
  const { booking, search: q } = await bookFor(["GB"], { searchExtra: { paymentCurrency: "EUR" } });
  assert.deepEqual(q.payment, { currency: "EUR", total: "168.00" });
  assert.equal(booking.status, 201, booking.raw);
  assert.deepEqual(booking.body.payment, { currency: "EUR", total: "168.00" });
  const before = await call("GET", `/api/agency/bookings/${booking.body.id}`, undefined, tok.a);
  // later changes of contract rules, prices, markup and FX
  await pool.query("INSERT INTO contract_nationality_rules(contract_id,rule_type,country_code) VALUES ($1,'exclude','GB')", [C_UK]);
  await pool.query("UPDATE inventory_daily SET price=999 WHERE rate_plan_id=$1", [RP_UK]);
  await pool.query("UPDATE agency_hotel_sales SET markup_value=50 WHERE rate_plan_id=$1", [RP_UK]);
  await pool.query("UPDATE fx_rates SET eur_per_unit=2, valid_at=now() WHERE currency='GBP'");
  await pool.query("UPDATE hotel_contracts SET seller_legal_name='Changed Ltd' WHERE id=$1", [C_UK]);
  const afterChanges = await call("GET", `/api/agency/bookings/${booking.body.id}`, undefined, tok.a);
  assert.deepEqual(afterChanges.body.priceSnapshot, before.body.priceSnapshot);
  const snap = afterChanges.body.priceSnapshot;
  assert.equal(snap.contract_code, "UK-MARKET");
  assert.deepEqual(snap.nationalities.map((x: string) => x.trim()), ["GB"]);
  assert.deepEqual([snap.total, snap.contract_currency, snap.eur_per_unit, snap.payment_amount, snap.payment_currency], ["140.00", "GBP", "1.20000000", "168.00", "EUR"]);
  assert.equal(snap.seller_legal_name, "Hotel One Turizm A.Ş.");
  assert.equal(afterChanges.body.total, "140.00");
  assert.deepEqual(afterChanges.body.guests.map((g: any) => g.nationality.trim()), ["GB", "GB"]);
  await assert.rejects(pool.query("UPDATE booking_price_snapshots SET total = 1"), /immutable/);
  await assert.rejects(pool.query("UPDATE booking_guests SET nationality = 'TR'"), /immutable/);
});

test("N14 payment currency must be allow-listed, active and have a fresh rate", { skip }, async () => {
  assert.deepEqual([(await search(["TR"], { paymentCurrency: "XYZ" })).body.error], ["PAYMENT_CURRENCY_NOT_SUPPORTED"]);
  await pool.query("UPDATE currencies SET active=false WHERE code='USD'");
  assert.equal((await search(["TR"], { paymentCurrency: "USD" })).status, 400);
  await pool.query("UPDATE currencies SET active=true WHERE code='USD'");
  await pool.query("DELETE FROM fx_rates WHERE currency='USD'");
  const r = await search(["TR"], { paymentCurrency: "USD" });
  assert.deepEqual([r.status, r.body.error], [409, "FX_RATE_UNAVAILABLE"]);
});

test("N15 minor units: JPY (0), EUR (2) and KWD (3) prices, markups and conversions round half-up correctly", { skip }, async () => {
  // management API enforces precision per currency
  const room = (await call("POST", `/api/admin/hotels/${H1}/rooms`, { name: "Suite", maxAdults: 2, maxChildren: 0 }, tok.m1)).body.id;
  const jpy = (await call("POST", `/api/admin/rooms/${room}/rate-plans`, { boardName: "RO", currency: "JPY" }, tok.m1)).body.id;
  const kwd = (await call("POST", `/api/admin/rooms/${room}/rate-plans`, { boardName: "HB", currency: "KWD" }, tok.m1)).body.id;
  const eur = (await call("POST", `/api/admin/rooms/${room}/rate-plans`, { boardName: "BB", currency: "EUR" }, tok.m1)).body.id;
  const cal = (rp: string, price: number) => call("PUT", `/api/admin/rate-plans/${rp}/calendar`, { dateFrom: IN, dateTo: N2, price, allotment: 3 }, tok.m1);
  assert.equal((await cal(jpy, 10000.5)).status, 400);
  assert.equal((await cal(eur, 100.123)).status, 400);
  assert.equal((await cal(kwd, 33.3335)).status, 400);
  assert.equal((await cal(jpy, 10001)).body.price, "10001");
  assert.equal((await cal(kwd, 33.333)).body.price, "33.333");
  assert.equal((await cal(eur, 100.5)).body.price, "100.50");
  for (const rp of [jpy, kwd, eur]) assert.equal((await call("POST", "/api/admin/publications", { ratePlanId: rp, agencyId: SA, markupType: "percent", markupValue: 10 }, tok.m1)).status, 201);
  assert.equal((await call("POST", "/api/admin/publications", { ratePlanId: jpy, agencyId: SB, markupType: "fixed", markupValue: 0.5 }, tok.m1)).status, 400, "fixed JPY markup has no decimals");
  const results = (await search(["TR"], { paymentCurrency: "JPY" })).body.results.filter((r: any) => r.room.name === "Suite");
  const by = Object.fromEntries(results.map((r: any) => [r.board, r]));
  assert.equal(by.RO.total, "22002");             // 10001 × 1.10 = 11001.1 → 11001 per night × 2
  assert.equal(by.HB.total, "73.332");            // 33.333 × 1.10 = 36.6663 → 36.666 × 2
  assert.equal(by.BB.total, "221.10");            // 100.50 × 1.10 = 110.55 × 2
  assert.equal(by.BB.payment.total, "35661");     // 221.10 EUR / 0.0062 = 35661.29 JPY → 35661
  assert.equal(by.HB.payment.total, "35483");     // 73.332 KWD × 3 / 0.0062 = 35483.22 JPY → 35483
});

// ---------------------------------------------------------------- drafts and proformas
test("N16 draft: full snapshot at creation, eligibility re-checked at submission", { skip }, async () => {
  const { booking } = await bookFor(["DE"], { draft: true });
  assert.equal(booking.status, 201, booking.raw);
  assert.equal(await count("SELECT count(*)::int AS c FROM booking_price_snapshots WHERE booking_id=$1", [booking.body.id]), 1);
  assert.deepEqual(await reserved(RP_DACH), [0, 0]);
  await pool.query("INSERT INTO contract_nationality_rules(contract_id,rule_type,country_code) VALUES ($1,'exclude','DE')", [C_DACH]);
  const r = await call("POST", `/api/agency/bookings/${booking.body.id}/submit`, {}, tok.a);
  assert.deepEqual([r.status, r.body.error], [409, "NATIONALITY_NOT_ELIGIBLE"]);
  assert.equal((await pool.query("SELECT status FROM bookings WHERE id=$1", [booking.body.id])).rows[0].status, "draft");
  assert.deepEqual(await reserved(RP_DACH), [0, 0]);
});

test("N17 proforma: pending/approved only, numbered, stored once, from the snapshot, not a tax invoice", { skip }, async () => {
  const draft = (await bookFor(["GB"], { draft: true, searchExtra: { paymentCurrency: "EUR" } })).booking.body.id;
  assert.equal((await call("GET", `/api/agency/bookings/${draft}/proforma`, undefined, tok.a)).status, 409, "no proforma for a draft");
  const id1 = (await bookFor(["GB"], { searchExtra: { paymentCurrency: "EUR" } })).booking.body.id;
  const first = await call("GET", `/api/agency/bookings/${id1}/proforma`, undefined, tok.a);
  assert.equal(first.status, 201);
  assert.equal(first.headers.get("content-type"), "application/pdf");
  const year = new Date().getUTCFullYear();
  assert.equal(first.headers.get("x-proforma-number"), `PF-${year}-000001`);
  const again = await call("GET", `/api/agency/bookings/${id1}/proforma`, undefined, tok.a);
  assert.deepEqual([again.status, again.headers.get("x-proforma-number"), again.headers.get("x-proforma-sha256")],
                   [200, `PF-${year}-000001`, first.headers.get("x-proforma-sha256")]);
  await pool.query("UPDATE fx_rates SET eur_per_unit=5, valid_at=now() WHERE currency='GBP'"); // later FX change
  const row = (await pool.query("SELECT payment_amount::text AS p, contract_amount::text AS c FROM proformas WHERE booking_id=$1", [id1])).rows[0];
  assert.deepEqual(row, { p: "168.00", c: "140.00" });
  if (hasPdftotext) {
    const dir = mkdtempSync(join(tmpdir(), "proforma-")), file = join(dir, "p.pdf"); writeFileSync(file, first.buf);
    const text = execFileSync("pdftotext", ["-layout", file, "-"]).toString("utf8").replace(/\s+/g, " ");
    for (const s of ["PROFORMA", "Not a tax invoice", "Vergi faturası değildir", `PF-${year}-000001`, "Hotel One Turizm A.Ş.", "140.00 GBP", "168.00 EUR", "UK-MARKET", "Lead Guest (yetişkin/adult, GB)", "half-up"])
      assert.ok(text.includes(s), `proforma must contain "${s}"; got ${text}`);
  }
  // access scope
  assert.equal((await call("GET", `/api/agency/bookings/${id1}/proforma`, undefined, tok.b)).status, 404);
  assert.equal((await call("GET", `/api/backoffice/bookings/${id1}/proforma`, undefined, tok.m2)).status, 404);
  assert.equal((await call("GET", `/api/backoffice/bookings/${id1}/proforma`, undefined, tok.bo)).status, 200);
  // reissue: Back Office only, new number and version, linked
  assert.equal((await call("POST", `/api/backoffice/bookings/${id1}/proforma/reissue`, { reason: "x" }, tok.m1)).status, 403);
  assert.equal((await call("POST", `/api/backoffice/bookings/${id1}/proforma/reissue`, {}, tok.bo)).status, 400);
  const re = await call("POST", `/api/backoffice/bookings/${id1}/proforma/reissue`, { reason: "Legal footer correction" }, tok.bo);
  assert.deepEqual([re.status, re.headers.get("x-proforma-number")], [201, `PF-${year}-000002`]);
  const list = await call("GET", `/api/backoffice/bookings/${id1}/proformas`, undefined, tok.bo);
  assert.deepEqual(list.body.items.map((p: any) => [p.number, p.version, p.payment_amount]), [[`PF-${year}-000001`, 1, "168.00"], [`PF-${year}-000002`, 2, "168.00"]]);
  await assert.rejects(pool.query("UPDATE proformas SET payment_amount = 1"), /immutable/);
  // cancelled booking: no proforma any more
  await call("PATCH", `/api/backoffice/bookings/${id1}/status`, { status: "cancelled" }, tok.bo);
  assert.equal((await call("GET", `/api/agency/bookings/${id1}/proforma`, undefined, tok.a)).status, 409);
});

test("N18 proforma numbering is sequential and collision-free under concurrency", { skip }, async () => {
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) ids.push((await bookFor(["TR"])).booking.body.id);
  const all = await Promise.all([...ids, ...ids].map(b => call("GET", `/api/agency/bookings/${b}/proforma`, undefined, tok.a)));
  assert.ok(all.every(r => r.status === 200 || r.status === 201), all.map(r => r.status).join(","));
  const numbers = (await pool.query("SELECT number FROM proformas ORDER BY number")).rows.map((r: any) => r.number);
  const year = new Date().getUTCFullYear();
  assert.deepEqual(numbers, [1, 2, 3, 4].map(n => `PF-${year}-${String(n).padStart(6, "0")}`), "one proforma per booking, consecutive numbers");
});

// ---------------------------------------------------------------- read-only search, authorization, audit, reference data
test("N19 a nationality search with rules and FX still writes nothing", { skip }, async () => {
  const snapshot = async () => {
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")).rows.map((r: any) => r.tablename);
    const counts: Record<string, number> = {};
    for (const t of tables) counts[t] = await count(`SELECT count(*)::int AS c FROM ${t}`);
    return { counts, inv: (await pool.query("SELECT id, reserved, allotment FROM inventory_daily ORDER BY id")).rows };
  };
  const before = await snapshot();
  for (const n of [["TR"], ["DE"], ["GB"], ["RU"]]) assert.equal((await search(n, { paymentCurrency: "USD" })).status, 200);
  assert.deepEqual(await snapshot(), before);
});

test("N20 authorization matrix for contract, rule, market group, currency and FX management", { skip }, async () => {
  const contract = { code: "SPRING", name: "Spring", currency: "EUR", sellerLegalName: "Hotel One Turizm A.Ş.", status: "active" };
  assert.equal((await call("POST", `/api/admin/hotels/${H1}/contracts`, contract, tok.a)).status, 403);
  assert.equal((await call("POST", `/api/admin/hotels/${H1}/contracts`, contract, tok.m2)).status, 404);
  const created = await call("POST", `/api/admin/hotels/${H1}/contracts`, contract, tok.m1);
  assert.equal(created.status, 201, created.raw);
  assert.equal((await call("POST", `/api/admin/hotels/${H2}/contracts`, { ...contract, code: "X" }, tok.bo)).status, 201, "Back Office is platform-wide");
  const rule = { ruleType: "include", countryCode: "TR" };
  assert.equal((await call("POST", `/api/admin/contracts/${C_TR}/nationality-rules`, rule, tok.m2)).status, 404);
  assert.equal((await call("POST", `/api/admin/contracts/${C_TR}/nationality-rules`, { ruleType: "include", countryCode: "TR", marketGroupId: G_DACH }, tok.m1)).status, 400);
  assert.equal((await call("POST", `/api/admin/contracts/${created.body.id}/nationality-rules`, { ruleType: "exclude", countryCode: "IR" }, tok.m1)).status, 201);
  assert.equal((await call("GET", `/api/admin/contracts/${C_DACH}/eligibility?nationalities=DE,CH`, undefined, tok.m1)).body.matches
    .map((m: any) => [m.nationality, m.reason]).join(";"), "DE,GROUP;CH,EXCLUDED");
  assert.equal((await call("POST", "/api/admin/market-groups", { code: "NORDIC", name: "Nordic", countries: ["SE", "NO"] }, tok.m1)).status, 403);
  assert.equal((await call("GET", "/api/admin/market-groups", undefined, tok.m1)).status, 200);
  assert.equal((await call("POST", "/api/admin/market-groups", { code: "NORDIC", name: "Nordic", countries: ["SE", "NO", "XX"] }, tok.bo)).status, 400);
  assert.equal((await call("POST", "/api/admin/market-groups", { code: "NORDIC", name: "Nordic", countries: ["SE", "NO"] }, tok.bo)).status, 201);
  assert.equal((await call("PATCH", "/api/admin/currencies/CHF", { active: false }, tok.bo)).status, 403);
  assert.equal((await call("PATCH", "/api/admin/currencies/CHF", { active: false }, tok.admin)).status, 200);
  assert.equal((await call("PATCH", "/api/admin/currencies/EUR", { active: false }, tok.admin)).status, 400);
  assert.equal((await call("POST", "/api/admin/fx-rates", { source: "Central bank", rates: [{ currency: "AED", eurPerUnit: 0.25 }] }, tok.m1)).status, 403);
  assert.equal((await call("POST", "/api/admin/fx-rates", { source: "Central bank", rates: [{ currency: "EUR", eurPerUnit: 1 }] }, tok.bo)).status, 400);
  const fx = await call("POST", "/api/admin/fx-rates", { source: "Central bank", rates: [{ currency: "AED", eurPerUnit: 0.25 }] }, tok.bo);
  assert.equal(fx.status, 201);
  assert.ok(fx.body.items[0].history_id);
  for (const path of [`/api/admin/contracts/${C_TR}`, "/api/admin/currencies", "/api/admin/fx-rates"])
    assert.equal((await call("GET", path, undefined, tok.a)).status, 403, path);
  // moving a rate plan between contracts: same hotel and currency only
  assert.equal((await call("POST", `/api/admin/contracts/${C_TR}/rate-plans`, { ratePlanId: RP_UK }, tok.m1)).status, 400, "GBP plan into EUR contract");
  assert.equal((await call("POST", `/api/admin/contracts/${C_TR}/rate-plans`, { ratePlanId: RP_H2 }, tok.bo)).status, 400, "plan of another hotel");
  const moved = await call("POST", `/api/admin/contracts/${C_TR}/rate-plans`, { ratePlanId: RP_DACH }, tok.m1);
  assert.deepEqual([moved.status, moved.body.previousContractId], [200, C_DACH]);
});

test("N21 audit: contract changes record before/after, IP and the request id", { skip }, async () => {
  const r = await call("PATCH", `/api/admin/contracts/${C_TR}`, { status: "inactive" }, tok.m1, { "X-Request-Id": "req-n21-test" });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-request-id"), "req-n21-test");
  const row = (await pool.query("SELECT before, after, ip, request_id FROM audit_logs WHERE action='contract.updated' AND entity_id=$1", [C_TR])).rows[0];
  assert.deepEqual([row.before.status, row.after.status, row.request_id], ["active", "inactive", "req-n21-test"]);
  assert.ok(row.ip);
  await assert.rejects(pool.query("UPDATE audit_logs SET action='x'"), /append-only/);
  await assert.rejects(pool.query("DELETE FROM audit_logs"), /append-only/);
});

test("N22 reference data in the database matches server/reference.ts; contract currency must match its rate plans", { skip }, async () => {
  const { COUNTRY_CODES, CURRENCIES } = await import("../../server/reference");
  const countries = (await pool.query("SELECT code FROM countries ORDER BY code")).rows.map((r: any) => r.code);
  assert.deepEqual(countries, [...COUNTRY_CODES]);
  const currencies = (await pool.query("SELECT code, minor_units FROM currencies ORDER BY code")).rows.map((r: any) => [r.code, r.minor_units]);
  assert.deepEqual(currencies, Object.entries(CURRENCIES).map(([c, v]) => [c, v.minorUnits]).sort());
  assert.ok(currencies.length >= 25);
  await assert.rejects(pool.query("UPDATE rate_plans SET currency='USD' WHERE id=$1", [RP_TR]), /contract currency/);
  await assert.rejects(pool.query("UPDATE hotel_contracts SET currency='USD' WHERE id=$1", [C_TR]), /cannot change/);
});

test("N23 migration runner: fresh database, idempotent second run, modified migration refused", { skip }, async () => {
  const { migrate } = await import("../../server/migrate");
  const { Client } = await import("pg");
  const name = `bed4book_runner_${process.pid}`;
  const admin = new Client({ connectionString: DB_URL }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`); await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(DB_URL!); u.pathname = `/${name}`;
  try {
    const quiet = { log: () => undefined };
    const first = await migrate(u.toString(), quiet);
    assert.ok(first.applied.length >= 6 && first.applied[0] === "001_initial.sql");
    assert.deepEqual((await migrate(u.toString(), quiet)).applied, []);
    const c = new Client({ connectionString: u.toString() }); await c.connect();
    await c.query("UPDATE schema_migrations SET sha256='tampered' WHERE name='002_v1_product_rules.sql'"); await c.end();
    await assert.rejects(migrate(u.toString(), quiet), /modified after it was applied/);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end();
  }
});
