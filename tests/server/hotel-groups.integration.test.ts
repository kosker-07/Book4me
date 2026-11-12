import { VALID_TERMS } from "./fixtures/rate-plan-terms";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const skip = !process.env.DATABASE_URL ? "DATABASE_URL required" : false;
if (skip && process.env.CI) throw new Error("DATABASE_URL required in CI");
process.env.SESSION_SECRET ||= "hotel-groups-integration-secret-at-least-32";
let pool: any, server: Server, base: string, hashPassword: (s: string) => string, issueSession: (p: any, s: string) => string;

async function request(method: string, p: string, token: string, body?: unknown) {
  const r = await fetch(base + p, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
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
  const a = id(), b = id(), c = id(), subC = id();
  for (const [agencyId, name, type, parent] of [[a, "Seller A", "master", null], [b, "Seller B", "master", null], [c, "Buyer C", "master", null], [subC, "Buyer Sub", "sub", c]])
    await pool.query("INSERT INTO agencies(id,name,type,parent_agency_id) VALUES ($1,$2,$3,$4)", [agencyId, name, type, parent]);
  const tok: Record<string, string> = {};
  for (const [key, role, agencyId] of [["admin", "system_admin", null], ["sub", "sub_agency", subC]] as const) {
    const uid = id();
    await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES ($1,$2,$3,$4,$5)", [uid, `grp-${key}@test.local`, hashPassword("integration-password-1"), role, agencyId]);
    tok[key] = issueSession({ sub: uid, role, agencyId, ver: 0 }, process.env.SESSION_SECRET!);
  }
  for (const seller of [a, b]) {
    const r = await request("POST", "/api/admin/distribution-rules", tok.admin!, { sellerAgencyId: seller, buyerAgencyId: c, effect: "allow", platformMarginPercent: 0 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  return { a, b, c, tok };
}
async function hotel(owner: string, name: string, location: string, room: string, board: string, price: number) {
  const h = randomUUID(), r = randomUUID(), p = randomUUID();
  await pool.query("INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ($1,$2,$3,$4,'active')", [h, owner, name, location]);
  await pool.query("INSERT INTO rooms(id,hotel_id,name) VALUES ($1,$2,$3)", [r, h, room]);
  await pool.query("INSERT INTO rate_plans(id,room_id,board_name,currency,cancellation_policy,payment_terms) VALUES ($1,$2,$3,'EUR',$4::jsonb,$5::jsonb)",
    [p, r, board, JSON.stringify(VALID_TERMS.cancellationPolicy), JSON.stringify(VALID_TERMS.paymentTerms)]);
  await pool.query("INSERT INTO inventory_daily(rate_plan_id,stay_date,price,allotment) VALUES ($1,$2,$4,9),($1,$3,$4,9)", [p, checkIn, mid, price]);
  return h;
}
async function offers(token: string) {
  const r = await request("POST", "/api/agency/searches", token, { checkIn, checkOut, rooms: 1, adults: 2, children: 0, childAges: [],
    roomOccupancies: [{ adults: 2, children: 0, childAges: [] }], nationalities: ["TR"] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.results as any[];
}

test("G1 the same hotel loaded by two DMCs is grouped automatically: one offer, the cheaper one", { skip }, async () => {
  const w = await world();
  const ha = await hotel(w.a, "Rixos Premium Belek", "Belek", "Deluxe Room", "AI", 100);
  const hb = await hotel(w.b, "RİXOS PREMIUM BELEK HOTEL", "Belek, Antalya", "DELUXE  ROOM", "ai", 90);
  const keys = (await pool.query("SELECT DISTINCT group_key FROM hotels WHERE id = ANY($1)", [[ha, hb]])).rows;
  assert.equal(keys.length, 1, "one group key");
  const list = await offers(w.tok.sub!);
  assert.equal(list.length, 1, JSON.stringify(list.map(o => [o.hotel.name, o.total])));
  assert.equal(list[0].hotel.id, hb);
  assert.equal(list[0].total, "180.00");
});

test("G2 same name in another city, another room or another board stays a separate offer", { skip }, async () => {
  const w = await world();
  await hotel(w.a, "Rixos Premium Belek", "Belek", "Deluxe Room", "AI", 100);
  await hotel(w.b, "Rixos Premium Belek", "Bodrum", "Deluxe Room", "AI", 90);
  await hotel(w.b, "Rixos Premium Belek", "Belek", "Family Suite", "AI", 80);
  await hotel(w.b, "Rixos Premium Belek", "Belek", "Deluxe Room", "UAI", 70);
  assert.equal((await offers(w.tok.sub!)).length, 4);
});

test("G3 group key normalization", { skip }, async () => {
  const k = async (n: string, l: string) => (await pool.query("SELECT hotel_group_key($1,$2) AS k", [n, l])).rows[0].k;
  assert.equal(await k("Çırağan Palace Kempinski", "İstanbul"), await k("CIRAGAN PALACE KEMPINSKI HOTEL", "Istanbul / Beşiktaş"));
  assert.equal(await k("The Xanadu Resort", "Belek"), await k("Xanadu Resort Hotel", "BELEK"));
  assert.notEqual(await k("Xanadu Resort", "Belek"), await k("Xanadu Resort", "Kemer"));
  assert.notEqual(await k("Rixos Premium", "Belek"), await k("Rixos Premium Belek", "Belek"));
});
