import { VALID_TERMS } from "./fixtures/rate-plan-terms";
// End-to-end v1 flows through the HTTP API only (management → publication → search → booking → Back Office
// → voucher), drafts, management authorization, vouchers, login hardening and the admin CLI.
// Required: DATABASE_URL pointing to a THROWAWAY database (every test truncates all tables).
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
delete process.env.TRUST_PROXY; // D1d checks the default (X-Forwarded-For ignored)
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "integration-test-secret-at-least-32-chars";
if (!DB_URL && process.env.CI) throw new Error("DATABASE_URL is required for integration tests in CI.");
const skip = DB_URL ? false : "DATABASE_URL not set; integration tests skipped locally";
const hasPdftotext = spawnSync("pdftotext", ["-v"]).status === 0;
if (!hasPdftotext && process.env.CI) throw new Error("pdftotext (poppler-utils) is required in CI to verify voucher content.");

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

// ---------------------------------------------------------------- acceptance criteria 1 + 2 + 3
test("A1 acceptance: manual hotel/room/price/allotment → only the selected sub-agency sees it at the right price", { skip }, async () => {
  const s = await setupViaApi();
  assert.equal((await search(s.t.a)).body.results.length, 0, "draft hotel must not be sellable");
  assert.equal((await call("PATCH", `/api/admin/hotels/${s.hotelId}`, { status: "active" }, s.t.m1)).status, 200);
  const a = await search(s.t.a);
  assert.equal(a.status, 200);
  assert.equal(a.body.results.length, 1);
  assert.equal(a.body.results[0].total, "230.00"); // (100 + 15%) × 2 nights
  assert.equal(a.body.results[0].hotel.name, "Deniz Kıyısı Otel");
  assert.equal((await search(s.t.b)).body.results.length, 0, "sub-agency B has no publication");
});

