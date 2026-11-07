import test from "node:test";
import assert from "node:assert/strict";
import { generateEmailOtp, newOtpChallenge, otpDigest, verifyOtpDigest, OTP_TTL_MS, OTP_SESSION_TTL_SECONDS } from "../../server/email-otp";
const secret = "test-secret-with-at-least-thirty-two-characters";
test("OTP is exactly six decimal digits", () => { for(let i=0;i<100;i++) assert.match(generateEmailOtp(), /^\\d{6}$/); });
test("OTP digest is challenge-specific and does not contain code", () => {
  const a = newOtpChallenge("user1",secret,1000);
  assert.equal(a.expiresAt.getTime(),1000+OTP_TTL_MS);
  assert.equal(verifyOtpDigest(a.id,a.code,a.digest,secret),true);
  assert.equal(verifyOtpDigest(a.id,"xxxxxx",a.digest,secret),false);
  assert.equal(verifyOtpDigest("00000000-0000-4000-8000-000000000000",a.code,a.digest,secret),false);
  assert.notEqual(otpDigest(a.id,a.code,secret),a.code);
});
test("OTP sessions have maximum 72-hour duration",()=>assert.equal(OTP_SESSION_TTL_SECONDS,259200));
