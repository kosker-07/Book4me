import { VALID_TERMS } from "./fixtures/rate-plan-terms";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const skip = !process.env.DATABASE_URL ? "DATABASE_URL required" : false;
if (skip && process.env.CI) throw new Error("DATABASE_URL required in CI");
process.env.SESSION_SECRET ||= "reports-integration-secret-at-least-32-chars";
let pool: any, server: Server, base: string, hashPassword: (s: string) => string, issueSession: (p: any, s: string) => string;
async function request(method: string, p: string, token: string, body?: unknown) {
  const r = await fetch(base + p, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json", "Idempotency-Key": randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = r.headers.get("content-type") ?? "";
  return { status: r.status, type, body: type.includes("json") ? await r.json() as any : await r.text() as any };
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
  await pool.query(`TRUNCATE agencies, users, hotels, rooms, rate_plans, inventory_daily, agency_hotel_sales, bookings, booking_status_history, supplier_connections,
    booking_nights, audit_logs, idempotency_keys, fx_rates, login_attempts, vouchers, market_groups, fx_rate_history, proforma_counters CASCADE`);
});
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const checkIn = day(40), mid = day(41), checkOut = day(42);

/** DMC A owns a hotel (100/night). Sub A books it directly (+10%), Sub B (of DMC B) books it through the marketplace. */
async function world() {
  const id = () => randomUUID();
  const a = id(), b = id(), subA = id(), subB = id(), h = id(), r = id(), p = id();
  for (const [agencyId, name, type, parent] of [[a, "Alpha DMC", "master", null], [b, "Bravo DMC", "master", null], [subA, "Alpha Sub", "sub", a], [subB, "Bravo Sub", "sub", b]])
    await pool.query("INSERT INTO agencies(id,name,type,parent_agency_id) VALUES ($1,$2,$3,$4)", [agencyId, name, type, parent]);
  const t: Record<string, string> = {};
  for (const [key, role, agencyId] of [["admin", "system_admin", null], ["office", "back_office", a], ["masterA", "master_agency", a], ["masterB", "master_agency", b], ["subA", "sub_agency", subA], ["subB", "sub_agency", subB]] as const) {
    const uid = id();
    await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES ($1,$2,$3,$4,$5)", [uid, `rep-${key}@test.local`, hashPassword("integration-password-1"), role, agencyId]);
    t[key] = issueSession({ sub: uid, role, agencyId, ver: 0 }, process.env.SESSION_SECRET!);
  }
  await pool.query("INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ($1,$2,'Report Hotel','Antalya','active')", [h, a]);
  await pool.query("INSERT INTO rooms(id,hotel_id,name) VALUES ($1,$2,'Double')", [r, h]);
  await pool.query("INSERT INTO rate_plans(id,room_id,board_name,currency,cancellation_policy,payment_terms) VALUES ($1,$2,'BB','EUR',$3::jsonb,$4::jsonb)",
    [p, r, JSON.stringify(VALID_TERMS.cancellationPolicy), JSON.stringify(VALID_TERMS.paymentTerms)]);
  await pool.query("INSERT INTO inventory_daily(rate_plan_id,stay_date,price,allotment) VALUES ($1,$2,100,9),($1,$3,100,9)", [p, checkIn, mid]);
  assert.equal((await request("POST", "/api/admin/publications", t.admin!, { ratePlanId: p, agencyId: subA, markupType: "percent", markupValue: 10 })).status, 201);
  assert.equal((await request("POST", "/api/admin/distribution-rules", t.admin!, { sellerAgencyId: a, buyerAgencyId: b, effect: "allow", platformMarginPercent: 0 })).status, 201);
  for (const token of [t.subA!, t.subB!]) {
    const s = await request("POST", "/api/agency/searches", token, { checkIn, checkOut, rooms: 1, adults: 2, children: 0, childAges: [],
      roomOccupancies: [{ adults: 2, children: 0, childAges: [] }], nationalities: ["TR"] });
    const bk = await request("POST", "/api/agency/bookings", token, { quoteId: s.body.results[0].quoteId,
      guest: { firstName: "Test", lastName: "Guest", adults: 2, children: 0, childAges: [], email: "g@test.local", phone: "+905551112233", nationality: "TR" },
      otherGuests: [{ firstName: "Second", lastName: "Guest", type: "adult", nationality: "TR" }], operationNote: "Late arrival" });
    assert.equal(bk.status, 201, JSON.stringify(bk.body));
  }
  return { a, b, t };
}