test("A2 acceptance: booking → Back Office queue → approval → BED4BOOK PDF voucher with the right content", { skip }, async () => {
  const s = await setupViaApi();
  await call("PATCH", `/api/admin/hotels/${s.hotelId}`, { status: "active" }, s.t.m1);
  const q = (await search(s.t.a)).body.results[0];
  const created = await book(s.t.a, q.quoteId);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const queue = await call("GET", "/api/backoffice/bookings", undefined, s.t.bo);
  assert.deepEqual(queue.body.items.map((x: any) => [x.id, x.status, x.agency_name]), [[created.body.id, "pending", "Alt Acente A"]]);
  const detail = await call("GET", `/api/backoffice/bookings/${created.body.id}`, undefined, s.t.bo);
  assert.equal(detail.body.guest_first_name, "Ayşe");
  assert.equal(detail.body.operation_note, NOTE);
  assert.equal((await call("GET", `/api/agency/bookings/${created.body.id}/voucher`, undefined, s.t.a)).status, 409, "no voucher before approval");
  assert.equal((await call("PATCH", `/api/backoffice/bookings/${created.body.id}/status`, { status: "approved" }, s.t.bo)).status, 200);
  const v = await call("GET", `/api/agency/bookings/${created.body.id}/voucher`, undefined, s.t.a);
  assert.equal(v.status, 200);
  assert.equal(v.headers.get("content-type"), "application/pdf");
  assert.equal(v.buf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(v.buf.toString("latin1").includes(created.body.bookingNo), "booking number in PDF metadata");
  assert.equal(await count("SELECT count(*)::int AS c FROM vouchers WHERE booking_id=$1", [created.body.id]), 1);
  if (hasPdftotext) {
    const dir = mkdtempSync(join(tmpdir(), "voucher-")), file = join(dir, "v.pdf");
    writeFileSync(file, v.buf);
    const text = execFileSync("pdftotext", ["-layout", file, "-"]).toString("utf8").replace(/\s+/g, " ");
    const [y1, m1, d1] = D1.split("-"), [y3, m3, d3] = D3.split("-");
    for (const expected of ["BED4BOOK", "Hotel Wholesale Platform", created.body.bookingNo, "Deniz Kıyısı Otel", "Antalya / Lara",
                            `${d1}.${m1}.${y1}`, `${d3}.${m3}.${y3}`, "Standart Oda", "Her Şey Dahil", "Ayşe Yılmaz", NOTE, "Onaylandı"])
      assert.ok(text.includes(expected), `voucher text must contain "${expected}"; got: ${text}`);
  }
});

test("A3 vouchers: other agency 404, other master 404, Back Office allowed, pending booking 409", { skip }, async () => {
  const s = await setupViaApi();
  await call("PATCH", `/api/admin/hotels/${s.hotelId}`, { status: "active" }, s.t.m1);
  const id = (await book(s.t.a, (await search(s.t.a)).body.results[0].quoteId)).body.id;
  assert.equal((await call("GET", `/api/backoffice/bookings/${id}/voucher`, undefined, s.t.bo)).status, 409);
  await call("PATCH", `/api/backoffice/bookings/${id}/status`, { status: "approved" }, s.t.m1);
  assert.equal((await call("GET", `/api/agency/bookings/${id}/voucher`, undefined, s.t.b)).status, 404);
  assert.equal((await call("GET", `/api/backoffice/bookings/${id}/voucher`, undefined, s.t.m2)).status, 404);
  assert.equal((await call("GET", `/api/backoffice/bookings/${id}/voucher`, undefined, s.t.m1)).status, 200);
  assert.equal((await call("GET", `/api/backoffice/bookings/${id}/voucher`, undefined, s.t.bo)).status, 200);
  assert.equal((await call("GET", `/api/backoffice/bookings/${id}/voucher`, undefined, s.t.a)).status, 403);
});

// ---------------------------------------------------------------- drafts
test("B1 draft does not consume allotment; submit decrements once; second submit 409", { skip }, async () => {
  const s = await setupViaApi();
  await call("PATCH", `/api/admin/hotels/${s.hotelId}`, { status: "active" }, s.t.m1);
  const q = (await search(s.t.a)).body.results[0];
  const draft = await book(s.t.a, q.quoteId, { draft: true });
  assert.equal(draft.status, 201);
  assert.equal(draft.body.status, "draft");
  assert.deepEqual(await reservedOf(s.ratePlanId), [0, 0, 0]);
  assert.equal(await count("SELECT count(*)::int AS c FROM booking_nights"), 0);
  const submitted = await call("POST", `/api/agency/bookings/${draft.body.id}/submit`, {}, s.t.a);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.deepEqual(await reservedOf(s.ratePlanId), [1, 1, 0]);
  assert.equal((await call("POST", `/api/agency/bookings/${draft.body.id}/submit`, {}, s.t.a)).status, 409);
  assert.deepEqual(await reservedOf(s.ratePlanId), [1, 1, 0]);
});

test("B2 cancelling a draft releases nothing; a failed submit leaves the draft untouched", { skip }, async () => {
  const s = await setupViaApi();
  await call("PATCH", `/api/admin/hotels/${s.hotelId}`, { status: "active" }, s.t.m1);
  const q = (await search(s.t.a)).body.results[0];
  const pending = await book(s.t.a, q.quoteId);
  const d1 = await book(s.t.a, q.quoteId, { draft: true });
  assert.deepEqual(await reservedOf(s.ratePlanId), [1, 1, 0]);
  assert.equal((await call("POST", `/api/agency/bookings/${d1.body.id}/cancel`, {}, s.t.a)).status, 200);
  assert.deepEqual(await reservedOf(s.ratePlanId), [1, 1, 0], "draft cancel must not release the pending booking's allotment");
  const d2 = await book(s.t.a, q.quoteId, { draft: true });
  await pool.query("UPDATE inventory_daily SET allotment = reserved WHERE rate_plan_id=$1 AND stay_date=$2", [s.ratePlanId, D2]);
  const failed = await call("POST", `/api/agency/bookings/${d2.body.id}/submit`, {}, s.t.a);
  assert.equal(failed.status, 409);
  assert.equal((await pool.query("SELECT status FROM bookings WHERE id=$1", [d2.body.id])).rows[0].status, "draft");
  assert.deepEqual(await reservedOf(s.ratePlanId), [1, 1, 0]);
  await pool.query("UPDATE inventory_daily SET allotment = 3 WHERE rate_plan_id=$1", [s.ratePlanId]);
  await call("PUT", `/api/admin/rate-plans/${s.ratePlanId}/calendar`, { dateFrom: D1, dateTo: D3, price: 120, allotment: 3 }, s.t.m1);
  const priceChanged = await call("POST", `/api/agency/bookings/${d2.body.id}/submit`, {}, s.t.a);
  assert.equal(priceChanged.status, 409);
  assert.equal(priceChanged.body.error, "PRICE_CHANGED");
  assert.equal(pending.status, 201);
});

// ---------------------------------------------------------------- management authorization
test("C1 management: master agency manages only its own hotels; sub-agency has no access; Back Office manages all", { skip }, async () => {
  const s = await setupViaApi();
  const cases: [string, string, object][] = [
    ["PATCH", `/api/admin/hotels/${s.hotelId}`, { status: "active" }],
    ["GET", `/api/admin/hotels/${s.hotelId}`, {}],
    ["POST", `/api/admin/hotels/${s.hotelId}/rooms`, { name: "X", maxAdults: 2, maxChildren: 0 }],
    ["PATCH", `/api/admin/rooms/${s.roomId}`, { active: false }],
    ["POST", `/api/admin/rooms/${s.roomId}/rate-plans`, { boardName: "BB", currency: "EUR", ...VALID_TERMS }],
    ["PATCH", `/api/admin/rate-plans/${s.ratePlanId}`, { active: false }],
    ["PUT", `/api/admin/rate-plans/${s.ratePlanId}/calendar`, { dateFrom: D1, dateTo: D1, price: 1, allotment: 1 }],
    ["PATCH", `/api/admin/publications/${s.publicationId}`, { active: false }]
  ];
  for (const [m, path, body] of cases) {
    assert.equal((await call(m, path, m === "GET" ? undefined : body, s.t.m2)).status, 404, `m2 ${m} ${path}`);
    assert.equal((await call(m, path, m === "GET" ? undefined : body, s.t.a)).status, 403, `sub ${m} ${path}`);
  }
  assert.equal((await call("POST", "/api/admin/publications", { ratePlanId: s.ratePlanId, agencyId: s.SB, markupType: "fixed", markupValue: 5 }, s.t.m2)).status, 404);
  assert.equal(await count("SELECT count(*)::int AS c FROM rooms"), 1, "no room was created by unauthorized callers");
  assert.equal((await call("PATCH", `/api/admin/hotels/${s.hotelId}`, { status: "active" }, s.t.bo)).status, 200, "Back Office manages platform-wide");
  const cross = await call("POST", "/api/admin/publications", { ratePlanId: s.ratePlanId, agencyId: s.SB, markupType: "fixed", markupValue: 5 }, s.t.bo);
  assert.equal(cross.status, 409);
  assert.equal(cross.body.error, "TARGET_NOT_IN_HIERARCHY");
  const sibling = await call("POST", "/api/admin/agencies", { name: "M1 ikinci alt acente", type: "sub", parentAgencyId: s.M1 }, s.t.admin);
  assert.equal(sibling.status, 201);
  const siblingUser = await call("POST", "/api/admin/users", { email: "m1-sibling@test.local", password: PW, role: "sub_agency", agencyId: sibling.body.id }, s.t.admin);
  assert.equal(siblingUser.status, 201);
  const siblingToken = await token("m1-sibling@test.local");
  const published = await call("POST", "/api/admin/publications", { ratePlanId: s.ratePlanId, agencyId: sibling.body.id, markupType: "fixed", markupValue: 5 }, s.t.bo);
  assert.equal(published.status, 201);
  assert.equal((await search(siblingToken)).body.results[0].total, "210.00"); // (100 + 5) × 2
  assert.equal((await search(s.t.b)).body.results.length, 0, "other DMC must not see M1 hotel");
  assert.equal((await call("POST", "/api/admin/users", { email: "x@test.local", password: PW, role: "sub_agency", agencyId: s.SA }, s.t.bo)).status, 403, "user management is system_admin only");
});

test("C2 management rules: publication target must be an active sub-agency; allotment cannot drop below reserved; hotel owner must be a master agency", { skip }, async () => {
  const s = await setupViaApi();
  await call("PATCH", `/api/admin/hotels/${s.hotelId}`, { status: "active" }, s.t.m1);
  assert.equal((await call("POST", "/api/admin/publications", { ratePlanId: s.ratePlanId, agencyId: s.M2, markupType: "percent", markupValue: 10 }, s.t.m1)).status, 400);
  assert.equal((await call("POST", "/api/admin/publications", { ratePlanId: s.ratePlanId, agencyId: s.SB, markupType: "override", markupValue: 10 }, s.t.m1)).status, 400, "no override model");
  await book(s.t.a, (await search(s.t.a)).body.results[0].quoteId);
  await book(s.t.a, (await search(s.t.a)).body.results[0].quoteId);
  const below = await call("PUT", `/api/admin/rate-plans/${s.ratePlanId}/calendar`, { dateFrom: D1, dateTo: D3, price: 100, allotment: 1 }, s.t.m1);
  assert.equal(below.status, 409);
  assert.equal(below.body.error, "ALLOTMENT_BELOW_RESERVED");
  assert.deepEqual((await pool.query("SELECT allotment FROM inventory_daily WHERE rate_plan_id=$1 ORDER BY stay_date", [s.ratePlanId])).rows.map((r: any) => r.allotment), [3, 3, 3]);
  assert.equal((await call("POST", "/api/admin/hotels", { name: "Y", location: "Z", ownerAgencyId: s.SA }, s.t.admin)).status, 400);
  assert.equal((await call("POST", "/api/admin/users", { email: "bo2@test.local", password: PW, role: "back_office", agencyId: s.M1 }, s.t.admin)).status, 400, "Back Office is never bound to an agency");
  assert.equal((await call("POST", "/api/admin/users", { email: "wrong@test.local", password: PW, role: "master_agency", agencyId: s.SA }, s.t.admin)).status, 400, "role must match agency type");
});

test("C3 deactivating a publication, rate plan or hotel removes it from search immediately", { skip }, async () => {
  const s = await setupViaApi();
  await call("PATCH", `/api/admin/hotels/${s.hotelId}`, { status: "active" }, s.t.m1);
  assert.equal((await search(s.t.a)).body.results.length, 1);
  await call("PATCH", `/api/admin/publications/${s.publicationId}`, { active: false }, s.t.m1);
  assert.equal((await search(s.t.a)).body.results.length, 0);
  await call("PATCH", `/api/admin/publications/${s.publicationId}`, { active: true }, s.t.m1);
  await call("PATCH", `/api/admin/rate-plans/${s.ratePlanId}`, { active: false }, s.t.m1);
  assert.equal((await search(s.t.a)).body.results.length, 0);
  await call("PATCH", `/api/admin/rate-plans/${s.ratePlanId}`, { active: true }, s.t.m1);
  await call("PATCH", `/api/admin/hotels/${s.hotelId}`, { status: "inactive" }, s.t.m1);
  assert.equal((await search(s.t.a)).body.results.length, 0);
});

// ---------------------------------------------------------------- authentication hardening
test("D1 login throttling: 5 failures lock the account from that IP for 15 minutes, even with the correct password", { skip }, async () => {
  await setupViaApi();
  for (let i = 0; i < 5; i++) assert.equal((await login("a@test.local", "wrong-password-xx")).status, 401);
  const locked = await login("a@test.local");
  assert.equal(locked.status, 429);
  assert.equal((await login("b@test.local")).status, 200, "other accounts are not affected");
  assert.equal((await login("nobody@test.local", "whatever-password")).status, 401);
  assert.equal(await count("SELECT count(*)::int AS c FROM login_attempts WHERE email_lower='nobody@test.local' AND NOT success"), 1);
});

test("D1b account lockout attack: failures from other IPs do not lock the victim; a distributed attack is capped", { skip }, async () => {
  await setupViaApi();
  // The attacker typed the victim's e-mail 5 times from another address (rows as the login endpoint writes them).
  await pool.query("INSERT INTO login_attempts(email_lower, ip, success) SELECT 'a@test.local', '203.0.113.9', false FROM generate_series(1,5)");
  assert.equal((await login("a@test.local")).status, 200, "victim on its own IP still logs in");
  // 19 more attacker addresses (5 failures each): 100 failures on the account in the window.
  await pool.query("INSERT INTO login_attempts(email_lower, ip, success) SELECT 'a@test.local', '198.51.100.' || (g / 5), false FROM generate_series(0,94) g");
  const capped = await login("a@test.local");
  assert.equal(capped.status, 429, "distributed brute force throttles the account");
  assert.deepEqual(capped.body, { error: "TOO_MANY_LOGIN_ATTEMPTS" });
  assert.equal((await login("b@test.local")).status, 200, "other accounts are not affected");
  // Failures older than the window do not count.
  await pool.query("UPDATE login_attempts SET at = now() - interval '16 minutes' WHERE email_lower = 'a@test.local'");
  assert.equal((await login("a@test.local")).status, 200);
});

test("D1c login responses do not reveal whether an account exists", { skip }, async () => {
  await setupViaApi();
  const known = await login("a@test.local", "wrong-password-xx"), unknown = await login("nobody@test.local", "wrong-password-xx");
  assert.equal(known.status, 401); assert.equal(unknown.status, 401);
  assert.deepEqual(known.body, unknown.body);
  for (let i = 0; i < 4; i++) { await login("a@test.local", "wrong-password-xx"); await login("nobody@test.local", "wrong-password-xx"); }
  const k = await login("a@test.local"), u = await login("nobody@test.local", "whatever-password");
  assert.equal(k.status, 429); assert.equal(u.status, 429, "unknown e-mails are throttled the same way");
  assert.deepEqual(k.body, u.body);
});

test("D1d X-Forwarded-For is ignored without TRUST_PROXY: a client cannot rotate its IP to bypass the IP limit", { skip }, async () => {
  await setupViaApi();
  const spoofed = (n: number) => call("POST", "/api/auth/login", { email: `spray${n}@test.local`, password: "wrong-password-xx" }, undefined,
    { "x-forwarded-for": `192.0.2.${n}`, "x-real-ip": `192.0.2.${n}` });
  for (let i = 0; i < 20; i++) assert.equal((await spoofed(i)).status, 401);
  assert.equal((await spoofed(99)).status, 429, "21st attempt from the same TCP peer is throttled despite a new X-Forwarded-For");
  assert.equal(await count("SELECT count(DISTINCT ip)::int AS c FROM login_attempts WHERE email_lower LIKE 'spray%'"), 1, "spoofed header not recorded as IP");
  assert.equal(await count("SELECT count(*)::int AS c FROM login_attempts WHERE ip LIKE '192.0.2.%'"), 0);
});

test("D2 logout, user deactivation and agency deactivation revoke existing sessions", { skip }, async () => {
  const s = await setupViaApi();
  assert.equal((await call("GET", "/api/me", undefined, s.t.a)).status, 200);
  assert.equal((await call("POST", "/api/auth/logout", {}, s.t.a)).status, 200);
  assert.equal((await call("GET", "/api/me", undefined, s.t.a)).status, 401, "token revoked by logout");
  const fresh = await token("a@test.local");
  assert.equal((await call("PATCH", `/api/admin/agencies/${s.SA}`, { active: false }, s.t.admin)).status, 200);
  assert.equal((await call("GET", "/api/me", undefined, fresh)).status, 401, "agency deactivation revokes");
  assert.equal((await login("a@test.local")).status, 401, "users of an inactive agency cannot log in");
  const bId = (await pool.query("SELECT id FROM users WHERE email='b@test.local'")).rows[0].id;
  assert.equal((await call("PATCH", `/api/admin/users/${bId}`, { active: false }, s.t.admin)).status, 200);
  assert.equal((await call("GET", "/api/me", undefined, s.t.b)).status, 401, "user deactivation revokes");
  assert.equal((await call("GET", "/api/me", undefined, s.t.b.replace(/^/, "x"))).status, 401);
  assert.equal((await fetch(base + "/api/me", { headers: { authorization: s.t.m1 } })).status, 401, "Bearer prefix is required");
});

test("D3 security headers and readiness endpoint", { skip }, async () => {
  const r = await fetch(base + "/ready");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, database: "up" });
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("x-powered-by"), null);
});

test("D4 admin CLI creates the first system administrator from stdin and refuses duplicates", { skip }, async () => {
  const run = (email: string, password: string) => spawnSync(process.execPath, ["--import", "tsx", "server/cli/create-admin.ts", email],
    { input: password, env: { ...process.env, DATABASE_URL: DB_URL }, encoding: "utf8" });
  const ok = run("root@bed4book.test", "a-very-long-root-password");
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(!ok.stdout.includes("a-very-long-root-password"), "password must never be printed");
  assert.equal((await login("root@bed4book.test", "a-very-long-root-password")).status, 200);
  assert.notEqual(run("root@bed4book.test", "a-very-long-root-password").status, 0, "duplicate refused");
  assert.notEqual(run("short@bed4book.test", "short").status, 0, "short password refused");
});
