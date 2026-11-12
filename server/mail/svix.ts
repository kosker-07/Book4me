// Svix-style webhook signature verification (used by Resend). Signed content: `${id}.${timestamp}.${rawBody}`,
// HMAC-SHA256 with the base64 secret (after the "whsec_" prefix); header carries one or more "v1,<base64>" values.
import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 5 * 60;

export function verifySvix(secret: string, headers: { id?: string; timestamp?: string; signature?: string }, rawBody: Buffer | string, nowMs = Date.now()): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > TOLERANCE_SECONDS) return false;
  const keyBytes = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  if (!keyBytes.length) return false;
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = createHmac("sha256", keyBytes).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some(part => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
