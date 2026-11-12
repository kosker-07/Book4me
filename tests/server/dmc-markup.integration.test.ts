import { VALID_TERMS } from "./fixtures/rate-plan-terms";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const skip = !process.env.DATABASE_URL ? "DATABASE_URL required" : false;
if (skip && process.env.CI) throw new Error("DATABASE_URL required in CI");
process.env.SESSION_SECRET ||= "dmc-markup-integration-secret-at-least-32";
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
  await pool.query(`TRUNCATE agencies, users, hotels, rooms, rate_plans, inventory_daily, agency_hotel_sales, bookings, booking_status_history,
    booking_nights, audit_logs, idempotency_keys, fx_rates, login_attempts, vouchers, market_groups, fx_rate_history, proforma_counters CASCADE`);
});
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const checkIn = day(40), mid = day(41), checkOut = day(42);

async function world() {
  const id = () => randomUUID();
  const a = id(), b = id(), subA = id(), subB = id();
  for (const [agencyId, name, type, parent] of [[a, "DMC A", "master", null], [b, "DMC B", "master", null], [subA, "Sub A", "sub", a], [subB, "Sub B", "sub", b]])
    await pool.query("INSERT INTO agencies(id,name,type,parent_agency_id) VALUES ($1,$2,$3,$4)", [agencyId, name, type, parent]);
  const t: Record<string, string> = {};
  for (const [key, role, agencyId] of [["masterA", "master_agency", a], ["masterB", "master_agency", b], ["subA", "sub_agency", subA]] as const) {
    const uid = id();
    await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES ($1,$2,$3,$4,$5)", [uid, `mk-${key}@test.local`, hashPassword("integration-password-1"), role, agencyId]);
    t[key] = issueSession({ sub: uid, role, agencyId, ver: 0 }, process.env.SESSION_SECRET!);
  }
  const plans: string[] = [];
  for (const [name, terms] of [["Hotel One", true], ["Hotel Two", true], ["Hotel Three", false]] as const) {
    const h = id(), r = id(), p = id();
    await pool.query("INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ($1,$2,$3,'Antalya','active')", [h, a, name]);
    await pool.query("INSERT INTO rooms(id,hotel_id,name) VALUES ($1,$2,'Double')", [r, h]);
    await pool.query("INSERT INTO rate_plans(id,room_id,board_name,currency,cancellation_policy,payment_terms) VALUES ($1,$2,'BB','EUR',$3::jsonb,$4::jsonb)",
      [p, r, terms ? JSON.stringify(VALID_TERMS.cancellationPolicy) : "{}", terms ? JSON.stringify(VALID_TERMS.paymentTerms) : "{}"]);
    await pool.query("INSERT INTO inventory_daily(rate_plan_id,stay_date,price,allotment) VALUES ($1,$2,100,9),($1,$3,100,9)", [p, checkIn, mid]);
    plans.push(p);
  }
  return { a, b, subA, subB, t, plans };
}
const search = async (token: string) => {
  const r = await request("POST", "/api/agency/searches", token, { checkIn, checkOut, rooms: 1, adults: 2, children: 0, childAges: [],
    roomOccupancies: [{ adults: 2, children: 0, childAges: [] }], nationalities: ["TR"] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.results as any[];
};

test("D2 bulk margin: publishAll opens every sellable plan, the next search uses the new margin, old bookings keep their price", { skip }, async () => {
  const w = await world();
  const first = await request("PUT", `/api/dmc/subagencies/${w.subA}/markup`, w.t.masterA, { markupPercent: 10, publishAll: true });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body, { markupPercent: 10, updated: 0, published: 2, skippedNoTerms: 1 });
  let offers = await search(w.t.subA);
  assert.equal(offers.length, 2);
  assert.ok(offers.every(o => o.total === "220.00"), JSON.stringify(offers.map(o => o.total)));
  const booked = await request("POST", "/api/agency/bookings", w.t.subA, { quoteId: offers[0].quoteId,
    guest: { firstName: "Test", lastName: "Guest", adults: 2, children: 0, childAges: [], email: "g@test.local", phone: "+905551112233", nationality: "TR" },
    otherGuests: [{ firstName: "Second", lastName: "Guest", type: "adult", nationality: "TR" }] });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  const second = await request("PUT", `/api/dmc/subagencies/${w.subA}/markup`, w.t.masterA, { markupPercent: 25.5 });
  assert.deepEqual(second.body, { markupPercent: 25.5, updated: 2, published: 0, skippedNoTerms: 0 });
  offers = await search(w.t.subA);
  assert.ok(offers.every(o => o.total === "251.00"), JSON.stringify(offers.map(o => o.total)));
  assert.equal((await pool.query("SELECT total::text FROM bookings WHERE id=$1", [booked.body.id])).rows[0].total, "220.00", "existing booking unchanged");
  assert.equal(Number((await pool.query("SELECT count(*) AS n FROM audit_logs WHERE action='publication.bulk_markup'")).rows[0].n), 2);
});

test("D2b another DMC's sub-agency answers like a missing one; only master agencies may call it", { skip }, async () => {
  const w = await world();
  const foreign = await request("PUT", `/api/dmc/subagencies/${w.subB}/markup`, w.t.masterA, { markupPercent: 5 });
  const missing = await request("PUT", `/api/dmc/subagencies/${randomUUID()}/markup`, w.t.masterA, { markupPercent: 5 });
  assert.deepEqual([foreign.status, foreign.body], [missing.status, missing.body]);
  assert.equal(foreign.status, 404);
  assert.equal((await request("PUT", `/api/dmc/subagencies/${w.subA}/markup`, w.t.subA, { markupPercent: 5 })).status, 403);
  assert.equal((await request("PUT", `/api/dmc/subagencies/${w.subA}/markup`, w.t.masterB, { markupPercent: 5, publishAll: true })).status, 404);
  assert.equal(Number((await pool.query("SELECT count(*) AS n FROM agency_hotel_sales")).rows[0].n), 0);
});

test("D2c validation: 0-100, at most 3 decimals, no unknown fields; inactive sub cannot be opened", { skip }, async () => {
  const w = await world();
  for (const body of [{ markupPercent: -1 }, { markupPercent: 100.5 }, { markupPercent: 1.2345 }, { markupPercent: "10" }, { markupPercent: 5, x: 1 }, { markupPercent: 5, publishAll: "yes" }]) {
    const r = await request("PUT", `/api/dmc/subagencies/${w.subA}/markup`, w.t.masterA, body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal((await request("PUT", `/api/dmc/subagencies/${w.subA}/markup`, w.t.masterA, { markupPercent: 0 })).status, 200);
  assert.equal((await request("PATCH", `/api/dmc/subagencies/${w.subA}`, w.t.masterA, { active: false })).status, 200);
  assert.equal((await request("PUT", `/api/dmc/subagencies/${w.subA}/markup`, w.t.masterA, { markupPercent: 5, publishAll: true })).status, 409);
});
