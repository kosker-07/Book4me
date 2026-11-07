import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, issueSession, verifySession } from "../../server/security";

test("password hashes are salted and verifiable", () => {
  const a = hashPassword("a-long-password-123");
  const b = hashPassword("a-long-password-123");
  assert.notEqual(a, b);
  assert.equal(verifyPassword("a-long-password-123", a), true);
  assert.equal(verifyPassword("wrong-password-123", a), false);
});

test("signed sessions reject tampering and expiry", () => {
  const secret = "test-secret-with-at-least-thirty-two-characters";
  const token = issueSession({ sub: "user-1", role: "sub_agency", agencyId: "agency-1" }, secret, 1_800_000_000_000);
  assert.equal(verifySession(token, secret, 1_800_000_001_000)?.sub, "user-1");
  assert.equal(verifySession(token + "x", secret, 1_800_000_001_000), null);
  assert.equal(verifySession(token, secret, 1_900_000_000_000), null);
});

// ---------------------------------------------------------------- B4B-01 login throttling policy
import { LOGIN_LIMITS, loginThrottled, parseTrustProxy } from "../../server/login-guard";

test("login throttling: 5 failures per account+IP, 20 per IP, 100 per account", () => {
  const z = { accountAndIp: 0, ip: 0, account: 0 };
  assert.equal(loginThrottled(z), false);
  assert.equal(loginThrottled({ ...z, accountAndIp: 4, ip: 4, account: 4 }), false);
  assert.equal(loginThrottled({ ...z, accountAndIp: 5, ip: 5, account: 5 }), true, "brute force from one client");
  assert.equal(loginThrottled({ ...z, ip: 20 }), true, "one client spraying many accounts");
  assert.equal(loginThrottled({ ...z, ip: 19, accountAndIp: 4, account: 99 }), false);
  assert.equal(loginThrottled({ ...z, account: 100 }), true, "distributed brute force on one account");
  assert.deepEqual({ ...LOGIN_LIMITS }, { perAccountAndIp: 5, perIp: 20, perAccount: 100 });
});

test("login throttling: an attacker's failures on another IP do not lock the victim out", () => {
  // Attacker typed the victim's e-mail 5 times from 203.0.113.9 → account counter 5, but the victim's own
  // IP has no failures, so the victim's attempt is evaluated normally.
  assert.equal(loginThrottled({ accountAndIp: 0, ip: 0, account: 5 }), false);
  // Up to 19 attacker IPs × 5 = 95 failures still leave the account usable from a clean IP.
  assert.equal(loginThrottled({ accountAndIp: 0, ip: 0, account: 95 }), false);
});

// ---------------------------------------------------------------- B4B-02 reverse proxy trust
test("trust proxy: off by default outside production, explicit in production", () => {
  assert.equal(parseTrustProxy(undefined, "test"), false);
  assert.equal(parseTrustProxy("", undefined), false);
  assert.equal(parseTrustProxy("false", "production"), false);
  assert.equal(parseTrustProxy("0", "production"), false);
  assert.throws(() => parseTrustProxy(undefined, "production"), /must be set in production/);
  assert.throws(() => parseTrustProxy("  ", "production"), /must be set in production/);
});

test("trust proxy: hop counts and address lists; 'true' and junk are refused", () => {
  assert.equal(parseTrustProxy("1", "production"), 1);
  assert.equal(parseTrustProxy(" 2 ", "production"), 2);
  assert.deepEqual(parseTrustProxy("loopback, 10.0.0.0/8,fd00::/8,100.64.0.1", "production"), ["loopback", "10.0.0.0/8", "fd00::/8", "100.64.0.1"]);
  for (const bad of ["true", "TRUE", "6", "99", "10.0.0.0/33", "fd00::/129", "example.com", "10.0.0.0/8/1", "1.2.3", ","])
    assert.throws(() => parseTrustProxy(bad, "production"), Error, bad);
});

// ---------------------------------------------------------------- CORS (configuration and middleware)
import { corsMiddleware, parseCorsOrigins } from "../../server/cors";

test("CORS origins: exact scheme://host[:port] only, wildcards and paths refused", () => {
  assert.deepEqual(parseCorsOrigins(undefined), []);
  assert.deepEqual(parseCorsOrigins(" "), []);
  assert.deepEqual(parseCorsOrigins("https://app.bed4book.com, http://localhost:8080/"), ["https://app.bed4book.com", "http://localhost:8080"]);
  for (const bad of ["*", "https://*.bed4book.com", "app.bed4book.com", "ftp://x.com", "https://x.com/path", "https://u:p@x.com", "https://x.com?a=1"])
    assert.throws(() => parseCorsOrigins(bad), Error, bad);
});

test("CORS middleware: allowed origin gets headers, others nothing; preflight 204 / 403", () => {
  const mw = corsMiddleware(["http://ui.test:8080"]);
  const run = (method: string, origin?: string) => {
    const headers: Record<string, string> = {}; let status = 0, nextCalled = false;
    const res: any = { setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; }, append: (k: string, v: string) => { headers[k.toLowerCase()] = v; },
      status: (s: number) => { status = s; return res; }, end: () => res, json: () => res };
    mw({ method, headers: origin ? { origin } : {} } as any, res, () => { nextCalled = true; });
    return { headers, status, nextCalled };
  };
  const ok = run("GET", "http://ui.test:8080");
  assert.equal(ok.headers["access-control-allow-origin"], "http://ui.test:8080"); assert.equal(ok.nextCalled, true);
  const evil = run("GET", "https://evil.example");
  assert.equal(evil.headers["access-control-allow-origin"], undefined); assert.equal(evil.nextCalled, true);
  const pre = run("OPTIONS", "http://ui.test:8080");
  assert.equal(pre.status, 204); assert.equal(pre.nextCalled, false); assert.match(pre.headers["access-control-allow-headers"]!, /Idempotency-Key/);
  const evilPre = run("OPTIONS", "https://evil.example");
  assert.equal(evilPre.status, 403); assert.equal(evilPre.headers["access-control-allow-origin"], undefined);
  assert.equal(run("GET").nextCalled, true);
  assert.equal(corsMiddleware([]) && run("GET").headers["access-control-allow-origin"], undefined);
});
