// Signed quote tokens. A search writes nothing to the database: the winning offer is returned as an
// HMAC-signed token that the booking request must present. A quote never reserves inventory; it only
// proves which rate plan won and at what price. Booking re-checks price and availability.
import { createHmac, timingSafeEqual } from "node:crypto";

export const QUOTE_TTL_SECONDS = 30 * 60;

export interface QuotePayload {
  v: 1;
  agencyId: string;
  ratePlanId: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
  adults: number;
  children: number;
  childAges: number[];
  totalCents: number;
  currency: string;
  exp: number; // unix seconds — price validity, not an inventory hold
}

const mac = (body: string, secret: string) => createHmac("sha256", `bed4book-quote:${secret}`).update(body).digest();

export function signQuote(p: Omit<QuotePayload, "v" | "exp">, secret: string, now = Date.now()): string {
  const payload: QuotePayload = { v: 1, ...p, exp: Math.floor(now / 1000) + QUOTE_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `q1.${body}.${mac(body, secret).toString("base64url")}`;
}

export type QuoteCheck = { ok: true; quote: QuotePayload } | { ok: false; error: "INVALID_QUOTE" | "QUOTE_EXPIRED" };

export function verifyQuote(token: unknown, secret: string, now = Date.now()): QuoteCheck {
  if (typeof token !== "string") return { ok: false, error: "INVALID_QUOTE" };
  const [prefix, body, sig] = token.split(".");
  if (prefix !== "q1" || !body || !sig) return { ok: false, error: "INVALID_QUOTE" };
  const expected = mac(body, secret), actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { ok: false, error: "INVALID_QUOTE" };
  let q: QuotePayload;
  try { q = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return { ok: false, error: "INVALID_QUOTE" }; }
  if (q?.v !== 1 || !Number.isFinite(q.exp)) return { ok: false, error: "INVALID_QUOTE" };
  if (q.exp <= Math.floor(now / 1000)) return { ok: false, error: "QUOTE_EXPIRED" };
  return { ok: true, quote: q };
}
