import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  if (password.length < 12) throw new Error("Password must contain at least 12 characters.");
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [scheme, saltText, hashText] = encoded.split("$");
  if (scheme !== "scrypt" || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, "base64url");
    const actual = scryptSync(password, Buffer.from(saltText, "base64url"), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export interface SessionClaims {
  sub: string;
  role: "system_admin" | "master_agency" | "sub_agency" | "back_office";
  agencyId: string | null;
  /** users.token_version at issue time; a mismatch revokes the session (logout, deactivation). */
  ver?: number;
  exp: number;
}

export function issueSession(claims: Omit<SessionClaims, "exp">, secret: string, now = Date.now()): string {
  if (secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  const payload: SessionClaims = { ...claims, exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifySession(token: string, secret: string, now = Date.now()): SessionClaims | null {
  const [body, signature] = token.split(".");
  if (!body || !signature || secret.length < 32) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionClaims;
    if (!claims.sub || !claims.role || !Number.isFinite(claims.exp) || claims.exp <= Math.floor(now / 1000)) return null;
    if (!["system_admin", "master_agency", "sub_agency", "back_office"].includes(claims.role)) return null;
    return claims;
  } catch { return null; }
}
