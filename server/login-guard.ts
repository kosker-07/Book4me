// Login throttling policy and reverse-proxy trust configuration (pure; no I/O, testable without a database).
import { isIP } from "node:net";

// ---------------------------------------------------------------------------------------------
// B4B-01 — Login throttling.
// A purely per-e-mail limit lets anyone lock a victim out by typing their e-mail five times. Failures are
// therefore counted on three keys within the window:
//   * account + IP: 5   — normal brute force from one client; the victim on another IP is NOT locked out.
//   * IP:          20   — one client spraying many accounts (credential stuffing).
//   * account:    100   — distributed brute force against one account (≥ 20 IPs at 5 each). Only then is
//                         the account throttled for everyone; this is the deliberate residual risk.
// The decision never depends on whether the account exists, so 429 / 401 reveal nothing about it.
// ---------------------------------------------------------------------------------------------
export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_LIMITS = Object.freeze({ perAccountAndIp: 5, perIp: 20, perAccount: 100 });

export interface LoginFailureCounts { accountAndIp: number; ip: number; account: number }

/** True when the attempt must be refused with 429 before the password is checked. */
export function loginThrottled(c: LoginFailureCounts, limits = LOGIN_LIMITS): boolean {
  return c.accountAndIp >= limits.perAccountAndIp || c.ip >= limits.perIp || c.account >= limits.perAccount;
}

// ---------------------------------------------------------------------------------------------
// B4B-02 — Which proxies may set X-Forwarded-For (Express "trust proxy").
//   unset / "" / "false" / "0" → false: req.ip is the TCP peer; X-Forwarded-For is ignored entirely.
//   "1".."5"                   → number of reverse-proxy hops in front of the app. Express then takes the
//                                 address that many hops from the right of X-Forwarded-For, i.e. the one
//                                 appended by our own proxy; values a client puts on the left are ignored.
//   "10.0.0.0/8,loopback,..."  → explicit list of trusted proxy addresses/subnets.
//   "true"                     → REFUSED: trusting every hop lets any client choose its own IP.
// In production the value must be set explicitly (startup fails otherwise), so a deployment behind a proxy
// cannot silently fall back to the proxy's address for every client (one shared IP limit for all users).
// ---------------------------------------------------------------------------------------------
export type TrustProxySetting = false | number | string[];

const NAMED_SUBNETS = new Set(["loopback", "linklocal", "uniquelocal"]);

function validAddressOrCidr(entry: string): boolean {
  if (NAMED_SUBNETS.has(entry)) return true;
  const [addr, bits, extra] = entry.split("/");
  if (extra !== undefined || !addr) return false;
  const family = isIP(addr);
  if (!family) return false;
  if (bits === undefined) return true;
  if (!/^\d{1,3}$/.test(bits)) return false;
  return Number(bits) <= (family === 4 ? 32 : 128);
}

export function parseTrustProxy(raw: string | undefined, nodeEnv: string | undefined): TrustProxySetting {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") {
    if (nodeEnv === "production")
      throw new Error("TRUST_PROXY must be set in production (number of proxy hops, a list of proxy addresses, or \"false\").");
    return false;
  }
  if (value === "false" || value === "0") return false;
  if (value === "true") throw new Error("TRUST_PROXY=true is not allowed: clients could forge X-Forwarded-For.");
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops < 1 || hops > 5) throw new Error("TRUST_PROXY hop count must be between 1 and 5.");
    return hops;
  }
  const entries = value.split(",").map(s => s.trim()).filter(Boolean);
  const bad = entries.filter(e => !validAddressOrCidr(e));
  if (!entries.length || bad.length) throw new Error(`TRUST_PROXY contains invalid entries: ${bad.join(", ") || "(empty)"}`);
  return entries;
}
