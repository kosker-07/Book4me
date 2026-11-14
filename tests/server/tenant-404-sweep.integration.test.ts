import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// J16: PostgreSQL-backed tenant ownership checks. Expand this table as fixtures
// for other resource types are added; role-gated endpoints require separate cases.
const skip = !process.env.DATABASE_URL ? "DATABASE_URL required" : false;
if (skip && process.env.CI) throw new Error("DATABASE_URL required in CI");
process.env.SESSION_SECRET ||= "tenant-sweep-test-secret-at-least-32";
let pool: any, server: Server, base: string, tokenA: string, tokenB: string, foreignId: string, siblingId: string;
async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(base + path, {
    method, headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await res.text();
  let json: unknown;
  try { json = JSON.parse(raw); } catch { json = raw; }
  return { status: res.status, body: json };
}
before(async () => {
  if (skip) return;
  ({ pool } = await import("../../server/db"));
  const { default: app } = await import("../../server/app");
  server = app.listen(0);
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(async () => { if (!skip) { server.close(); await pool.end(); } });
beforeEach(async () => {
  if (skip) return;
  const { hashPassword, issueSession } = await import("../../server/security");
  await pool.query("TRUNCATE agencies, users CASCADE");
  const a = randomUUID(), b = randomUUID(), subA = randomUUID();
  foreignId = randomUUID(); siblingId = randomUUID();
  for (const [id, name, type, parent] of [
    [a, "DMC A", "master", null], [b, "DMC B", "master", null],
    [subA, "Sub A", "sub", a], [foreignId, "Foreign Sub", "sub", b],
    [siblingId, "Sibling Sub", "sub", a]
  ]) await pool.query("INSERT INTO agencies(id,name,type,parent_agency_id) VALUES($1,$2,$3,$4)", [id,name,type,parent]);
  const ua = randomUUID(), ub = randomUUID();
  for (const [id, email, agency] of [[ua,"a@j16.local",a],[ub,"b@j16.local",b]])
    await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES($1,$2,$3,'master_agency',$4)",
      [id,email,hashPassword("test-password-123"),agency]);
  tokenA = issueSession({sub:ua,role:"master_agency",agencyId:a,ver:0},process.env.SESSION_SECRET!);
  tokenB = issueSession({sub:ub,role:"master_agency",agencyId:b,ver:0},process.env.SESSION_SECRET!);
});
const cases = [
  { method: "GET", route: "/api/dmc/subagencies/:id" },
  { method: "PATCH", route: "/api/dmc/subagencies/:id", body: { active: false } },
  { method: "PUT", route: "/api/dmc/subagencies/:id/markup", body: { markupPercent: 2 } }
];
for (const item of cases) test("J16 tenant foreign/missing identical: " + item.method + " " + item.route, {skip}, async () => {
  const missing = randomUUID();
  const foreign = await call(item.method,item.route.replace(":id",foreignId),tokenA,item.body);
  const absent = await call(item.method,item.route.replace(":id",missing),tokenA,item.body);
  assert.equal(foreign.status,404,JSON.stringify({route:item.route,foreign}));
  assert.deepEqual(foreign,absent,"foreign/missing leak on "+item.route);
  assert.deepEqual(foreign.body,{error:"NOT_FOUND"});
  const owner = await call(item.method,item.route.replace(":id",foreignId),tokenB,item.body);
  assert.notEqual(owner.status,404,"owner must be able to access its own resource");
});
