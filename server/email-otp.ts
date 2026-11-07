import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_SESSION_TTL_SECONDS = 72 * 60 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_MS = 60_000;

export function generateEmailOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
export function otpDigest(challengeId: string, code: string, secret: string): string {
  if (secret.length < 32) throw new Error("OTP_SECRET must be at least 32 characters");
  return createHmac("sha256", secret).update(challengeId + ":" + code).digest("hex");
}
export function verifyOtpDigest(challengeId: string, code: string, expectedHex: string, secret: string): boolean {
  if (!/^[0-9]{6}$/.test(code) || !/^[a-f0-9]{64}$/.test(expectedHex)) return false;
  const actual = Buffer.from(otpDigest(challengeId, code, secret), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return timingSafeEqual(actual, expected);
}
export function newOtpChallenge(userId: string, secret: string, now = Date.now()) {
  const id = randomUUID();
  const code = generateEmailOtp();
  return { id, userId, code, digest: otpDigest(id, code, secret), expiresAt: new Date(now + OTP_TTL_MS) };
}
/** Email provider must be configured. Never log the OTP or silently deliver a token. */
export async function sendEmailOtp(email: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const sender = process.env.OTP_FROM_EMAIL;
  if (!apiKey || !sender) throw new Error("OTP_EMAIL_PROVIDER_NOT_CONFIGURED");
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: sender, to: [email], subject: "BED4BOOK giriş doğrulama kodu",
      text: "BED4BOOK giriş kodunuz: " + code + ". Kod 5 dakika geçerlidir. Bu kodu kimseyle paylaşmayın."
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!result.ok) throw new Error("OTP_EMAIL_DELIVERY_FAILED");
}
