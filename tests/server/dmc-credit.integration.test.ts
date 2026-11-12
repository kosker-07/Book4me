import { VALID_TERMS } from "./fixtures/rate-plan-terms";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const skip = !process.env.DATABASE_URL ? "DATABASE_URL required" : false;
if (skip && process.env.CI) throw new Error("DATABASE_URL required in CI");
process.env.SESSION_SECRET ||= "dmc-credit-integration-secret-at-least-32";
let pool: any, server: Server, base: string, hashPassword: (s: string) => string, issueSession: (p: any, s: string) => string;
const PW = "integration-password-1";
async function request(method: string, path: string, token: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base + path, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = r.headers.get("content-type") ?? "";
  return { status: r.status, body: type.includes("json") ? await r.json() as any : null, raw: type.includes("json") ? null : Buffer.from(await r.arrayBuffer()) };
}
before(async () => {
  if (skip) return;
  ({ pool } = await import("../../server/db"));
  ({ hashPassword, issueSession } = await import("../../server/security"));
  const { default: app } = await import("../../server/app");
  server = app.listen(0);
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(async () => { if (!skip) { server.close(); await pool.end(); } });
beforeEach(async () => {
  if (skip) return;
  await pool.query(`TRUNCATE agencies, users, hotels, rooms, rate_plans, inventory_daily, agency_hotel_sales, bookings,
    booking_status_history, booking_nights, audit_logs, idempotency_keys, fx_rates, login_attempts, vouchers, market_groups, fx_rate_history, proforma_counters CASCADE`);
});

const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const checkIn = day(40), mid = day(41), checkOut = day(42);

interface World {
  dmc: { a: string; b: string }; sub: { a: string; b: string }; plan: string; hotel: string;
  t: { admin: string; office: string; masterA: string; masterB: string; subA: string; subB: string };
}

/** DMC A owns the hotel (net 100.00 EUR/night, 2 nights). DMC B buys it through a rule. Sub A is A's own sub-agency. */
async function seed(): Promise<World> {
  const id = () => randomUUID();
  const w: World = { dmc: { a: id(), b: id() }, sub: { a: id(), b: id() }, plan: id(), hotel: id(), t: {} as World["t"] };
  for (const [agencyId, name, type, parent] of [
    [w.dmc.a, "Seller DMC Alpha", "master", null], [w.dmc.b, "Buyer DMC Bravo", "master", null],
    [w.sub.a, "Alpha Sub", "sub", w.dmc.a], [w.sub.b, "Bravo Sub", "sub", w.dmc.b]
  ]) await pool.query("INSERT INTO agencies(id,name,type,parent_agency_id) VALUES ($1,$2,$3,$4)", [agencyId, name, type, parent]);
  await pool.query("UPDATE agencies SET marketplace_markup_percent = 20 WHERE id = $1", [w.dmc.b]);
  await pool.query("UPDATE agencies SET platform_fee_percent = 5 WHERE id = $1", [w.dmc.a]);
  const users: [keyof World["t"], string, string | null][] = [
    ["admin", "system_admin", null], ["office", "back_office", null], ["masterA", "master_agency", w.dmc.a], ["masterB", "master_agency", w.dmc.b],
    ["subA", "sub_agency", w.sub.a], ["subB", "sub_agency", w.sub.b]
  ];
  for (const [key, role, agencyId] of users) {
    const userId = id();
    await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES ($1,$2,$3,$4,$5)", [userId, `credit-${key}@test.local`, hashPassword(PW), role, agencyId]);
    w.t[key] = issueSession({ sub: userId, role, agencyId, ver: 0 }, process.env.SESSION_SECRET!);
  }
  const room = id();
  await pool.query("INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ($1,$2,'Chain Hotel','Antalya','active')", [w.hotel, w.dmc.a]);
  await pool.query("INSERT INTO rooms(id,hotel_id,name) VALUES ($1,$2,'Double')", [room, w.hotel]);
  await pool.query("INSERT INTO rate_plans(id,room_id,board_name,currency,cancellation_policy,payment_terms) VALUES ($1,$2,'BB','EUR',$3::jsonb,$4::jsonb)",
    [w.plan, room, JSON.stringify(VALID_TERMS.cancellationPolicy), JSON.stringify(VALID_TERMS.paymentTerms)]);
  await pool.query("INSERT INTO inventory_daily(rate_plan_id,stay_date,price,allotment) VALUES ($1,$2,100,9),($1,$3,100,9)", [w.plan, checkIn, mid]);
  return w;
}

const reserved = async (w: World) => Number((await pool.query("SELECT coalesce(sum(reserved),0) AS n FROM inventory_daily WHERE rate_plan_id=$1", [w.plan])).rows[0].n);
async function openDirect(w: World) {
  const r = await request("POST", "/api/admin/publications", w.t.admin, { ratePlanId: w.plan, agencyId: w.sub.a, markupType: "percent", markupValue: 10 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
}
const setLimit = (w: World, value: unknown) => request("PATCH", "/api/dmc/subagencies/" + w.sub.a, w.t.masterA, { creditLimitEur: value });
async function bookOnce(w: World) {
  const r = await request("POST", "/api/agency/searches", w.t.subA, {
    checkIn, checkOut, rooms: 1, adults: 2, children: 0, childAges: [],
    roomOccupancies: [{ adults: 2, children: 0, childAges: [] }], nationalities: ["TR"]
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const quote = r.body.results.find((x: any) => x.hotel.id === w.hotel);
  assert.ok(quote?.quoteId);
  assert.equal(Number(quote.total), 230, "200 net + 10% sub markup + 5% seller-DMC platform fee on net");
  const booked = await book(w.t.subA, quote.quoteId);
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  return booked.body;
}
const book = (token: string, quoteId: string) => request("POST", "/api/agency/bookings", token, {
  quoteId,
  guest: { firstName: "Test", lastName: "Guest", adults: 2, children: 0, childAges: [], email: "guest@test.local", phone: "+905551112233", nationality: "TR" },
  otherGuests: [{ firstName: "Second", lastName: "Guest", type: "adult", nationality: "TR" }], operationNote: "Arrival after 18:00"
}, { "Idempotency-Key": randomUUID() });

test("C1 over the credit limit: booking waits for DMC approval and holds no stock; under the limit it is pending", { skip }, async () => {
  const w = await seed();
  await openDirect(w);
  assert.equal((await setLimit(w, 100)).status, 200);
  const waiting = await bookOnce(w);
  assert.equal(waiting.status, "awaiting_credit_approval");
  assert.equal(await reserved(w), 0, "no stock while awaiting approval");
  assert.equal(Number((await pool.query("SELECT count(*) AS n FROM booking_nights WHERE booking_id=$1", [waiting.id])).rows[0].n), 0);
  const proforma = await request("GET", `/api/agency/bookings/${waiting.id}/proforma`, w.t.subA);
  assert.equal(proforma.status, 409, "no proforma before approval");
  const sellerList = await request("GET", "/api/backoffice/bookings", w.t.masterA);
  assert.ok(!sellerList.body.items.some((x: any) => x.id === waiting.id), "seller DMC list hides bookings without stock");
  assert.equal((await request("PATCH", `/api/backoffice/bookings/${waiting.id}/status`, w.t.masterA, { status: "approved" })).status, 404, "hidden from the seller DMC: same answer as a missing booking");

  assert.equal((await setLimit(w, 1000)).status, 200);
  const ok = await bookOnce(w);
  assert.equal(ok.status, "pending");
  assert.equal(await reserved(w), 2, "one room, two nights");
  assert.equal((await setLimit(w, null)).status, 200);
  assert.equal((await bookOnce(w)).status, "pending", "no limit configured means no approval step");
});

test("C2 exposure counts open bookings: the second booking crosses the limit", { skip }, async () => {
  const w = await seed();
  await openDirect(w);
  assert.equal((await setLimit(w, 300)).status, 200);
  assert.equal((await bookOnce(w)).status, "pending");
  assert.equal((await bookOnce(w)).status, "awaiting_credit_approval");
  assert.equal(await reserved(w), 2, "only the first booking holds stock");
});

test("C3 approval takes stock after re-validation; rejection takes none", { skip }, async () => {
  const w = await seed();
  await openDirect(w);
  assert.equal((await setLimit(w, 100)).status, 200);
  const first = await bookOnce(w), second = await bookOnce(w);
  const listed = await request("GET", "/api/dmc/credit-approvals", w.t.masterA);
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.items.map((x: any) => x.id).sort(), [first.id, second.id].sort());
  const approved = await request("POST", `/api/dmc/credit-approvals/${first.id}/approve`, w.t.masterA);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "pending");
  assert.equal(await reserved(w), 2);
  assert.equal(Number((await pool.query("SELECT count(*) AS n FROM booking_nights WHERE booking_id=$1", [first.id])).rows[0].n), 2);
  assert.equal((await request("POST", `/api/dmc/credit-approvals/${first.id}/approve`, w.t.masterA)).status, 404, "already decided");
  const rejected = await request("POST", `/api/dmc/credit-approvals/${second.id}/reject`, w.t.masterA);
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(await reserved(w), 2, "rejection holds and releases nothing");
  assert.equal((await pool.query("SELECT status FROM bookings WHERE id=$1", [second.id])).rows[0].status, "rejected");
  assert.equal((await request("GET", "/api/dmc/credit-approvals", w.t.masterA)).body.items.length, 0);
});

test("C4 another DMC cannot see or decide the booking and gets the same answer as for a missing one", { skip }, async () => {
  const w = await seed();
  await openDirect(w);
  assert.equal((await setLimit(w, 100)).status, 200);
  const waiting = await bookOnce(w);
  assert.equal((await request("GET", "/api/dmc/credit-approvals", w.t.masterB)).body.items.length, 0);
  const missing = randomUUID();
  for (const action of ["approve", "reject"]) {
    const foreign = await request("POST", `/api/dmc/credit-approvals/${waiting.id}/${action}`, w.t.masterB);
    const none = await request("POST", `/api/dmc/credit-approvals/${missing}/${action}`, w.t.masterB);
    assert.equal(foreign.status, 404);
    assert.deepEqual([foreign.status, foreign.body], [none.status, none.body]);
    assert.equal((await request("POST", `/api/dmc/credit-approvals/${waiting.id}/${action}`, w.t.subA)).status, 403);
  }
  assert.equal((await pool.query("SELECT status FROM bookings WHERE id=$1", [waiting.id])).rows[0].status, "awaiting_credit_approval");
});

test("C5 credit limit editing: validation, clearing, DMC-scoped", { skip }, async () => {
  const w = await seed();
  assert.equal((await setLimit(w, "abc")).status, 400);
  assert.equal((await setLimit(w, -5)).status, 400);
  assert.equal((await setLimit(w, "250.50")).status, 200);
  assert.equal((await pool.query("SELECT credit_limit_eur::text AS v FROM agencies WHERE id=$1", [w.sub.a])).rows[0].v, "250.50");
  const listed = await request("GET", "/api/dmc/subagencies", w.t.masterA);
  assert.equal(listed.body.items.find((x: any) => x.id === w.sub.a).credit_limit_eur, "250.50");
  assert.equal((await setLimit(w, null)).status, 200);
  assert.equal((await pool.query("SELECT credit_limit_eur FROM agencies WHERE id=$1", [w.sub.a])).rows[0].credit_limit_eur, null);
  const foreign = await request("PATCH", "/api/dmc/subagencies/" + w.sub.a, w.t.masterB, { creditLimitEur: 1 });
  const none = await request("PATCH", "/api/dmc/subagencies/" + randomUUID(), w.t.masterB, { creditLimitEur: 1 });
  assert.deepEqual([foreign.status, foreign.body], [none.status, none.body]);
  assert.equal((await request("PATCH", "/api/dmc/subagencies/" + w.sub.a, w.t.subA, { creditLimitEur: 1 })).status, 403);
  assert.equal((await request("PATCH", "/api/dmc/subagencies/" + w.sub.a, w.t.masterA, { name: "x" })).status, 400);
});
