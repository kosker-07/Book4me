import { pdfText } from "../helpers/pdf-text";
import { VALID_TERMS } from "./fixtures/rate-plan-terms";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const skip = !process.env.DATABASE_URL ? "DATABASE_URL required" : false;
if (skip && process.env.CI) throw new Error("DATABASE_URL required in CI");
process.env.SESSION_SECRET ||= "price-chain-integration-secret-at-least-32";
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
    await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES ($1,$2,$3,$4,$5)", [userId, `chain-${key}@test.local`, hashPassword(PW), role, agencyId]);
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

/** Rule-based marketplace sale: platform margin 10%, buyer DMC markup 20% => 100 -> 110 -> 132 per night. */
async function openMarketplace(w: World) {
  const r = await request("POST", "/api/admin/distribution-rules", w.t.admin, { sellerAgencyId: w.dmc.a, buyerAgencyId: w.dmc.b, effect: "allow", platformMarginPercent: 10 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
}
/** Direct DMC sale: publication markup 10% plus the 5% platform fee on the net => 100 -> 110 + 5 = 115 per night. */
async function openDirect(w: World) {
  const r = await request("POST", "/api/admin/publications", w.t.admin, { ratePlanId: w.plan, agencyId: w.sub.a, markupType: "percent", markupValue: 10 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
}
const search = async (token: string, w: World) => {
  const r = await request("POST", "/api/agency/searches", token, {
    checkIn, checkOut, rooms: 1, adults: 2, children: 0, childAges: [],
    roomOccupancies: [{ adults: 2, children: 0, childAges: [] }], nationalities: ["TR"]
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const quote = r.body.results.find((x: any) => x.hotel.id === w.hotel);
  assert.ok(quote?.quoteId, "hotel offered");
  return quote;
};
const book = (token: string, quoteId: string, draft = false) => request("POST", "/api/agency/bookings", token, {
  quoteId, ...(draft ? { draft: true } : {}),
  guest: { firstName: "Test", lastName: "Guest", adults: 2, children: 0, childAges: [], email: "guest@test.local", phone: "+905551112233", nationality: "TR" },
  otherGuests: [{ firstName: "Second", lastName: "Guest", type: "adult", nationality: "TR" }], operationNote: "Arrival after 18:00"
}, { "Idempotency-Key": randomUUID() });

/** Search, draft and real booking must all quote the same total; returns the booking id. */
async function sameTotalEverywhere(token: string, w: World, expectedTotal: number) {
  const searched = await search(token, w);
  assert.equal(Number(searched.total), expectedTotal, "search total");
  const draft = await book(token, (await search(token, w)).quoteId, true);
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  assert.equal(draft.body.status, "draft");
  assert.equal(Number(draft.body.total), expectedTotal, "draft total");
  const booked = await book(token, (await search(token, w)).quoteId);
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  assert.equal(Number(booked.body.total), expectedTotal, "booking total");
  return booked.body.id as string;
}

test("T3 distribution-rule sale: net 100 + 10% margin + 20% buyer markup = 132.00 per night, no platform fee fields", { skip }, async () => {
  const w = await seed();
  await openMarketplace(w);
  const bookingId = await sameTotalEverywhere(w.t.subB, w, 264);
  const nights = (await pool.query("SELECT sell_price::text AS sell, marketplace_platform_fee_percent::text AS pct, marketplace_platform_fee::text AS fee FROM booking_nights WHERE booking_id=$1 ORDER BY stay_date", [bookingId])).rows;
  assert.equal(nights.length, 2);
  for (const n of nights) {
    assert.equal(Number(n.sell), 132, "nightly sale price");
    assert.equal(n.pct, null, "no platform fee percent on a marketplace sale");
    assert.equal(Number(n.fee ?? 0), 0, "no platform fee amount on a marketplace sale");
  }
});

test("T5 proforma shows only the total: no net, margin, fee line or DMC name", { skip }, async () => {
  const w = await seed();
  await openMarketplace(w);
  await openDirect(w);
  for (const [token, total, hidden] of [[w.t.subB, "264.00", ["132.00", "110.00", "100.00"]], [w.t.subA, "230.00", ["115.00", "110.00", "100.00", "5.00 EUR"]]] as const) {
    const id = await sameTotalEverywhere(token, w, Number(total));
    const res = await request("GET", `/api/agency/bookings/${id}/proforma`, token);
    assert.ok(res.status === 200 || res.status === 201, "proforma status " + res.status);
    const text = await pdfText(res.raw!);
    assert.ok(text.includes(total), "proforma shows the total " + total);
    for (const h of hidden) assert.ok(!text.includes(h), "proforma leaks " + h);
    assert.ok(!/service fee|hizmet bedeli|platform fee|margin|marj|markup/i.test(text), "proforma has a fee/margin line");
    for (const name of ["Seller DMC Alpha", "Buyer DMC Bravo"]) assert.ok(!text.includes(name), "proforma leaks DMC name " + name);
  }
});

test("T6 permissions: DMC edits only its own markup, platform fee is operator-only, back office manages active and parent", { skip }, async () => {
  const w = await seed();
  const own = "/api/admin/agencies/" + w.dmc.a, other = "/api/admin/agencies/" + w.dmc.b;
  assert.equal((await request("PATCH", own, w.t.masterA, { marketplaceMarkupPercent: 12.5 })).status, 200);
  assert.equal((await pool.query("SELECT marketplace_markup_percent::text AS v FROM agencies WHERE id=$1", [w.dmc.a])).rows[0].v, "12.500");
  assert.equal((await request("PATCH", own, w.t.masterA, { platformFeePercent: 9 })).status, 403);
  assert.equal(Number((await pool.query("SELECT platform_fee_percent::text AS v FROM agencies WHERE id=$1", [w.dmc.a])).rows[0].v), 5, "fee unchanged after 403");
  assert.equal((await request("PATCH", other, w.t.masterA, { marketplaceMarkupPercent: 1 })).status, 404);
  assert.equal((await request("PATCH", other, w.t.masterA, { platformFeePercent: 1 })).status, 404);
  assert.equal(Number((await pool.query("SELECT marketplace_markup_percent::text AS v FROM agencies WHERE id=$1", [w.dmc.b])).rows[0].v), 20, "other DMC untouched");

  assert.equal((await request("PATCH", own, w.t.admin, { platformFeePercent: 7 })).status, 200);
  assert.equal((await request("PATCH", own, w.t.office, { platformFeePercent: 6 })).status, 200);
  assert.equal(Number((await pool.query("SELECT platform_fee_percent::text AS v FROM agencies WHERE id=$1", [w.dmc.a])).rows[0].v), 6);

  const subPath = "/api/admin/agencies/" + w.sub.a;
  assert.equal((await request("PATCH", subPath, w.t.office, { active: false })).status, 200);
  assert.equal((await pool.query("SELECT active FROM agencies WHERE id=$1", [w.sub.a])).rows[0].active, false);
  assert.equal((await request("PATCH", subPath, w.t.office, { active: true, parentAgencyId: w.dmc.b })).status, 200);
  const moved = (await pool.query("SELECT active, parent_agency_id FROM agencies WHERE id=$1", [w.sub.a])).rows[0];
  assert.equal(moved.active, true);
  assert.equal(moved.parent_agency_id, w.dmc.b);
  assert.equal((await request("PATCH", subPath, w.t.subA, { active: false })).status, 403);
});

test("T7 search total = draft total = booking total in every price scenario", { skip }, async () => {
  const w = await seed();
  await openMarketplace(w);
  await openDirect(w);
  await sameTotalEverywhere(w.t.subB, w, 264);
  await sameTotalEverywhere(w.t.subA, w, 230);
  // A changed fee must change the next quote and still agree across search, draft and booking.
  assert.equal((await request("PATCH", "/api/admin/agencies/" + w.dmc.a, w.t.admin, { platformFeePercent: 8 })).status, 200);
  await sameTotalEverywhere(w.t.subA, w, 236);
  // A changed buyer markup changes the marketplace quote consistently too.
  assert.equal((await request("PATCH", "/api/admin/agencies/" + w.dmc.b, w.t.masterB, { marketplaceMarkupPercent: 10 })).status, 200);
  await sameTotalEverywhere(w.t.subB, w, 242);
});
