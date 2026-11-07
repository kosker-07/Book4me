// Controlled CORS for a web UI served from another origin (e.g. a static site). Only exact, explicitly listed
// origins are allowed; "*" is refused. Authentication uses a bearer header, never cookies, so credentials
// mode is not enabled. Unlisted origins get no CORS headers (the browser blocks them) and preflights get 403.
import type { NextFunction, Request, Response } from "express";

/** CORS_ORIGINS="https://app.bed4book.com,http://localhost:8080" → normalized origin list. Empty → CORS off. */
export function parseCorsOrigins(raw: string | undefined): string[] {
  const entries = (raw ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return entries.map(entry => {
    if (entry === "*" || entry.includes("*")) throw new Error("CORS_ORIGINS must list exact origins; wildcards are not allowed.");
    let url: URL;
    try { url = new URL(entry); } catch { throw new Error(`CORS_ORIGINS contains an invalid origin: ${entry}`); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
        || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash)
      throw new Error(`CORS_ORIGINS entries must be scheme://host[:port] only: ${entry}`);
    return url.origin;
  });
}

export const CORS_ALLOWED_HEADERS = "Authorization, Content-Type, Idempotency-Key";
export const CORS_ALLOWED_METHODS = "GET, POST, PUT, PATCH, OPTIONS";
export const CORS_EXPOSED_HEADERS = "Content-Disposition, X-Voucher-SHA256";

export function corsMiddleware(allowed: string[]) {
  const set = new Set(allowed);
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (!origin || !set.size) return next();
    res.append("Vary", "Origin");
    const ok = set.has(origin);
    if (req.method === "OPTIONS") {
      if (!ok) return res.status(403).json({ error: "CORS_ORIGIN_NOT_ALLOWED" });
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
      res.setHeader("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
      res.setHeader("Access-Control-Max-Age", "600");
      return res.status(204).end();
    }
    if (ok) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Expose-Headers", CORS_EXPOSED_HEADERS);
    }
    next();
  };
}
