import { Router } from "express";
import { randomBytes } from "node:crypto";
import { pool, withTransaction } from "./db";
import { authenticate, roles, httpError, audit, uuidParam, AuthedRequest, isPlatformWide } from "./http";
import { h } from "./admin-routes";
import { decryptSecret, encryptSecret } from "./mail/crypto";
import { verifySvix } from "./mail/svix";
import { handleInbound } from "./mail/inbound";
import { PLATFORM_DOMAIN } from "./mail/addresses";

export const mailRouter = Router();
const MAIL_ROLES = roles("system_admin", "back_office", "master_agency");
const EMAIL_RE = /^[^\s@<>",;]+@([^\s@<>",;]+\.[^\s@<>",;]+)$/;
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;

const svixHeaders = (req: any) => ({ id: req.header("svix-id"), timestamp: req.header("svix-timestamp"), signature: req.header("svix-signature") });
const rawBody = (req: any): Buffer => Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from("");

// Platform inbound (bed4book.com addresses). Bad signature and unknown key look the same: 401.
mailRouter.post("/api/webhooks/mail/inbound", h(async (req, res) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET || "";
  if (!verifySvix(secret, svixHeaders(req), rawBody(req))) throw httpError(401, "INVALID_SIGNATURE");
  const apiKey = process.env.RESEND_API_KEY || "";
  const result = await handleInbound({ db: pool, apiKey }, null, req.body);
  res.json(result);
}));

mailRouter.post("/api/webhooks/mail/inbound/:tenantKey", h(async (req, res) => {
  const key = String(req.params.tenantKey || "");
  const s = (await pool.query("SELECT tenant_id, credentials_enc, inbound_webhook_secret_enc FROM tenant_mail_settings WHERE inbound_key = $1 AND active", [key])).rows[0];
  if (!s || !s.inbound_webhook_secret_enc) throw httpError(401, "INVALID_SIGNATURE");
  let secret = "", apiKey = "";
  try { secret = decryptSecret(s.inbound_webhook_secret_enc); apiKey = String(JSON.parse(decryptSecret(s.credentials_enc)).apiKey || ""); } catch { throw httpError(401, "INVALID_SIGNATURE"); }
  if (!verifySvix(secret, svixHeaders(req), rawBody(req))) throw httpError(401, "INVALID_SIGNATURE");
  res.json(await handleInbound({ db: pool, apiKey }, s.tenant_id, req.body));
}));

/** Platform roles see platform mail only (tenant_id IS NULL); a DMC sees only its own. accounting@ mail is system_admin only. */
function scope(req: AuthedRequest): { where: string; params: any[] } {
  const a = req.auth!;
  if (isPlatformWide(a.role)) return { where: `tenant_id IS NULL${a.role === "system_admin" ? "" : " AND COALESCE(function_name,'') <> 'accounting'"}`, params: [] };
  return { where: "tenant_id = $1", params: [a.agencyId] };
}

for (const [path, table, cols, order] of [
  ["/api/mail/outbox", "email_outbox", "id, kind, function_name, to_address, subject, status, attempts, last_error, created_at, sent_at", "created_at"],
  ["/api/mail/inbox", "email_inbox", "id, to_address, from_address, subject, function_name, status, body_status, received_at", "received_at"]
] as const) {
  mailRouter.get(path, authenticate, MAIL_ROLES, h(async (req, res) => {
    const { where, params } = scope(req as AuthedRequest);
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const extra = status ? ` AND status = $${params.length + 1}` : "";
    const rows = (await pool.query(`SELECT ${cols} FROM ${table} WHERE ${where}${extra} ORDER BY ${order} DESC LIMIT 200`, status ? [...params, status] : params)).rows;
    res.json({ items: rows });
  }));
}

mailRouter.get("/api/mail/inbox/:id", authenticate, MAIL_ROLES, h(async (req, res) => {
  const id = uuidParam(req);
  const { where, params } = scope(req as AuthedRequest);
  const row = (await pool.query(`SELECT id, to_address, from_address, subject, text_body, html, function_name, status, body_status, received_at FROM email_inbox WHERE id = $${params.length + 1} AND ${where}`, [...params, id])).rows[0];
  if (!row) throw httpError(404, "NOT_FOUND");
  res.json(row);
}));

