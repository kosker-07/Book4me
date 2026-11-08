// Signed quote tokens (version 2). A search writes nothing to the database: each winning offer is returned as
// an HMAC-signed token that the booking request must present. A quote never reserves inventory; it carries the
// decision trace (contract, nationalities, matched rules, prices, FX rates) that the booking re-validates and
// then freezes in its snapshot. Version 1 tokens are rejected (they carry no nationality or FX information).
import { createHmac, timingSafeEqual } from "node:crypto";

export const QUOTE_TTL_SECONDS = 30 * 60;

export interface QuotePayload {
  v: 2;
  agencyId: string;
  ratePlanId: string;
  contractId: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
  adults: number;
  children: number;
  childAges: number[];
  roomOccupancies: { adults: number; children: number; childAges: number[] }[];
  /** Nationality of every guest, sorted. */
  nationalities: string[];
  /** Matched rule id per nationality (null = general market), same order as `nationalities`. */
  ruleIds: (string | null)[];
  /** Total in the contract currency, minor units. */
  totalMinor: number;
  currency: string;
  minorUnits: number;
  /** fx_rate_history id used for the contract currency (null for EUR). */
  fxRateId: number | null;
  paymentCurrency: string;
  paymentMinorUnits: number;
  paymentAmountMinor: number;
  /** fx_rate_history id used for the payment currency (null for EUR). */
  paymentFxRateId: number | null;
  exp: number; // unix seconds — price validity, not an inventory hold
}

const mac = (body: string, secret: string) => createHmac("sha256", `bed4book-quote:${secret}`).update(body).digest();

export function signQuote(p: Omit<QuotePayload, "v" | "exp">, secret: string, now = Date.now()): string {
  const payload: QuotePayload = { v: 2, ...p, exp: Math.floor(now / 1000) + QUOTE_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `q2.${body}.${mac(body, secret).toString("base64url")}`;
}

export type QuoteCheck = { ok: true; quote: QuotePayload } | { ok: false; error: "INVALID_QUOTE" | "QUOTE_EXPIRED" };

export function verifyQuote(token: unknown, secret: string, now = Date.now()): QuoteCheck {
  if (typeof token !== "string") return { ok: false, error: "INVALID_QUOTE" };
  const [prefix, body, sig] = token.split(".");
  if (prefix !== "q2" || !body || !sig) return { ok: false, error: "INVALID_QUOTE" };
  const expected = mac(body, secret), actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { ok: false, error: "INVALID_QUOTE" };
  let q: QuotePayload;
  try { q = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return { ok: false, error: "INVALID_QUOTE" }; }
  if (q?.v !== 2 || !Number.isFinite(q.exp) || !Array.isArray(q.nationalities) || !Array.isArray(q.roomOccupancies) || q.roomOccupancies.length !== q.rooms) return { ok: false, error: "INVALID_QUOTE" };
  if (q.exp <= Math.floor(now / 1000)) return { ok: false, error: "QUOTE_EXPIRED" };
  return { ok: true, quote: q };
}
