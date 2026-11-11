// Browser session cookie: survives a page reload, ends after one idle hour, is renewed while the user is
// active, cannot be used for cross-site writes, and is cleared and revoked by logout.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const skip = !process.env.DATABASE_URL ? "DATABASE_URL required" : false;
if (skip && process.env.CI) throw new Error("DATABASE_URL required in CI");
process.env.SESSION_SECRET ||= "session-cookie-integration-secret-32";
let pool: any, server: Server, base: string, security: typeof import("../../server/security");
const EMAIL = "cookie-admin@test.local", PW = "integration-password-1";
let userId: string;

before(async () => {
  if (skip) return;
  ({ pool } = await import("../../server/db"));
  security = await import("../../server/security");
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
    [userId, EMAIL, security.hashPassword(PW)]);
});

const cookieOf = (r: Response) => {
  const line = r.headers.getSetCookie().find(c => c.startsWith("b4b_session="));
  return line ? { line, value: line.split(";")[0]!.slice("b4b_session=".length) } : null;
};
const login = () => fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" },
                                                    body: JSON.stringify({ email: EMAIL, password: PW }) });
const withCookie = (value: string, extra: Record<string, string> = {}) => ({ cookie: "b4b_session=" + value, ...extra });
const browserToken = (issuedSecondsAgo: number, maxFromNow = 12 * 3600) => security.issueSession(
  { sub: userId, role: "system_admin", agencyId: null, ver: 0, max: Math.floor(Date.now() / 1000) + maxFromNow },
  process.env.SESSION_SECRET!, Date.now() - issuedSecondsAgo * 1000);

test("S1 login sets an HttpOnly SameSite=Strict cookie and a reload-style request is authenticated by it alone", { skip }, async () => {
  const r = await login();
  assert.equal(r.status, 200);
  const c = cookieOf(r);
  assert.ok(c, "login must set the session cookie");
  assert.match(c.line, /; HttpOnly/);
  assert.match(c.line, /; SameSite=Strict/);
  assert.match(c.line, /; Path=\//);
  assert.match(c.line, /Max-Age=3600/);
  assert.ok(!/; Secure/.test(c.line), "plain http in tests: no Secure flag");
  const https = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
                                                       body: JSON.stringify({ email: EMAIL, password: PW }) });
  assert.match(cookieOf(https)!.line, /; Secure/, "behind the HTTPS proxy the cookie is Secure");

  const me = await fetch(base + "/api/me", { headers: withCookie(c.value) });
  assert.equal(me.status, 200);
  assert.equal((await me.json() as any).role, "system_admin");
  const probe = await fetch(base + "/api/auth/session", { headers: withCookie(c.value) });
  assert.deepEqual(await probe.json(), { authenticated: true, userId, role: "system_admin", agencyId: null });
  assert.equal(cookieOf(me), null, "a fresh cookie is not re-sent on every request");
});

test("S2 signed-out visitors get a clean answer, never an error, from the session probe", { skip }, async () => {
  const none = await fetch(base + "/api/auth/session");
  assert.equal(none.status, 200);
  assert.deepEqual(await none.json(), { authenticated: false });
  const junk = await fetch(base + "/api/auth/session", { headers: withCookie("not-a-token") });
  assert.equal(junk.status, 200);
  assert.deepEqual(await junk.json(), { authenticated: false });
  assert.match(cookieOf(junk)!.line, /^b4b_session=; Max-Age=0/, "an invalid cookie is cleared");
  assert.equal((await fetch(base + "/api/me")).status, 401);
  assert.equal((await fetch(base + "/api/me", { headers: withCookie("not-a-token") })).status, 401);
});

test("S3 one idle hour ends the session; activity renews it; the absolute end is never passed", { skip }, async () => {
  assert.equal((await fetch(base + "/api/me", { headers: withCookie(browserToken(3601)) })).status, 401, "idle for more than an hour");
  assert.equal((await fetch(base + "/api/me", { headers: withCookie(browserToken(3500)) })).status, 200, "still inside the hour");

  const active = await fetch(base + "/api/me", { headers: withCookie(browserToken(600)) });
  assert.equal(active.status, 200);
  const renewed = cookieOf(active);
  assert.ok(renewed, "a ten-minute-old session is renewed");
  const claims = security.verifySession(renewed.value, process.env.SESSION_SECRET!)!;
  assert.ok(Math.abs(claims.exp - (Math.floor(Date.now() / 1000) + 3600)) <= 5, "renewed for a full idle hour");

  assert.equal(cookieOf(await fetch(base + "/api/me", { headers: withCookie(browserToken(60)) })), null, "a one-minute-old session is not renewed yet");

  const nearEnd = await fetch(base + "/api/me", { headers: withCookie(browserToken(3000, 1800)) });
  assert.equal(nearEnd.status, 200);
  const capped = security.verifySession(cookieOf(nearEnd)!.value, process.env.SESSION_SECRET!)!;
  assert.equal(capped.exp, capped.max, "renewal stops at the absolute end");
  assert.equal((await fetch(base + "/api/me", { headers: withCookie(browserToken(600, -1)) })).status, 401, "past the absolute end");
});

test("S4 a cookie cannot authorise a cross-site write: the X-Requested-With header is required", { skip }, async () => {
  const value = cookieOf(await login())!.value;
  const body = JSON.stringify({ currentPassword: PW, newPassword: "another-long-password-2" });
  const forged = await fetch(base + "/api/auth/change-password", { method: "POST", headers: withCookie(value, { "content-type": "application/json" }), body });
  assert.equal(forged.status, 403);
  assert.equal((await forged.json() as any).error, "CSRF_CHECK_FAILED");
  assert.equal((await login()).status, 200, "the password was not changed");
  const real = await fetch(base + "/api/auth/change-password", { method: "POST",
    headers: withCookie(value, { "content-type": "application/json", "x-requested-with": "bed4book" }), body });
  assert.equal(real.status, 200, JSON.stringify(await real.clone().json()));
  // A bearer token (API client) needs no such header.
  const api = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" },
                                                     body: JSON.stringify({ email: EMAIL, password: "another-long-password-2" }) });
  const bearer = (await api.json() as any).token;
  assert.equal((await fetch(base + "/api/auth/logout", { method: "POST", headers: { authorization: "Bearer " + bearer } })).status, 200);
});

test("S5 logout clears the cookie and revokes the session", { skip }, async () => {
  const value = cookieOf(await login())!.value;
  const out = await fetch(base + "/api/auth/logout", { method: "POST", headers: withCookie(value, { "x-requested-with": "bed4book" }) });
  assert.equal(out.status, 200);
  assert.match(cookieOf(out)!.line, /^b4b_session=; Max-Age=0/);
  assert.equal((await fetch(base + "/api/me", { headers: withCookie(value) })).status, 401, "the old cookie no longer works");
  assert.deepEqual(await (await fetch(base + "/api/auth/session", { headers: withCookie(value) })).json(), { authenticated: false });
});
