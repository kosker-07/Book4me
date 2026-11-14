// Session persistence: login, reload-style reuse, idle-hour expiry, logout/password-change revocation.
// Requires DATABASE_URL; skipped locally without it. CI runs it.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const skip = !process.env.DATABASE_URL ? "DATABASE_URL required" : false;
if (skip && process.env.CI) throw new Error("DATABASE_URL required in CI");
process.env.SESSION_SECRET ||= "session-idle-integration-secret-32-chars";

let pool: any, server: Server, base: string;
const EMAIL = "idle-admin@test.local", PW = "integration-password-1";
let userId: string;

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
  await pool.query("TRUNCATE agencies, users, audit_logs, login_attempts CASCADE");
  userId = randomUUID();
  await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES ($1,$2,$3,'system_admin',NULL)",
    [userId, EMAIL, await (await import("../../server/security")).hashPassword(PW)]);
});

const cookieOf = (r: Response) => {
  const line = r.headers.getSetCookie().find(c => c.startsWith("b4b_session="));
  return line ? { line, value: line.split(";")[0]!.slice("b4b_session=".length) } : null;
};
const login = () => fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PW }) });
const withCookie = (value: string) => ({ cookie: "b4b_session=" + value });
// browserToken(issuedSecondsAgo): a session cookie minted that many seconds ago, good for 12h absolute.
const browserToken = async (issuedSecondsAgo: number) => (await import("../../server/security")).issueSession(
  { sub: userId, role: "system_admin", agencyId: null, ver: 0,
    max: Math.floor(Date.now() / 1000) + 12 * 3600 },
  process.env.SESSION_SECRET!, Date.now() - issuedSecondsAgo * 1000);

test("S5-login: login sets an HttpOnly cookie and a reload-style request is authenticated by it alone", { skip }, async () => {
  const r = await login();
  assert.equal(r.status, 200, JSON.stringify(await r.json()));
  const cookie = cookieOf(r);
  assert.ok(cookie && cookie.value.length > 0, "login sets b4b_session cookie");
  assert.ok(cookie.line.includes("HttpOnly"), "cookie is HttpOnly");
  assert.ok(cookie.line.includes("SameSite=Strict"), "cookie is SameSite=Strict");
  const me = await fetch(base + "/api/me", { headers: withCookie(cookie.value) });
  assert.equal(me.status, 200, "cookie authenticates /api/me");
});

test("S5-page-refresh: same cookie after a page reload still authenticates", { skip }, async () => {
  const r = await login();
  const cookie = cookieOf(r)!.value;
  const first = await fetch(base + "/api/me", { headers: withCookie(cookie) });
  assert.equal(first.status, 200);
  const second = await fetch(base + "/api/me", { headers: withCookie(cookie) });
  assert.equal(second.status, 200, "same cookie after reload-style reuse");
});

test("S5-activity-before-expiry: activity within the hour renews the session", { skip }, async () => {
  const issued = await browserToken(30 * 60); // 30 minutes old — inside the idle hour
  const me = await fetch(base + "/api/me", { headers: withCookie(issued) });
  assert.equal(me.status, 200, "30-minute-old session authenticates");
  const renewed = cookieOf(me);
  assert.ok(renewed, "activity renews the cookie");
  const { security } = await import("../../server/security");
  const claims = security.verifySession(renewed.value, process.env.SESSION_SECRET!)!;
  assert.ok(claims.exp - Math.floor(Date.now() / 1000) > 3500,
    "renewed session extends close to a full idle hour");
});

test("S5-one-idle-hour: session older than one hour is 401", { skip }, async () => {
  const issued = await browserToken(60 * 60 + 1); // one hour and one second old
  const me = await fetch(base + "/api/me", { headers: withCookie(issued) });
  assert.equal(me.status, 401, "session older than one idle hour is 401");
});

test("S5-logout-revokes: old cookie is 401 after logout", { skip }, async () => {
  const r = await login();
  const cookie = cookieOf(r)!.value;
  await fetch(base + "/api/me", { headers: withCookie(cookie) });
  const out = await fetch(base + "/api/auth/logout", { method: "POST", headers: withCookie(cookie) });
  assert.ok(out.status === 200 || out.status === 204, "logout returns success");
  const again = await fetch(base + "/api/me", { headers: withCookie(cookie) });
  assert.equal(again.status, 401, "old cookie is 401 after logout");
});

test("S5-password-change-revokes: old cookie is 401 after password change", { skip }, async () => {
  const r = await login();
  const cookie = cookieOf(r)!.value;
  const changed = await fetch(base + "/api/auth/change-password", {
    method: "POST",
    headers: { ...withCookie(cookie), "content-type": "application/json", "x-requested-with": "bed4book" },
    body: JSON.stringify({ currentPassword: PW, newPassword: "another-long-password-3" })
  });
  assert.equal(changed.status, 200, JSON.stringify(await changed.json()));
  const again = await fetch(base + "/api/me", { headers: withCookie(cookie) });
  assert.equal(again.status, 401, "old cookie is 401 after password change");
});
