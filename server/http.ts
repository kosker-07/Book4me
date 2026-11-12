// Shared HTTP helpers: authentication, role checks, errors, audit.
import { NextFunction, Request, Response } from "express";
import { pool } from "./db";
import { IDLE_TTL_SECONDS, SessionClaims, issueSession, verifySession } from "./security";
import { UUID_RE } from "./validation";
import { currentContext } from "./context";

export const sessionSecret = () => process.env.SESSION_SECRET || "";
export type Role = SessionClaims["role"];
export type AuthedRequest = Request & { auth?: SessionClaims };

export const httpError = (status: number, message: string, extra?: object) => Object.assign(new Error(message), { status, extra });

/** Platform-wide roles: system administrator and Back Office (not bound to any agency tenant). */
export const isPlatformWide = (role: Role) => role === "system_admin" || role === "back_office";

export const roles = (...allowed: Role[]) => (req: AuthedRequest, res: Response, next: NextFunction) => {
  if (!req.auth || !allowed.includes(req.auth.role)) return res.status(403).json({ error: "FORBIDDEN" });
  next();
};

// ---------------------------------------------------------------------------------------------
// Browser session cookie. The web UI never holds the token in JavaScript: the server sets it in an
// HttpOnly cookie, so a page reload keeps the user signed in and a script cannot read the credential.
// SameSite=Strict keeps other sites from sending it; state-changing requests must also carry the
// X-Requested-With header, which a cross-site form or link cannot add.
// ---------------------------------------------------------------------------------------------
export const SESSION_COOKIE = "b4b_session";
const CSRF_HEADER_VALUE = "bed4book";
/** A renewed cookie is sent only when the current one is at least this old, not on every request. */
const RENEW_AFTER_SECONDS = 5 * 60;

const isHttps = (req: Request) =>
  req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0]!.trim().toLowerCase() === "https";

const cookieAttributes = (req: Request) => `Path=/; HttpOnly; SameSite=Strict${isHttps(req) ? "; Secure" : ""}`;

export function setSessionCookie(req: Request, res: Response, token: string) {
  res.append("Set-Cookie", `${SESSION_COOKIE}=${token}; Max-Age=${IDLE_TTL_SECONDS}; ${cookieAttributes(req)}`);
}
export function clearSessionCookie(req: Request, res: Response) {
  res.append("Set-Cookie", `${SESSION_COOKIE}=; Max-Age=0; ${cookieAttributes(req)}`);
}
function sessionCookie(req: Request): string | null {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

type SessionResult = { claims: SessionClaims } | { status: number; error: string };

/** Verifies the session and re-checks the user: active user, active agency, unchanged role/agency and
 *  unchanged token_version (logout and deactivation revoke sessions).
 *  The token comes from the Authorization header (API clients) or, without one, from the browser cookie.
 *  A cookie session ends after IDLE_TTL_SECONDS without a request and is renewed while the user is active. */
export async function resolveSession(req: Request, res: Response): Promise<SessionResult> {
  const header = req.headers.authorization || "";
  const bearer = /^Bearer\s+/i.test(header);
  const token = bearer ? header.replace(/^Bearer\s+/i, "") : sessionCookie(req);
  if (!token) return { status: 401, error: "UNAUTHENTICATED" };
  const claims = verifySession(token, sessionSecret());
  if (!claims) {
    if (!bearer) clearSessionCookie(req, res);
    return { status: 401, error: "UNAUTHENTICATED" };
  }
  if (!bearer && !["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers["x-requested-with"] !== CSRF_HEADER_VALUE)
    return { status: 403, error: "CSRF_CHECK_FAILED" };
  const result = await pool.query(
    `SELECT u.id, u.role, u.agency_id, u.active, u.token_version, a.active AS agency_active
       FROM users u LEFT JOIN agencies a ON a.id = u.agency_id WHERE u.id = $1`, [claims.sub]);
  const user = result.rows[0];
  if (!user || !user.active || user.role !== claims.role || user.agency_id !== claims.agencyId
      || (user.agency_id && !user.agency_active) || user.token_version !== (claims.ver ?? 0)) {
    if (!bearer) clearSessionCookie(req, res);
    return { status: 401, error: "SESSION_REVOKED" };
  }
  if (!bearer && claims.max !== undefined) {
    const nowSec = Math.floor(Date.now() / 1000);
    const age = IDLE_TTL_SECONDS - (claims.exp - nowSec);
    if (age >= RENEW_AFTER_SECONDS && claims.exp < claims.max) {
      const { exp: _exp, ...rest } = claims;
      setSessionCookie(req, res, issueSession(rest, sessionSecret()));
    }
  }
  return { claims };
}

export const authenticate = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const session = await resolveSession(req, res);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    req.auth = session.claims;
    next();
  } catch (error) { next(error); }
};

export const requireAgency = (req: AuthedRequest, res: Response, next: NextFunction) => {
  if (!req.auth || !req.auth.agencyId) return res.status(403).json({ error: "AGENCY_CONTEXT_REQUIRED" });
  next();
};

/** UUID route parameter; anything else is treated as "not found". */
export const uuidParam = (req: Request, notFound = "NOT_FOUND") => {
  const id = String(req.params.id || "");
  if (!UUID_RE.test(id)) throw httpError(404, notFound);
  return id;
};

export interface AuditDetail { targetAgencyId?: string | null; before?: unknown; after?: unknown }

/** Appends an audit record. IP, user-agent and request id come from the current request context;
 *  before/after hold the changed values for management changes (A7). audit_logs is append-only. */
export const audit = async (client: { query: (...a: any[]) => Promise<any> }, actorId: string, agencyId: string | null,
                            action: string, entityType: string, entityId: string, detail: AuditDetail = {}) => {
  const ctx = currentContext();
  await client.query(
    `INSERT INTO audit_logs(actor_id, agency_id, action, entity_type, entity_id, target_agency_id, before, after, ip, user_agent, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)`,
    [actorId, agencyId, action, entityType, entityId, detail.targetAgencyId ?? null,
     detail.before === undefined ? null : JSON.stringify(detail.before), detail.after === undefined ? null : JSON.stringify(detail.after),
     ctx?.ip ?? null, ctx?.userAgent ?? null, ctx?.requestId ?? null]
  );
};
