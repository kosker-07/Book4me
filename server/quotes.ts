// Confidential authenticated quote tokens (version 3). Search does not reserve inventory.
// AES-256-GCM hides contract, rate-plan, agency and rule identifiers from buyers.
// Old q1/q2 tokens are intentionally invalidated; booking still revalidates every quote.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

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

const encryptionKey = (secret: string) => createHash("sha256").update("bed4book-quote-enc:" + secret).digest();

export function signQuote(p: Omit<QuotePayload, "v" | "exp">, secret: string, now = Date.now()): string {
  const payload: QuotePayload = { v: 2, ...p, exp: Math.floor(now / 1000) + QUOTE_TTL_SECONDS };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return `q3.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

export type QuoteCheck = { ok: true; quote: QuotePayload } | { ok: false; error: "INVALID_QUOTE" | "QUOTE_EXPIRED" };

export function verifyQuote(token: unknown, secret: string, now = Date.now()): QuoteCheck {
  if (typeof token !== "string") return { ok: false, error: "INVALID_QUOTE" };
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "q3") return { ok: false, error: "INVALID_QUOTE" };
  const [, ivPart, ciphertextPart, tagPart] = parts;
  if (!ivPart || !ciphertextPart || !tagPart || !/^[A-Za-z0-9_-]+$/.test(ivPart + ciphertextPart + tagPart)) return { ok: false, error: "INVALID_QUOTE" };
  let q: QuotePayload;
  try {
    const iv = Buffer.from(ivPart, "base64url");
    const ciphertext = Buffer.from(ciphertextPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) return { ok: false, error: "INVALID_QUOTE" };
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv);
    decipher.setAuthTag(tag);
    q = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
  } catch { return { ok: false, error: "INVALID_QUOTE" }; }
  if (q?.v !== 2 || !Number.isFinite(q.exp) || !Array.isArray(q.nationalities) || !Array.isArray(q.roomOccupancies) || q.roomOccupancies.length !== q.rooms) return { ok: false, error: "INVALID_QUOTE" };
  if (q.exp <= Math.floor(now / 1000)) return { ok: false, error: "QUOTE_EXPIRED" };
  return { ok: true, quote: q };
}