// Platform admin: delivery counters per DMC, never any content.
mailRouter.get("/api/mail/counters", authenticate, roles("system_admin", "back_office"), h(async (_req, res) => {
  const rows = (await pool.query(
    `SELECT a.id AS tenant_id, a.name, count(*) FILTER (WHERE o.status = 'sent')::int AS sent, count(*) FILTER (WHERE o.status = 'failed')::int AS failed
       FROM agencies a JOIN email_outbox o ON o.tenant_id = a.id WHERE a.type = 'master' GROUP BY a.id, a.name ORDER BY a.name`)).rows;
  res.json({ items: rows });
}));

// DMC mail settings. Credentials are write-only.
const dmcOnly = [authenticate, roles("master_agency")] as const;
const publicSettings = (s: any) => s ? {
  configured: true, fromAddress: s.from_address, fromName: s.from_name, replyTo: s.reply_to, verifiedDomain: s.verified_domain, active: s.active,
  hasCredentials: !!s.credentials_enc, hasWebhookSecret: !!s.inbound_webhook_secret_enc, inboundUrl: `/api/webhooks/mail/inbound/${s.inbound_key}`
} : { configured: false };

mailRouter.get("/api/mail/settings", ...dmcOnly, h(async (req, res) => {
  const s = (await pool.query("SELECT * FROM tenant_mail_settings WHERE tenant_id = $1", [req.auth!.agencyId])).rows[0];
  res.json(publicSettings(s));
}));

mailRouter.put("/api/mail/settings", ...dmcOnly, h(async (req, res) => {
  const b = req.body || {};
  const allowed = ["apiKey", "fromAddress", "fromName", "replyTo", "verifiedDomain", "inboundWebhookSecret", "active"];
  if (Object.keys(b).some(k => !allowed.includes(k))) throw httpError(400, "INVALID_MAIL_SETTINGS");
  const from = EMAIL_RE.exec(String(b.fromAddress || "")), domain = String(b.verifiedDomain || "").toLowerCase();
  const name = String(b.fromName || "").trim();
  if (!from || !DOMAIN_RE.test(domain) || !name || name.length > 100 || (from[1] ?? "").toLowerCase() !== domain)
    throw httpError(400, "INVALID_MAIL_SETTINGS");
  if (domain === PLATFORM_DOMAIN || domain.endsWith("." + PLATFORM_DOMAIN)) throw httpError(400, "PLATFORM_DOMAIN_RESERVED");
  if (b.replyTo != null && b.replyTo !== "" && !EMAIL_RE.test(String(b.replyTo))) throw httpError(400, "INVALID_MAIL_SETTINGS");
  if (b.active !== undefined && typeof b.active !== "boolean") throw httpError(400, "INVALID_MAIL_SETTINGS");
  const tenant = req.auth!.agencyId!;
  const saved = await withTransaction(async client => {
    const before = (await client.query("SELECT * FROM tenant_mail_settings WHERE tenant_id = $1", [tenant])).rows[0];
    const apiKey = typeof b.apiKey === "string" && b.apiKey.trim() ? b.apiKey.trim() : null;
    if (!before && !apiKey) throw httpError(400, "API_KEY_REQUIRED");
    const credentials = apiKey ? encryptSecret(JSON.stringify({ apiKey })) : before.credentials_enc;
    const webhookSecret = typeof b.inboundWebhookSecret === "string" && b.inboundWebhookSecret.trim() ? encryptSecret(b.inboundWebhookSecret.trim()) : (before?.inbound_webhook_secret_enc ?? null);
    const row = (await client.query(
      `INSERT INTO tenant_mail_settings(tenant_id, credentials_enc, from_address, from_name, reply_to, verified_domain, inbound_key, inbound_webhook_secret_enc, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id) DO UPDATE SET credentials_enc = EXCLUDED.credentials_enc, from_address = EXCLUDED.from_address, from_name = EXCLUDED.from_name,
         reply_to = EXCLUDED.reply_to, verified_domain = EXCLUDED.verified_domain, inbound_webhook_secret_enc = EXCLUDED.inbound_webhook_secret_enc,
         active = EXCLUDED.active, updated_at = now() RETURNING *`,
      [tenant, credentials, from[0], name, b.replyTo || null, domain, randomBytes(18).toString("base64url"), webhookSecret, b.active === true])).rows[0];
    // Audit never carries credentials.
    await audit(client, req.auth!.sub, tenant, "mail.settings.updated", "tenant_mail_settings", tenant, { targetAgencyId: tenant, before: publicSettings(before), after: publicSettings(row) });
    return row;
  }, tenant);
  res.json(publicSettings(saved));
}));
