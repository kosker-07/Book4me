// Integration probes against a real PostgreSQL 16 instance.
// Usage (from repo root, against a THROWAWAY database with 001_initial.sql applied):
//   PROBE_DATABASE_URL=postgres://... npx tsx docs/reviews/probes/v1_api_probe.ts
// Optional APP_DIR points to an alternative copy of server/ (e.g. one with the $2 fix applied).
// WARNING: the script TRUNCATEs all tables. Never point it at a real database.
process.env.DATABASE_URL = process.env.PROBE_DATABASE_URL || "postgres://postgres@localhost:5433/b4b";
process.env.SESSION_SECRET = "probe-secret-with-at-least-thirty-two-chars!!";
import { randomUUID } from "node:crypto";

const log = (name: string, ok: boolean, detail: unknown) =>
  console.log(`${ok ? "CONFIRMED" : "not-reproduced"} | ${name} | ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);

async function main() {
  const which = process.env.APP_DIR || "../../../server";
  const { default: app } = await import(`${which}/app`);
  const { pool } = await import(`${which}/db`);
  const { hashPassword } = await import(`${which}/security`);
  await pool.query("TRUNCATE agencies, users, hotels, rooms, rate_plans, inventory_daily, agency_hotel_sales, bookings, booking_status_history, audit_logs, idempotency_keys CASCADE");

  const server = app.listen(0);
  const port = (server.address() as any).port;
  const call = async (method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
    });
    let json: any = null; try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };

  const pw = hashPassword("correct-horse-battery");
  const master = randomUUID(), master2 = randomUUID(), subA = randomUUID(), subB = randomUUID();
  await pool.query("INSERT INTO agencies(id,name,type) VALUES ($1,'Master','master'),($2,'Master2','master'),($3,'SubA','sub'),($4,'SubB','sub')", [master, master2, subA, subB]);
  const users: Record<string, [string, string | null, string]> = {
    admin: ["system_admin", null, "admin@x.test"], mgr: ["master_agency", master, "mgr@x.test"], mgr2: ["master_agency", master2, "mgr2@x.test"],
    bo: ["back_office", master, "bo@x.test"], a: ["sub_agency", subA, "a@x.test"], b: ["sub_agency", subB, "b@x.test"],
    // role/agency type mismatch is accepted by the schema:
    weird: ["master_agency", subA, "weird@x.test"]
  };
  for (const [, [role, ag, email]] of Object.entries(users))
    await pool.query("INSERT INTO users(agency_id,email,password_hash,role) VALUES ($1,$2,$3,$4)", [ag, email, pw, role]);
  const tok: Record<string, string> = {};
  for (const [k, [, , email]] of Object.entries(users)) tok[k] = (await call("POST", "/api/auth/login", { email, password: "correct-horse-battery" })).body.token;
  log("schema accepts role/agency-type mismatch (master_agency user under a sub agency)", !!tok.weird, "login ok");

  // Inventory: hotel H (active), room, rate plan RP, 3 nights, allotment 2, daily price 100/200/300
  const H = randomUUID(), R = randomUUID(), RP = randomUUID();
  await pool.query("INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ($1,$2,'Hotel H','Antalya','active')", [H, master]);
  await pool.query("INSERT INTO rooms(id,hotel_id,name) VALUES ($1,$2,'DBL')", [R, H]);
  await pool.query("INSERT INTO rate_plans(id,room_id,board_name,currency) VALUES ($1,$2,'AI','EUR')", [RP, R]);
  await pool.query("INSERT INTO inventory_daily(rate_plan_id,stay_date,price,allotment) VALUES ($1,'2027-06-01',100,2),($1,'2027-06-02',200,2),($1,'2027-06-03',300,2)", [RP]);
  await pool.query("INSERT INTO agency_hotel_sales(agency_id,hotel_id,rate_plan_id,sell_price,sell_currency) VALUES ($1,$2,$3,50,'TRY')", [subA, H, RP]);

  const book = (token: string, body: any, key = randomUUID()) => call("POST", "/api/agency/bookings", body, token, { "Idempotency-Key": key });
  const base = { ratePlanId: RP, checkIn: "2027-06-01", checkOut: "2027-06-03", rooms: 1, guest: { firstName: "Ali", lastName: "Veli" } };

  const first = await book(tok.a, base);
  log("P1 booking creation (happy path)", first.status !== 201, first);
  if (first.status !== 201) {
    console.log("   -> booking endpoint unusable; remaining probes need APP_DIR=<copy of server/ with the $2 fix>");
    server.close(); await pool.end(); return;
  }
  log("P2 price ignores inventory_daily.price (100+200) and rate plan currency EUR", first.body.total === 100 && first.body.currency === "TRY", first.body);

  // P3 isolation positive checks
  const bOnA = await book(tok.b, base);
  log("P3 isolation: sub B cannot book rate plan published only to A (expected 404 = correct)", bOnA.status !== 404, bOnA);
  const boListMgr2 = await call("GET", "/api/backoffice/bookings", undefined, tok.mgr2);
  log("P3b isolation: other master agency sees no bookings (expected 0 = correct)", boListMgr2.body.items.length !== 0, boListMgr2.body.items.length);

  // P4 invalid inputs -> 500 instead of 400
  const badUuid = await book(tok.a, { ...base, ratePlanId: "not-a-uuid" });
  log("P4a non-UUID ratePlanId returns 500", badUuid.status === 500, badUuid);
  const badDate = await book(tok.a, { ...base, checkIn: "2027-13-01" });
  log("P4b impossible date 2027-13-01 returns non-400", badDate.status !== 400, badDate);
  const feb30 = await book(tok.a, { ...base, checkIn: "2027-02-30", checkOut: "2027-03-02" });
  log("P4c 2027-02-30 not rejected as 400", feb30.status !== 400, feb30);
  const patchBad = await call("PATCH", "/api/backoffice/bookings/xyz/status", { status: "approved" }, tok.bo);
  log("P4d PATCH with non-UUID id returns 500", patchBad.status === 500, patchBad);
  const pastStay = await call("POST", "/api/agency/bookings", { ...base, checkIn: "2020-01-01", checkOut: "2020-01-02" }, tok.a, { "Idempotency-Key": randomUUID() });
  log("P4e past check-in date is not rejected with a validation error (404/409 on inventory only)", pastStay.status !== 400, pastStay);

  // P5 reject does not release allotment
  const before = (await pool.query("SELECT sum(reserved)::int s FROM inventory_daily WHERE rate_plan_id=$1", [RP])).rows[0].s;
  const rej = await call("PATCH", `/api/backoffice/bookings/${first.body.id}/status`, { status: "rejected" }, tok.bo);
  const after = (await pool.query("SELECT sum(reserved)::int s FROM inventory_daily WHERE rate_plan_id=$1", [RP])).rows[0].s;
  log("P5 rejection does not release reserved allotment", rej.status === 200 && after === before, { rej: rej.status, before, after });

  // P6 approved booking can never be cancelled
  const b2 = await book(tok.a, base);
  await call("PATCH", `/api/backoffice/bookings/${b2.body.id}/status`, { status: "approved" }, tok.bo);
  const cancelApproved = await call("PATCH", `/api/backoffice/bookings/${b2.body.id}/status`, { status: "cancelled" }, tok.bo);
  log("P6 approved booking cannot be cancelled", cancelApproved.status === 409, cancelApproved);
  // now allotment fully consumed by a rejected + an approved booking
  const full = await book(tok.a, base);
  log("P6b allotment exhausted by rejected booking -> new booking refused", full.status === 409, full);

  // P7 concurrency: fresh allotment 5, 20 parallel requests
  await pool.query("UPDATE inventory_daily SET allotment=5, reserved=0 WHERE rate_plan_id=$1", [RP]);
  const results = await Promise.all(Array.from({ length: 20 }, () => book(tok.a, base)));
  const ok = results.filter(r => r.status === 201).length, conflict = results.filter(r => r.status === 409).length, other = results.filter(r => ![201, 409].includes(r.status));
  const maxRes = (await pool.query("SELECT max(reserved)::int m, bool_and(reserved<=allotment) okk FROM inventory_daily WHERE rate_plan_id=$1", [RP])).rows[0];
  log("P7 parallel booking keeps allotment consistent (expected: confirmed=5, never oversold)", !(ok === 5 && maxRes.m === 5), { ok, conflict, other: other.map(o => o.body), maxRes });
  log("P7b booking_no collisions under parallel load produce 500", other.some(o => o.status === 500), other.length);

  // P8 same idempotency key in parallel
  await pool.query("UPDATE inventory_daily SET allotment=50, reserved=0 WHERE rate_plan_id=$1", [RP]);
  const key = randomUUID();
  const dup = await Promise.all(Array.from({ length: 5 }, () => book(tok.a, base, key)));
  const created = (await pool.query("SELECT count(*)::int c FROM idempotency_keys WHERE key=$1", [key])).rows[0].c;
  log("P8 concurrent same Idempotency-Key -> some 500s instead of replay", dup.some(d => d.status === 500), dup.map(d => d.status).join(","));
  log("P8b ...but only one booking persisted (correct)", created !== 1, created);
  const sameKeyDiffBody = await book(tok.a, { ...base, rooms: 3 }, key);
  log("P8c same key with different payload silently replays old response (no request fingerprint)", sameKeyDiffBody.status === 201, sameKeyDiffBody.body);

  // P9 deactivated agency's users keep access
  await pool.query("UPDATE agencies SET active=false WHERE id=$1", [subA]);
  const relog = await call("POST", "/api/auth/login", { email: "a@x.test", password: "correct-horse-battery" });
  const stillBook = await book(tok.a, base);
  log("P9 users of a deactivated agency can still log in and book", relog.status === 200 && stillBook.status === 201, { login: relog.status, book: stillBook.status });
  await pool.query("UPDATE agencies SET active=true WHERE id=$1", [subA]);

  // P10 inactive rate plan / room still bookable & listed
  await pool.query("UPDATE rate_plans SET active=false WHERE id=$1", [RP]);
  await pool.query("UPDATE rooms SET active=false WHERE id=$1", [R]);
  const inactiveRP = await book(tok.a, base);
  log("P10 inactive rate plan + inactive room still bookable", inactiveRP.status === 201, inactiveRP.status);
  await pool.query("UPDATE rate_plans SET active=true WHERE id=$1", [RP]);
  await pool.query("UPDATE rooms SET active=true WHERE id=$1", [R]);

  // P11 publication row with hotel_id not matching rate plan's hotel
  const H2 = randomUUID();
  await pool.query("INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ($1,$2,'Decoy Hotel','Bodrum','active')", [H2, master2]);
  const RPB = randomUUID(), RB = randomUUID();
  await pool.query("INSERT INTO rooms(id,hotel_id,name) VALUES ($1,$2,'SGL')", [RB, H]);
  await pool.query("INSERT INTO rate_plans(id,room_id,board_name,currency) VALUES ($1,$2,'BB','EUR')", [RPB, RB]);
  const ins = await pool.query("INSERT INTO agency_hotel_sales(agency_id,hotel_id,rate_plan_id,sell_price,sell_currency) VALUES ($1,$2,$3,10,'EUR') RETURNING id", [subB, H2, RPB]).then(() => "accepted", e => e.message);
  const listB = await call("GET", "/api/agency/hotels", undefined, tok.b);
  log("P11 schema accepts publication whose hotel_id != rate plan's hotel; listing shows the decoy hotel", ins === "accepted" && listB.body.items.some((h: any) => h.name === "Decoy Hotel"), { ins, list: listB.body.items.map((h: any) => h.name) });
  log("P11b listing shows a hotel with zero inventory rows (no date/price/allotment check)", listB.body.items.length > 0, listB.body.items.length);

  // P12 email case duplicates
  const dupMail = await pool.query("INSERT INTO users(agency_id,email,password_hash,role) VALUES ($1,'A@X.TEST',$2,'sub_agency')", [subB, pw]).then(() => "accepted", e => e.message);
  log("P12 case-variant duplicate e-mail accepted (login picks arbitrary row)", dupMail === "accepted", dupMail);

  // P13 malformed JSON body
  const badJson = await call("POST", "/api/auth/login", "{bad json");
  log("P13 malformed JSON leaks parser message", badJson.status === 400 && /JSON|token|position/i.test(String(badJson.body?.error)), badJson);

  // P14 system_admin hotel creation with bogus owner
  const bogus = await call("POST", "/api/admin/hotels", { name: "X", location: "Y", ownerAgencyId: randomUUID() }, tok.admin);
  log("P14 system_admin hotel with non-existent ownerAgencyId -> 500", bogus.status === 500, bogus);
  const toSub = await call("POST", "/api/admin/hotels", { name: "X", location: "Y", ownerAgencyId: subB }, tok.admin);
  log("P14b hotel can be owned by a SUB agency", toSub.status === 201, toSub.status);

  // P15 audit content
  const aud = await pool.query("SELECT * FROM audit_logs WHERE action='booking.rejected' LIMIT 1");
  log("P15 audit row for rejection carries actor's agency (master), not booking's agency, and no before/after/IP", aud.rows[0]?.agency_id === master, aud.rows[0]);

  // P16 RLS
  const rls = await pool.query("SELECT count(*)::int c FROM pg_policies");
  log("P16 no row-level security policies exist although app.agency_id is set", rls.rows[0].c === 0, rls.rows[0]);

  // P17 sub agency has no endpoint to list own bookings
  const own = await call("GET", "/api/agency/bookings", undefined, tok.a);
  log("P17 GET /api/agency/bookings (track own bookings) missing", own.status === 404, own.status);

  // P18 rooms upper bound / huge request
  const huge = await book(tok.a, { ...base, rooms: 1e9 });
  log("P18 no upper bound on rooms (409 only because of allotment)", huge.status === 409, huge.status);

  server.close(); await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
