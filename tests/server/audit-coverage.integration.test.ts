// Audit coverage: every mutating management endpoint must append an audit row with the actor, the
// tenant it acted on and the entity it touched. Enumerated behaviourally (one request per route)
// rather than by grepping the source, so a route that silently stops auditing fails here.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const skip = !process.env.DATABASE_URL ? "DATABASE_URL required" : false;
if (skip && process.env.CI) throw new Error("DATABASE_URL required in CI");
process.env.SESSION_SECRET ||= "audit-coverage-secret-at-least-32-char";

let pool: any, server: Server, base = "", hashPassword: (p: string) => string;
const PW = "audit-password-1";

const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
};

before(async () => {
  if (skip) return;
  ({ pool, hashPassword } = await import("../../server/security").then(async s => ({ pool: (await import("../../server/db")).pool, hashPassword: s.hashPassword })));
  const { default: app } = await import("../../server/app");
  server = app.listen(0);
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(async () => { if (!skip) { server.close(); await pool.end(); } });

beforeEach(async () => {
  if (skip) return;
  await pool.query(`TRUNCATE agencies, users, hotels, rooms, rate_plans, inventory_daily, agency_hotel_sales,
    bookings, booking_status_history, audit_logs, idempotency_keys, fx_rates, login_attempts, vouchers,
    market_groups, fx_rate_history, proforma_counters CASCADE`);
  // platform_settings is seeded by a migration (single row id=1); truncating it would delete that
  // seed and break later tests. Reset the columns instead.
  await pool.query("INSERT INTO platform_settings(id) VALUES (1) ON CONFLICT(id) DO NOTHING");
  await pool.query("UPDATE platform_settings SET legal_name=NULL, address=NULL, tax_office=NULL, tax_number=NULL, phone=NULL, email=NULL WHERE id=1");
  await pool.query("INSERT INTO users(email,password_hash,role,agency_id) VALUES ('audit-admin@test.local',$1,'system_admin',NULL)",
    [hashPassword(PW)]);
});

const token = async () => {
  const r = await call("POST", "/api/auth/login", { email: "audit-admin@test.local", password: PW });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token as string;
};

/** Audit rows written after `since`, newest first. */
const auditSince = async (since: number) =>
  (await pool.query("SELECT action, entity_type, entity_id, actor_id, agency_id FROM audit_logs WHERE id > $1 ORDER BY id", [since])).rows;
const auditMark = async () => Number((await pool.query("SELECT coalesce(max(id),0) AS m FROM audit_logs")).rows[0].m);

/** Assert exactly one new audit row with this action and entity type, and return it. */
async function expectAudit(mark: number, action: string, entityType: string) {
  const rows = await auditSince(mark);
  const match = rows.find((r: any) => r.action === action && r.entity_type === entityType);
  assert.ok(match, `expected audit ${action}/${entityType}, got ${JSON.stringify(rows.map((r: any) => r.action))}`);
  assert.ok(match.actor_id, `${action} must record the acting user`);
  assert.ok(match.entity_id, `${action} must record the entity id`);
  return match;
}

test("A1 platform settings update is audited", { skip }, async () => {
  const t = await token();
  const mark = await auditMark();
  const r = await call("PUT", "/api/admin/platform-settings", { legal_name: "BED4BOOK A.Ş." }, t);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await expectAudit(mark, "platform_settings.updated", "platform_settings");
});

test("A2 hotel create, update, status change and delete are each audited", { skip }, async () => {
  const t = await token();
  const agency = await call("POST", "/api/admin/agencies", { name: "Audit DMC", type: "master" }, t);
  assert.equal(agency.status, 201);

  let mark = await auditMark();
  const hotel = await call("POST", "/api/admin/hotels", { name: "Audit Otel", location: "İzmir", ownerAgencyId: agency.body.id }, t);
  assert.equal(hotel.status, 201, JSON.stringify(hotel.body));
  const created = await expectAudit(mark, "hotel.created", "hotel");
  assert.equal(created.agency_id, agency.body.id, "hotel audit is attributed to the owning agency");

  mark = await auditMark();
  assert.equal((await call("PATCH", `/api/admin/hotels/${hotel.body.id}`, { name: "Audit Otel 2" }, t)).status, 200);
  await expectAudit(mark, "hotel.updated", "hotel");

  mark = await auditMark();
  assert.equal((await call("PATCH", `/api/admin/hotels/${hotel.body.id}`, { status: "active" }, t)).status, 200);
  await expectAudit(mark, "hotel.status.active", "hotel");

  // A hotel is only deletable while empty and draft/inactive (J2 guard), so delete a fresh empty one.
  const empty = await call("POST", "/api/admin/hotels", { name: "Audit Boş Otel", location: "Bursa", ownerAgencyId: agency.body.id }, t);
  assert.equal(empty.status, 201);
  mark = await auditMark();
  assert.equal((await call("DELETE", `/api/admin/hotels/${empty.body.id}`, undefined, t)).status, 200);
  await expectAudit(mark, "hotel.deleted", "hotel");
  // A non-empty/active hotel is refused and must not leave a false hotel.deleted audit.
  mark = await auditMark();
  assert.equal((await call("DELETE", `/api/admin/hotels/${hotel.body.id}`, undefined, t)).status, 409);
  assert.deepEqual(await auditSince(mark), [], "refused delete writes no audit");
});

test("A3 room create, update and delete are each audited", { skip }, async () => {
  const t = await token();
  const agency = await call("POST", "/api/admin/agencies", { name: "Audit DMC 2", type: "master" }, t);
  const hotel = await call("POST", "/api/admin/hotels", { name: "Audit Otel 3", location: "Bursa", ownerAgencyId: agency.body.id }, t);

  let mark = await auditMark();
  const room = await call("POST", `/api/admin/hotels/${hotel.body.id}/rooms`, { name: "Oda", maxAdults: 2, maxChildren: 0 }, t);
  assert.equal(room.status, 201, JSON.stringify(room.body));
  await expectAudit(mark, "room.created", "room");

  mark = await auditMark();
  assert.equal((await call("PATCH", `/api/admin/rooms/${room.body.id}`, { maxAdults: 3 }, t)).status, 200);
  await expectAudit(mark, "room.updated", "room");

  mark = await auditMark();
  assert.equal((await call("DELETE", `/api/admin/rooms/${room.body.id}`, undefined, t)).status, 200);
  await expectAudit(mark, "room.deleted", "room");
});

test("A4 rate plan create/update, calendar update and stop-sale are each audited", { skip }, async () => {
  const t = await token();
  const agency = await call("POST", "/api/admin/agencies", { name: "Audit DMC 3", type: "master" }, t);
  const hotel = await call("POST", "/api/admin/hotels", { name: "Audit Otel 4", location: "Antalya", ownerAgencyId: agency.body.id }, t);
  const room = await call("POST", `/api/admin/hotels/${hotel.body.id}/rooms`, { name: "Oda", maxAdults: 2, maxChildren: 0 }, t);

  let mark = await auditMark();
  const plan = await call("POST", `/api/admin/rooms/${room.body.id}/rate-plans`, {
    boardName: "BB", currency: "EUR",
    cancellationPolicy: { freeUntilDays: 7, penaltyType: "nights", penaltyValue: 1, noShowPenaltyType: "percent", noShowPenaltyValue: 100 },
    paymentTerms: { dueDaysBeforeCheckIn: 14 }
  }, t);
  assert.equal(plan.status, 201, JSON.stringify(plan.body));
  await expectAudit(mark, "rate_plan.created", "rate_plan");

  const day = (o: number) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
  mark = await auditMark();
  assert.equal((await call("PUT", `/api/admin/rate-plans/${plan.body.id}/calendar`,
    { dateFrom: day(1), dateTo: day(3), price: 100, allotment: 5 }, t)).status, 200);
  await expectAudit(mark, "calendar.updated", "rate_plan");

  mark = await auditMark();
  assert.equal((await call("PATCH", `/api/admin/rate-plans/${plan.body.id}`, { active: false }, t)).status, 200);
  await expectAudit(mark, "rate_plan.stop_sale", "rate_plan");
});

test("A5 agency and user create/update are audited", { skip }, async () => {
  const t = await token();
  let mark = await auditMark();
  const agency = await call("POST", "/api/admin/agencies", { name: "Audit DMC 4", type: "master" }, t);
  assert.equal(agency.status, 201, JSON.stringify(agency.body));
  await expectAudit(mark, "agency.created", "agency");

  mark = await auditMark();
  assert.equal((await call("PATCH", `/api/admin/agencies/${agency.body.id}`, { active: false }, t)).status, 200);
  await expectAudit(mark, "agency.updated", "agency");

  mark = await auditMark();
  const user = await call("POST", "/api/admin/users", { email: "audited@test.local", password: PW, role: "master_agency", agencyId: agency.body.id }, t);
  assert.equal(user.status, 201, JSON.stringify(user.body));
  await expectAudit(mark, "user.created", "user");
});

test("A6 a failed mutation writes no audit row (no false audit trail)", { skip }, async () => {
  const t = await token();
  const mark = await auditMark();
  // Missing name → 400 before any write.
  const bad = await call("POST", "/api/admin/hotels", { location: "İzmir" }, t);
  assert.equal(bad.status, 400);
  assert.deepEqual(await auditSince(mark), [], "a rejected request must not claim to have changed anything");
});
