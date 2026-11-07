import test, { before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import app from "../../server/app";
import { pool } from "../../server/db";
import { hashPassword, issueSession } from "../../server/security";

const secret = "integration-test-secret-at-least-32-characters";
let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let token = "";
let agencyId = "";
let userId = "";
let hotelId = "";
let ratePlanId = "";
let inventoryIds: string[] = [];

before(async () => {
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not bind test HTTP server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await pool.end();
});

beforeEach(async () => {
  await pool.query(`TRUNCATE idempotency_keys,audit_logs,booking_status_history,bookings,agency_hotel_sales,
    inventory_daily,rate_plans,rooms,hotels,users,agencies CASCADE`);
  agencyId = randomUUID();
  userId = randomUUID();
  hotelId = randomUUID();
  ratePlanId = randomUUID();
  const roomId = randomUUID();
  await pool.query("INSERT INTO agencies(id,name,type,active) VALUES ($1,'Integration Master','master',true)", [randomUUID()]);
  const masterResult = await pool.query("SELECT id FROM agencies WHERE name='Integration Master'");
  const masterId = masterResult.rows[0].id as string;
  await pool.query("INSERT INTO agencies(id,name,type,active) VALUES ($1,'Integration Sub','sub',true)", [agencyId]);
  await pool.query(
    "INSERT INTO users(id,agency_id,email,password_hash,role,active) VALUES ($1,$2,$3,$4,'sub_agency',true)",
    [userId, agencyId, `sub-${userId}@example.test`, hashPassword("integration-password-123")]
  );
  await pool.query(
    "INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ($1,$2,'Integration Hotel','Antalya','active')",
    [hotelId, masterId]
  );
  await pool.query("INSERT INTO rooms(id,hotel_id,name,active) VALUES ($1,$2,'Standard',true)", [roomId, hotelId]);
  await pool.query(
    "INSERT INTO rate_plans(id,room_id,board_name,currency,active) VALUES ($1,$2,'Breakfast','EUR',true)",
    [ratePlanId, roomId]
  );
  await pool.query(
    "INSERT INTO agency_hotel_sales(agency_id,hotel_id,rate_plan_id,sell_price,sell_currency,active) VALUES ($1,$2,$3,100,'EUR',true)",
    [agencyId, hotelId, ratePlanId]
  );
  const dates = ["2027-06-10", "2027-06-11"];
  inventoryIds = [];
  for (const stayDate of dates) {
    const id = randomUUID();
    inventoryIds.push(id);
    await pool.query(
      "INSERT INTO inventory_daily(id,rate_plan_id,stay_date,price,allotment,reserved) VALUES ($1,$2,$3,100,2,0)",
      [id, ratePlanId, stayDate]
    );
  }
  token = issueSession({ sub: userId, role: "sub_agency", agencyId }, secret);
});

afterEach(async () => {
  await pool.query("TRUNCATE idempotency_keys,audit_logs,booking_status_history,bookings,agency_hotel_sales,inventory_daily,rate_plans,rooms,hotels,users,agencies CASCADE");
});

test("K1: creates booking over two nights and reserves one room on each night", async () => {
  const response = await fetch(`${baseUrl}/api/agency/bookings`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "Idempotency-Key": randomUUID()
    },
    body: JSON.stringify({
      ratePlanId,
      checkIn: "2027-06-10",
      checkOut: "2027-06-12",
      rooms: 1,
      guest: { firstName: "Test", lastName: "Guest", email: "guest@example.test" }
    })
  });
  const body = await response.json() as { id?: string; status?: string; error?: string };
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.status, "pending");
  const rows = await pool.query(
    "SELECT stay_date,reserved FROM inventory_daily WHERE id = ANY($1::uuid[]) ORDER BY stay_date",
    [inventoryIds]
  );
  assert.equal(rows.rowCount, 2);
  assert.deepEqual(rows.rows.map(row => Number(row.reserved)), [1, 1]);
});
