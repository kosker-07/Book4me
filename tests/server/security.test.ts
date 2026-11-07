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
