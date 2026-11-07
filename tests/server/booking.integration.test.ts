// Integration tests against a real PostgreSQL database with server/migrations applied.
// Required: DATABASE_URL pointing to a THROWAWAY database (all tables are truncated).
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

let server: Server, base = "", pool: any, hashPassword: (p: string) => string;
const ids = {
  master: randomUUID(), subA: randomUUID(), subB: randomUUID(),
  hotel: randomUUID(), room: randomUUID(), ratePlan: randomUUID()
};
const tokens: Record<string, string> = {};

async function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}
const book = (token: string, body: unknown, key = randomUUID()) =>
  call("POST", "/api/agency/bookings", body, token, { "Idempotency-Key": key });
const stay = { checkIn: "2027-06-01", checkOut: "2027-06-03" };
const reservedSum = async () =>
  (await pool.query("SELECT COALESCE(sum(reserved),0)::int AS s FROM inventory_daily WHERE rate_plan_id=$1", [ids.ratePlan])).rows[0].s;

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
  await pool.query(`TRUNCATE agencies, users, hotels, rooms, rate_plans, inventory_daily, agency_hotel_sales,
    bookings, booking_status_history, audit_logs, idempotency_keys CASCADE`);
  await pool.query("INSERT INTO agencies(id,name,type) VALUES ($1,'Master','master'),($2,'Sub A','sub'),($3,'Sub B','sub')",
    [ids.master, ids.subA, ids.subB]);
  const pw = hashPassword("integration-password-1");
  const users: [string, string, string | null][] = [
    ["bo@test.local", "back_office", ids.master], ["a@test.local", "sub_agency", ids.subA], ["b@test.local", "sub_agency", ids.subB]
  ];
  for (const [email, role, agency] of users)
    await pool.query("INSERT INTO users(email,password_hash,role,agency_id) VALUES ($1,$2,$3,$4)", [email, pw, role, agency]);
  await pool.query("INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ($1,$2,'Test Hotel','Antalya','active')", [ids.hotel, ids.master]);
  await pool.query("INSERT INTO rooms(id,hotel_id,name) VALUES ($1,$2,'DBL')", [ids.room, ids.hotel]);
  await pool.query("INSERT INTO rate_plans(id,room_id,board_name,currency) VALUES ($1,$2,'AI','EUR')", [ids.ratePlan, ids.room]);
  await pool.query(`INSERT INTO inventory_daily(rate_plan_id,stay_date,price,allotment)
    VALUES ($1,'2027-06-01',100,5),($1,'2027-06-02',100,5)`, [ids.ratePlan]);
  await pool.query("INSERT INTO agency_hotel_sales(agency_id,hotel_id,rate_plan_id,sell_price,sell_currency) VALUES ($1,$2,$3,120,'EUR')",
    [ids.subA, ids.hotel, ids.ratePlan]);
  for (const [email] of users) {
    const r = await call("POST", "/api/auth/login", { email, password: "integration-password-1" });
    assert.equal(r.status, 200, `login ${email}`);
    tokens[email[0]!] = r.body.token;
  }
});

test("booking creation succeeds and decrements every night exactly once", { skip }, async () => {
  const r = await book(tokens.a!, { ratePlanId: ids.ratePlan, ...stay, rooms: 2, guest: { firstName: "Ali", lastName: "Veli" } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, "pending");
  const rows = (await pool.query("SELECT stay_date::text AS d, reserved FROM inventory_daily WHERE rate_plan_id=$1 ORDER BY stay_date", [ids.ratePlan])).rows;
  assert.deepEqual(rows.map((x: any) => x.reserved), [2, 2]);
});

test("listing hotels (search) does not touch inventory: no hold, no lock row", { skip }, async () => {
  const before = await reservedSum();
  const r = await call("GET", "/api/agency/hotels", undefined, tokens.a);
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 1);
  assert.equal(await reservedSum(), before);
  assert.equal((await pool.query("SELECT count(*)::int AS c FROM bookings")).rows[0].c, 0);
});

test("concurrent bookings never exceed allotment (allotment 5, 20 parallel requests)", { skip }, async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () =>
    book(tokens.a!, { ratePlanId: ids.ratePlan, ...stay, rooms: 1, guest: { firstName: "P", lastName: "Q" } })));
  const statuses = results.map(r => r.status);
  assert.equal(statuses.filter(s => s === 201).length, 5, statuses.join(","));
  assert.equal(statuses.filter(s => s === 409).length, 15, statuses.join(","));
  const rows = (await pool.query("SELECT reserved, allotment FROM inventory_daily WHERE rate_plan_id=$1", [ids.ratePlan])).rows;
  for (const row of rows) assert.ok(row.reserved <= row.allotment && row.reserved === 5);
});

test("a night without allotment rolls back the whole booking (no partial decrement)", { skip }, async () => {
  await pool.query("UPDATE inventory_daily SET allotment=0 WHERE rate_plan_id=$1 AND stay_date='2027-06-02'", [ids.ratePlan]);
  const r = await book(tokens.a!, { ratePlanId: ids.ratePlan, ...stay, rooms: 1, guest: { firstName: "A", lastName: "B" } });
  assert.equal(r.status, 409);
  assert.equal(await reservedSum(), 0);
});

test("a sub-agency cannot book a rate plan published only to another sub-agency", { skip }, async () => {
  const r = await book(tokens.b!, { ratePlanId: ids.ratePlan, ...stay, rooms: 1, guest: { firstName: "A", lastName: "B" } });
  assert.equal(r.status, 404);
  assert.equal(await reservedSum(), 0);
});

test("replaying the same Idempotency-Key returns the original booking without a second decrement", { skip }, async () => {
  const key = randomUUID(), body = { ratePlanId: ids.ratePlan, ...stay, rooms: 1, guest: { firstName: "A", lastName: "B" } };
  const first = await book(tokens.a!, body, key);
  const second = await book(tokens.a!, body, key);
  assert.equal(first.status, 201);
  assert.equal(second.body.id, first.body.id);
  assert.equal(await reservedSum(), 2); // 1 room x 2 nights, counted once
});
