import { VALID_TERMS } from "./fixtures/rate-plan-terms";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const skip = !process.env.DATABASE_URL ? "DATABASE_URL required" : false;
if (skip && process.env.CI) throw new Error("DATABASE_URL required in CI");
process.env.SESSION_SECRET ||= "occupancy-booking-integration-secret-at-least-32";
let pool: any, server: Server, base: string, hashPassword: (s: string) => string, issueSession: (p: any, s: string) => string;
const CRYSTAL = readFileSync(path.join(__dirname, "fixtures", "S27 Crystal Hotels PriceList_Europe & UK(1).xlsx"));
async function request(method: string, p: string, token: string, body?: unknown) {
  const isFile = Buffer.isBuffer(body);
  const r = await fetch(base + p, { method, headers: { authorization: "Bearer " + token, "content-type": isFile ? "application/octet-stream" : "application/json", "Idempotency-Key": randomUUID() },
    body: body === undefined ? undefined : isFile ? body as Buffer : JSON.stringify(body) });
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
  await pool.query(`TRUNCATE contract_imports, agencies, users, hotels, rooms, rate_plans, inventory_daily, agency_hotel_sales, bookings, booking_status_history,
    booking_nights, audit_logs, idempotency_keys, fx_rates, login_attempts, vouchers, market_groups, fx_rate_history, proforma_counters CASCADE`);
});

// Crystal De Luxe, "STANDARD ROOM LAND VIEW", first period 2027-03-05..18: dbl 120, sgl 90, dbl+exb 162, 2 ad + 1 chd (2-11.99) 120,
// min stay 3, release 1, allotment 4.
async function world() {
  const id = () => randomUUID(), dmc = id(), sub = id();
  await pool.query("INSERT INTO agencies(id,name,type,parent_agency_id) VALUES ($1,'Crystal DMC','master',NULL),($2,'Crystal Sub','sub',$1)", [dmc, sub]);
  const t: Record<string, string> = {};
  for (const [key, role, agencyId] of [["admin", "system_admin", null], ["master", "master_agency", dmc], ["sub", "sub_agency", sub]] as const) {
    const uid = id();
    await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES ($1,$2,$3,$4,$5)", [uid, `occ-${key}@test.local`, hashPassword("integration-password-1"), role, agencyId]);
    t[key] = issueSession({ sub: uid, role, agencyId, ver: 0 }, process.env.SESSION_SECRET!);
  }
  const pre = await request("POST", "/api/contracts/import/preview", t.master!, CRYSTAL);
  assert.equal(pre.status, 201, JSON.stringify(pre.body));
  const deluxe = pre.body.hotels.find((h: any) => h.name === "CRYSTAL DE LUXE").index;
  assert.equal((await request("POST", `/api/contracts/import/${pre.body.importId}/confirm`, t.master!, { ...VALID_TERMS, hotels: [deluxe] })).status, 200);
  await pool.query("UPDATE hotels SET status = 'active'");
  await pool.query("UPDATE rooms SET max_adults = 3, max_children = 2");
  const plan = (await pool.query("SELECT p.id FROM rate_plans p JOIN rooms r ON r.id = p.room_id WHERE r.name LIKE 'STANDARD ROOM LAND VIEW%'")).rows[0].id;
  assert.equal((await request("POST", "/api/admin/publications", t.admin!, { ratePlanId: plan, agencyId: sub, markupType: "percent", markupValue: 0 })).status, 201);
  return { t, plan };
}
const search = async (token: string, rooms: { adults: number; childAges: number[] }[], checkIn = "2027-03-06", checkOut = "2027-03-09") => {
  const adults = rooms.reduce((s, r) => s + r.adults, 0), ages = rooms.flatMap(r => r.childAges);
  const r = await request("POST", "/api/agency/searches", token, { checkIn, checkOut, rooms: rooms.length, adults, children: ages.length, childAges: ages,
    roomOccupancies: rooms.map(r => ({ adults: r.adults, children: r.childAges.length, childAges: r.childAges })), nationalities: ["TR"] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.results as any[];
};

test("X10 Excel prices by occupancy: single, double, triple, child free, unpriced occupancies not sold", { skip }, async () => {
  const w = await world();
  const total = async (rooms: { adults: number; childAges: number[] }[]) => (await search(w.t.sub!, rooms)).map(o => o.total);
  assert.deepEqual(await total([{ adults: 2, childAges: [] }]), ["360.00"], "3 nights x 120");
  assert.deepEqual(await total([{ adults: 1, childAges: [] }]), ["270.00"], "single 90");
  assert.deepEqual(await total([{ adults: 3, childAges: [] }]), ["486.00"], "double + extra bed 162");
  assert.deepEqual(await total([{ adults: 2, childAges: [5] }]), ["360.00"], "child 2-11.99 stays free");
  assert.deepEqual(await total([{ adults: 2, childAges: [1] }]), [], "infant is not priced in this contract: not sold");
  assert.deepEqual(await total([{ adults: 2, childAges: [] }, { adults: 1, childAges: [] }]), ["630.00"], "two rooms priced separately: (120 + 90) x 3");
});

test("X11 min stay and release from the contract", { skip }, async () => {
  const w = await world();
  assert.equal((await search(w.t.sub!, [{ adults: 2, childAges: [] }], "2027-03-06", "2027-03-08")).length, 0, "2 nights < min stay 3");
  assert.equal((await search(w.t.sub!, [{ adults: 2, childAges: [] }], "2027-03-06", "2027-03-09")).length, 1);
  await pool.query("UPDATE inventory_daily SET release_days = 365 WHERE rate_plan_id = $1", [w.plan]);
  assert.equal((await search(w.t.sub!, [{ adults: 2, childAges: [] }])).length, 0, "inside the release period: closed");
});

test("X12 booking two rooms with different occupancies: one night row per room, exact total, stock released on cancel", { skip }, async () => {
  const w = await world();
  const [offer] = await search(w.t.sub!, [{ adults: 2, childAges: [] }, { adults: 1, childAges: [] }]);
  const booked = await request("POST", "/api/agency/bookings", w.t.sub!, { quoteId: offer.quoteId,
    guest: { firstName: "Test", lastName: "Guest", adults: 3, children: 0, childAges: [], email: "g@test.local", phone: "+905551112233", nationality: "TR" },
    otherGuests: [{ firstName: "Second", lastName: "Guest", type: "adult", nationality: "TR" }, { firstName: "Third", lastName: "Guest", type: "adult", nationality: "TR" }],
    operationNote: "Late arrival" });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  assert.equal(booked.body.total, "630.00");
  const rows = (await pool.query("SELECT stay_date::text, room_no, rooms, sell_price::numeric(14,2)::text AS p FROM booking_nights WHERE booking_id = $1 ORDER BY stay_date, room_no", [booked.body.id])).rows;
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.slice(0, 2).map((r: any) => [r.room_no, r.rooms, r.p]), [[1, 1, "120.00"], [2, 1, "90.00"]]);
  assert.equal(Number((await pool.query("SELECT sum(reserved) AS n FROM inventory_daily WHERE rate_plan_id = $1", [w.plan])).rows[0].n), 6, "2 rooms x 3 nights");
  assert.equal((await request("PATCH", `/api/backoffice/bookings/${booked.body.id}/status`, w.t.admin!, { status: "cancelled" })).status, 200);
  assert.equal(Number((await pool.query("SELECT sum(reserved) AS n FROM inventory_daily WHERE rate_plan_id = $1", [w.plan])).rows[0].n), 0, "released per night, not per row");
});
