import { pdfText } from "../helpers/pdf-text";
import { VALID_TERMS } from "./fixtures/rate-plan-terms";
// End-to-end v1 flows through the HTTP API only (management → publication → search → booking → Back Office
// → voucher), drafts, management authorization, vouchers, login hardening and the admin CLI.
// Required: DATABASE_URL pointing to a THROWAWAY database (every test truncates all tables).
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const DB_URL = process.env.DATABASE_URL;
delete process.env.TRUST_PROXY; // D1d checks the default (X-Forwarded-For ignored)
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "integration-test-secret-at-least-32-chars";
if (!DB_URL && process.env.CI) throw new Error("DATABASE_URL is required for integration tests in CI.");
const skip = DB_URL ? false : "DATABASE_URL not set; integration tests skipped locally";

let server: Server, base = "", pool: any, hashPassword: (p: string) => string;
const PW = "integration-password-1";
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const D1 = day(40), D2 = day(41), D3 = day(42);

async function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  try { json = JSON.parse(buf.toString("utf8")); } catch { /* binary or empty */ }
  return { status: res.status, body: json, buf, headers: res.headers };
}
const login = async (email: string, password = PW) => call("POST", "/api/auth/login", { email, password });
const token = async (email: string) => { const r = await login(email); assert.equal(r.status, 200, `login ${email}: ${JSON.stringify(r.body)}`); return r.body.token as string; };
const count = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0].c as number;
const reservedOf = async (ratePlanId: string) =>
  (await pool.query("SELECT reserved FROM inventory_daily WHERE rate_plan_id=$1 ORDER BY stay_date", [ratePlanId])).rows.map((r: any) => r.reserved);
const GUEST = { firstName: "Ayşe", lastName: "Yılmaz", adults: 2, children: 1, childAges: [7], email: "ayse@example.com", phone: "+90 532 000 11 22", nationality: "TR" };
const OTHER_GUESTS = [{ firstName: "Mehmet", lastName: "Yılmaz", type: "adult", nationality: "TR" }, { firstName: "Elif", lastName: "Yılmaz", type: "child", age: 7, nationality: "TR" }];
const NOTE = "Geç giriş, saat 23:30 civarı";

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
  await pool.query(`TRUNCATE agencies, users, hotels, rooms, rate_plans, inventory_daily, agency_hotel_sales, bookings,
    booking_status_history, booking_nights, audit_logs, idempotency_keys, fx_rates, login_attempts, vouchers, market_groups, fx_rate_history, proforma_counters CASCADE`);
  await pool.query("INSERT INTO users(email,password_hash,role,agency_id) VALUES ('admin@test.local',$1,'system_admin',NULL)", [hashPassword(PW)]);
});

/** Builds the whole catalogue through the API, as the specification's user journeys describe. */
async function setupViaApi() {
  const admin = await token("admin@test.local");
  const agency = async (name: string, type: string, parentAgencyId?: string) => {
    const r = await call("POST", "/api/admin/agencies", { name, type, ...(parentAgencyId ? { parentAgencyId } : {}) }, admin); assert.equal(r.status, 201); return r.body.id as string; };
  const M1 = await agency("Ana Acente Bir", "master"), M2 = await agency("Ana Acente İki", "master");
  const SA = await agency("Alt Acente A", "sub", M1), SB = await agency("Alt Acente B", "sub", M2);
  const user = async (email: string, role: string, agencyId: string | null) => {
    const r = await call("POST", "/api/admin/users", { email, password: PW, role, agencyId }, admin); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id as string; };
  await user("bo@test.local", "back_office", null);
  await user("m1@test.local", "master_agency", M1);
  await user("m2@test.local", "master_agency", M2);
  await user("a@test.local", "sub_agency", SA);
  await user("b@test.local", "sub_agency", SB);
  const t = { admin, bo: await token("bo@test.local"), m1: await token("m1@test.local"), m2: await token("m2@test.local"), a: await token("a@test.local"), b: await token("b@test.local") };

  const hotel = await call("POST", "/api/admin/hotels", { name: "Deniz Kıyısı Otel", location: "Antalya / Lara", category: "5*" }, t.m1);
  assert.equal(hotel.status, 201, JSON.stringify(hotel.body));
  const room = await call("POST", `/api/admin/hotels/${hotel.body.id}/rooms`, { name: "Standart Oda", maxAdults: 2, maxChildren: 2 }, t.m1);
  assert.equal(room.status, 201, JSON.stringify(room.body));
  const rp = await call("POST", `/api/admin/rooms/${room.body.id}/rate-plans`, { boardName: "Her Şey Dahil", currency: "EUR", ...VALID_TERMS }, t.m1);
  assert.equal(rp.status, 201, JSON.stringify(rp.body));
  const cal = await call("PUT", `/api/admin/rate-plans/${rp.body.id}/calendar`, { dateFrom: D1, dateTo: D3, price: 100, allotment: 3 }, t.m1);
  assert.equal(cal.status, 200, JSON.stringify(cal.body));
  assert.equal(cal.body.days, 3);
  const pub = await call("POST", "/api/admin/publications", { ratePlanId: rp.body.id, agencyId: SA, markupType: "percent", markupValue: 15 }, t.m1);
  assert.equal(pub.status, 201, JSON.stringify(pub.body));
  return { t, M1, M2, SA, SB, hotelId: hotel.body.id as string, roomId: room.body.id as string, ratePlanId: rp.body.id as string, publicationId: pub.body.id as string };
}
const STAY = { checkIn: D1, checkOut: D3, rooms: 1, adults: 2, children: 1, childAges: [7], roomOccupancies: [{ adults: 2, children: 1, childAges: [7] }], nationalities: ["TR"] };
const search = (tok: string) => call("POST", "/api/agency/searches", STAY, tok);
const book = (tok: string, quoteId: string, extra: object = {}) =>
  call("POST", "/api/agency/bookings", { quoteId, guest: GUEST, otherGuests: OTHER_GUESTS, operationNote: NOTE, ...extra }, tok, { "Idempotency-Key": randomUUID() });