test("I1 platform report: every booking, EUR total equals the bookings' totals", { skip }, async () => {
  const w = await world();
  const r = await request("GET", "/api/reports/sales", w.t.admin!);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.items.length, 2);
  const sum = (await pool.query("SELECT sum(total)::numeric(14,2)::text AS s FROM bookings")).rows[0].s;
  assert.equal(r.body.totals.totalEur, sum);
  assert.deepEqual(r.body.items.map((x: any) => x.buyer).sort(), ["Alpha Sub", "Bravo Sub"]);
  assert.equal((await request("GET", "/api/reports/sales?status=cancelled", w.t.admin!)).body.items.length, 0);
  assert.equal((await request("GET", "/api/reports/sales?from=" + day(50), w.t.admin!)).body.items.length, 0);
  assert.equal((await request("GET", "/api/reports/sales?from=2027-02-30", w.t.admin!)).status, 400);
});

test("I2 DMC isolation: seller sees its hotel's sales with foreign buyers hidden; buyer DMC sees its sub's purchase with the seller hidden", { skip }, async () => {
  const w = await world();
  const seller = (await request("GET", "/api/reports/sales", w.t.masterA!)).body.items;
  assert.equal(seller.length, 2);
  assert.deepEqual(seller.map((x: any) => x.buyer).sort(), ["Alpha Sub", "Marketplace"]);
  assert.ok(seller.every((x: any) => x.seller === "Own hotel"));
  const buyer = (await request("GET", "/api/reports/sales", w.t.masterB!)).body.items;
  assert.equal(buyer.length, 1);
  assert.deepEqual([buyer[0].buyer, buyer[0].seller], ["Bravo Sub", "Marketplace"]);
  assert.ok(!JSON.stringify(buyer).includes("Alpha"), "no trace of the seller DMC");
  assert.equal((await request("GET", "/api/reports/sales", w.t.subA!)).status, 403);
});

test("I3 CSV export: header, one line per booking, formula-safe", { skip }, async () => {
  const w = await world();
  await pool.query("UPDATE hotels SET name = '=HYPERLINK(1)'");
  const r = await request("GET", "/api/reports/sales.csv", w.t.masterA!);
  assert.equal(r.status, 200); assert.match(r.type, /text\/csv/);
  const lines = r.body.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines[0], "booking_no,status,check_in,check_out,room_count,hotel_name,seller,buyer,total,currency,total_eur,created_at");
  assert.equal(lines.length, 3);
  assert.ok(lines.slice(1).every((l: string) => l.includes(",'=HYPERLINK(1),")), "formula neutralised");
});

test("I4 integrations: only system_admin manages them", { skip }, async () => {
  const w = await world();
  const created = await request("POST", "/api/integrations", w.t.admin!, { kind: "hotel_api", name: "Supplier X" });
  assert.equal(created.status, 201); assert.equal(created.body.status, "disabled");
  assert.equal((await request("PATCH", `/api/integrations/${created.body.id}`, w.t.admin!, { status: "active" })).body.status, "active");
  assert.equal((await request("PATCH", `/api/integrations/${created.body.id}`, w.t.admin!, { status: "error" })).status, 400);
  assert.equal((await request("POST", "/api/integrations", w.t.admin!, { kind: "ftp", name: "X" })).status, 400);
  for (const k of ["office", "masterA", "subA"]) {
    assert.equal((await request("GET", "/api/integrations", w.t[k]!)).status, 403, k);
    assert.equal((await request("POST", "/api/integrations", w.t[k]!, { kind: "other", name: "Y" })).status, 403, k);
  }
  assert.equal((await request("PATCH", `/api/integrations/${randomUUID()}`, w.t.admin!, { status: "active" })).status, 404);
});
