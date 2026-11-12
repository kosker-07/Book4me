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
process.env.SESSION_SECRET ||= "contract-import-integration-secret-at-least-32";
let pool: any, server: Server, base: string, hashPassword: (s: string) => string, issueSession: (p: any, s: string) => string;
const PENINSULA = readFileSync(path.join(__dirname, "fixtures", "SEJOUR - SEJOUR KONTRAT EXCELI ORNEK FORMAT PENINSULA.xlsx"));
const CRYSTAL = readFileSync(path.join(__dirname, "fixtures", "S27 Crystal Hotels PriceList_Europe & UK(1).xlsx"));

async function call(method: string, p: string, token: string, body?: Buffer | object) {
  const isFile = Buffer.isBuffer(body);
  const r = await fetch(base + p, { method, headers: { authorization: "Bearer " + token, "content-type": isFile ? "application/octet-stream" : "application/json", "x-file-name": "contract.xlsx" },
    body: body === undefined ? undefined : isFile ? body : JSON.stringify(body) });
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

interface World { dmcA: string; dmcB: string; t: Record<"admin" | "masterA" | "masterB" | "subA", string> }
let w: World;
beforeEach(async () => {
  if (skip) return;
  await pool.query("TRUNCATE contract_imports, agencies, users, hotels, rooms, rate_plans, inventory_daily, audit_logs CASCADE");
  const dmcA = randomUUID(), dmcB = randomUUID(), subA = randomUUID();
  for (const [id, name, type, parent] of [[dmcA, "Alpha DMC", "master", null], [dmcB, "Bravo DMC", "master", null], [subA, "Alpha Sub", "sub", dmcA]])
    await pool.query("INSERT INTO agencies(id,name,type,parent_agency_id) VALUES ($1,$2,$3,$4)", [id, name, type, parent]);
  const t = {} as World["t"];
  for (const [key, role, agency] of [["admin", "system_admin", null], ["masterA", "master_agency", dmcA], ["masterB", "master_agency", dmcB], ["subA", "sub_agency", subA]] as const) {
    const uid = randomUUID();
    await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES ($1,$2,$3,$4,$5)", [uid, `imp-${key}@test.local`, hashPassword("integration-password-1"), role, agency]);
    t[key] = issueSession({ sub: uid, role, agencyId: agency, ver: 0 }, process.env.SESSION_SECRET!);
  }
  w = { dmcA, dmcB, t };
});
const terms = { cancellationPolicy: VALID_TERMS.cancellationPolicy, paymentTerms: VALID_TERMS.paymentTerms };
const count = async (sql: string, params: unknown[] = []) => Number((await pool.query(sql, params)).rows[0].n);

test("X4 preview writes nothing but the preview; confirm creates hotel, rooms, rate plans with terms, contract and nightly inventory", { skip }, async () => {
  const pre = await call("POST", "/api/contracts/import/preview", w.t.masterA, PENINSULA);
  assert.equal(pre.status, 201, JSON.stringify(pre.body));
  assert.equal(pre.body.hotels[0].name, "XANADU RESORT HOTEL");
  assert.equal(await count("SELECT count(*) AS n FROM hotels"), 0, "preview does not create hotels");
  const ok = await call("POST", `/api/contracts/import/${pre.body.importId}/confirm`, w.t.masterA, terms);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const hotel = (await pool.query("SELECT id, owner_agency_id, status, name FROM hotels")).rows;
  assert.equal(hotel.length, 1); assert.equal(hotel[0].owner_agency_id, w.dmcA); assert.equal(hotel[0].status, "draft");
  const room = (await pool.query("SELECT id FROM rooms WHERE hotel_id=$1 AND name='MAIN BUILDING STANDARD GARDENVIEW'", [hotel[0].id])).rows[0];
  const plan = (await pool.query("SELECT p.id, p.cancellation_policy, p.payment_terms, p.board_name, c.contract_id FROM rate_plans p JOIN contract_rate_plans c ON c.rate_plan_id=p.id WHERE p.room_id=$1", [room.id])).rows[0];
  assert.deepEqual(plan.cancellation_policy, VALID_TERMS.cancellationPolicy);
  assert.deepEqual(plan.payment_terms, VALID_TERMS.paymentTerms);
  assert.equal(plan.board_name, "Ultra All inclusive");
  const night = (await pool.query("SELECT price::text, allotment FROM inventory_daily WHERE rate_plan_id=$1 AND stay_date='2021-11-01'", [plan.id])).rows[0];
  assert.deepEqual(night, { price: "400.00", allotment: 10 });
  assert.equal(await count("SELECT count(*) AS n FROM inventory_daily WHERE rate_plan_id=$1 AND stay_date='2022-03-16'", [plan.id]), 1, "extra range imported");
  assert.equal(await count("SELECT count(*) AS n FROM audit_logs WHERE action='contract_import.confirmed'"), 1);
});

test("X5 the same file cannot be imported twice by the same DMC; a confirmed preview cannot be confirmed again", { skip }, async () => {
  const pre = await call("POST", "/api/contracts/import/preview", w.t.masterA, PENINSULA);
  assert.equal((await call("POST", `/api/contracts/import/${pre.body.importId}/confirm`, w.t.masterA, terms)).status, 200);
  assert.equal((await call("POST", `/api/contracts/import/${pre.body.importId}/confirm`, w.t.masterA, terms)).status, 409);
  const again = await call("POST", "/api/contracts/import/preview", w.t.masterA, PENINSULA);
  assert.equal(again.status, 409); assert.equal(again.body.error, "DUPLICATE_IMPORT");
  const other = await call("POST", "/api/contracts/import/preview", w.t.masterB, PENINSULA);
  assert.equal(other.status, 201, "another DMC may load the same hotel's contract");
});

test("X6 isolation and roles: another DMC gets 404 like a missing import; sub-agency 403; admin must name the DMC", { skip }, async () => {
  const pre = await call("POST", "/api/contracts/import/preview", w.t.masterA, PENINSULA);
  const foreign = await call("POST", `/api/contracts/import/${pre.body.importId}/confirm`, w.t.masterB, terms);
  const missing = await call("POST", `/api/contracts/import/${randomUUID()}/confirm`, w.t.masterB, terms);
  assert.deepEqual([foreign.status, foreign.body.error], [missing.status, missing.body.error]);
  assert.equal(foreign.status, 404);
  assert.equal((await call("GET", "/api/contracts/imports", w.t.masterB)).body.items.length, 0);
  assert.equal((await call("POST", "/api/contracts/import/preview", w.t.subA, PENINSULA)).status, 403);
  assert.equal((await call("POST", "/api/contracts/import/preview", w.t.admin, PENINSULA)).status, 400);
  const byAdmin = await call("POST", `/api/contracts/import/preview?ownerAgencyId=${w.dmcB}`, w.t.admin, PENINSULA);
  assert.equal(byAdmin.status, 201);
  assert.equal((await call("POST", `/api/contracts/import/${byAdmin.body.importId}/confirm`, w.t.admin, terms)).status, 200);
  assert.equal((await pool.query("SELECT owner_agency_id FROM hotels")).rows[0].owner_agency_id, w.dmcB);
});

test("X7 validation: terms are mandatory, corrupt file 422, empty body 400, hotel selection", { skip }, async () => {
  const pre = await call("POST", "/api/contracts/import/preview", w.t.masterA, CRYSTAL);
  assert.equal(pre.status, 201); assert.equal(pre.body.hotels.length, 13);
  const noTerms = await call("POST", `/api/contracts/import/${pre.body.importId}/confirm`, w.t.masterA, {});
  assert.equal(noTerms.status, 400); assert.equal(noTerms.body.error, "INVALID_RATE_PLAN_TERMS");
  assert.equal((await call("POST", `/api/contracts/import/${pre.body.importId}/confirm`, w.t.masterA, { ...terms, hotels: [99] })).status, 400);
  assert.equal(await count("SELECT count(*) AS n FROM hotels"), 0);
  const one = await call("POST", `/api/contracts/import/${pre.body.importId}/confirm`, w.t.masterA, { ...terms, hotels: [0] });
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(await count("SELECT count(*) AS n FROM hotels"), 1, "only the selected hotel");
  const bad = await call("POST", "/api/contracts/import/preview", w.t.masterA, Buffer.from("PK not really a zip file at all"));
  assert.equal(bad.status, 422);
  assert.equal((await call("POST", "/api/contracts/import/preview", w.t.masterA, Buffer.alloc(0))).status, 400);
});

test("X8 re-import keeps reserved stock: a new allotment never drops below rooms already sold", { skip }, async () => {
  const pre = await call("POST", "/api/contracts/import/preview", w.t.masterA, PENINSULA);
  await call("POST", `/api/contracts/import/${pre.body.importId}/confirm`, w.t.masterA, terms);
  const plan = (await pool.query("SELECT p.id FROM rate_plans p JOIN rooms r ON r.id=p.room_id WHERE r.name='MAIN BUILDING STANDARD GARDENVIEW'")).rows[0].id;
  await pool.query("UPDATE inventory_daily SET reserved = 10 WHERE rate_plan_id=$1 AND stay_date='2021-11-01'", [plan]);
  await pool.query("UPDATE contract_imports SET status='preview', confirmed_at=NULL");
  await pool.query("UPDATE inventory_daily SET allotment = 10 WHERE rate_plan_id=$1", [plan]);
  const again = await call("POST", `/api/contracts/import/${pre.body.importId}/confirm`, w.t.masterA, terms);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const night = (await pool.query("SELECT allotment, reserved FROM inventory_daily WHERE rate_plan_id=$1 AND stay_date='2021-11-01'", [plan])).rows[0];
  assert.ok(night.allotment >= night.reserved);
  assert.equal(await count("SELECT count(*) AS n FROM rate_plans"), 4, "no duplicate rate plans on re-import (4 priced rooms)");
});
