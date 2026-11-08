// Shared HTTP helpers: authentication, role checks, errors, audit.
import { NextFunction, Request, Response } from "express";
import { pool } from "./db";
import { SessionClaims, verifySession } from "./security";
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

/** Verifies the bearer token and re-checks the user on every request: active user, active agency,
 *  unchanged role/agency and unchanged token_version (logout and deactivation revoke sessions). */
export const authenticate = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  const header = req.headers.authorization || "";
  if (!/^Bearer\s+/i.test(header)) return res.status(401).json({ error: "UNAUTHENTICATED" });
  const claims = verifySession(header.replace(/^Bearer\s+/i, ""), sessionSecret());
  if (!claims) return res.status(401).json({ error: "UNAUTHENTICATED" });
  try {
    const result = await pool.query(
      `SELECT u.id, u.role, u.agency_id, u.active, u.token_version, a.active AS agency_active
         FROM users u LEFT JOIN agencies a ON a.id = u.agency_id WHERE u.id = $1`, [claims.sub]);
    const user = result.rows[0];
    if (!user || !user.active || user.role !== claims.role || user.agency_id !== claims.agencyId
        || (user.agency_id && !user.agency_active) || user.token_version !== (claims.ver ?? 0))
      return res.status(401).json({ error: "SESSION_REVOKED" });
    req.auth = claims;
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