test("J11a phase-1 API: DMC setup, distribution, search, booking, voucher, cancellation and inventory", { skip }, async () => {
  const s = await setupViaApi();
  assert.equal((await call("PATCH", `/api/admin/hotels/${s.hotelId}`, { status: "active" }, s.t.m1)).status, 200);
  const distribution = await call("POST", "/api/admin/distribution-rules", {
    sellerAgencyId: s.M1, buyerAgencyId: s.M2, effect: "allow", platformMarginPercent: 10
  }, s.t.admin);
  assert.equal(distribution.status, 201, JSON.stringify(distribution.body));
  const found = await search(s.t.b);
  assert.equal(found.status, 200, JSON.stringify(found.body));
  assert.equal(found.body.results.length, 1, JSON.stringify(found.body));
  const buyerView = JSON.stringify(found.body);
  for (const secret of ["Ana Acente Bir", s.M1, "platformMarginPercent", "netPrice", "markupValue"])
    assert.ok(!buyerView.includes(secret), "buyer search leaks " + secret);
  const booking = await book(s.t.b, found.body.results[0].quoteId);
  assert.equal(booking.status, 201, JSON.stringify(booking.body));
  assert.deepEqual(await reservedOf(s.ratePlanId), [1, 1, 0]);
  assert.equal((await call("PATCH", `/api/backoffice/bookings/${booking.body.id}/status`, { status: "approved" }, s.t.bo)).status, 200);
  const voucher = await call("GET", `/api/agency/bookings/${booking.body.id}/voucher`, undefined, s.t.b);
  assert.equal(voucher.status, 200); assert.equal(voucher.buf.subarray(0, 5).toString(), "%PDF-");
  const proforma = await call("GET", `/api/agency/bookings/${booking.body.id}/proforma`, undefined, s.t.b);
  assert.equal(proforma.status, 201, JSON.stringify(proforma.body));
  assert.equal(proforma.buf.subarray(0, 5).toString(), "%PDF-");
  const proformaText = await pdfText(proforma.buf);
  assert.match(proformaText, /BED4BOOK/i, "BED4BOOK must be the proforma seller");
  assert.ok(!proformaText.includes("Ana Acente Bir"), "seller DMC name leaked into proforma");
  const opLedger = await call("GET", "/api/finance/ledger", undefined, s.t.admin);
  assert.equal(opLedger.status, 200); assert.ok(opLedger.body.entries.length > 0);
  const aBalance = await call("GET", "/api/finance/balances?book=operator", undefined, s.t.m1);
  const bBalance = await call("GET", "/api/finance/balances?book=operator", undefined, s.t.m2);
  assert.equal(aBalance.status, 200); assert.equal(bBalance.status, 200);
  assert.ok(aBalance.body.items.every((x: any) => x.party_agency_id === s.M1));
  assert.ok(bBalance.body.items.every((x: any) => x.party_agency_id === s.M2));
  assert.equal((await call("PATCH", `/api/backoffice/bookings/${booking.body.id}/status`, { status: "cancelled" }, s.t.bo)).status, 200);
  assert.deepEqual(await reservedOf(s.ratePlanId), [0, 0, 0], "inventory released once");
  const secondCancel = await call("PATCH", `/api/backoffice/bookings/${booking.body.id}/status`, { status: "cancelled" }, s.t.bo);
  assert.equal(secondCancel.status, 409, JSON.stringify(secondCancel.body));
  assert.deepEqual(await reservedOf(s.ratePlanId), [0, 0, 0], "second cancellation must not release inventory again");
  const entries = (await pool.query("SELECT kind,count(*)::int AS n FROM ledger_entries WHERE booking_id=$1 GROUP BY kind", [booking.body.id])).rows;
  assert.ok(entries.some((e: any) => e.kind === "reversal"), JSON.stringify(entries));
});
