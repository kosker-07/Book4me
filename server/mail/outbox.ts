// Outbox: every outgoing mail is stored first, then delivered by processOutbox with retries and backoff.
// DMC mail uses only that DMC's own verified settings (no fallback to platform mail). Platform mail uses the
// platform addresses and RESEND_API_KEY. Claiming uses a single UPDATE (no explicit row locks).
import { decryptSecret } from "./crypto";
import { platformSender, PlatformFunction, Sender } from "./addresses";
import { MailProvider, MailProviderError, ResendProvider } from "./provider";

export interface Rendered { subject: string; html: string; text: string }
export interface Db { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }
export interface EnqueueInput { tenantId: string | null; kind: string; to: string; mail: Rendered; idempotencyKey?: string; functionName?: PlatformFunction }

export const MAX_ATTEMPTS = 5;
export const BACKOFF_MINUTES = [1, 5, 30, 120, 720];
const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/** A sub-agency sends with its parent DMC's settings; a DMC with its own; null = platform. */
export async function tenantOf(db: Db, agencyId: string): Promise<string> {
  const r = (await db.query("SELECT CASE WHEN type = 'master' THEN id ELSE parent_agency_id END AS tenant FROM agencies WHERE id = $1", [agencyId])).rows[0];
  if (!r?.tenant) throw new Error("TENANT_NOT_FOUND");
  return r.tenant;
}

export async function enqueueMail(db: Db, input: EnqueueInput): Promise<{ id: string; status: "queued" | "failed"; deduplicated: boolean }> {
  if (!EMAIL_RE.test(input.to)) throw new Error("INVALID_RECIPIENT");
  let status: "queued" | "failed" = "queued", error: string | null = null;
  if (input.tenantId) {
    const s = (await db.query("SELECT 1 FROM tenant_mail_settings WHERE tenant_id = $1 AND active AND verified_domain IS NOT NULL", [input.tenantId])).rows[0];
    if (!s) { status = "failed"; error = "MAIL_NOT_CONFIGURED"; }
  }
  const fn = input.tenantId ? null : (input.functionName ?? "noreply");
  const inserted = (await db.query(
    `INSERT INTO email_outbox(tenant_id, kind, function_name, to_address, subject, html, text_body, status, last_error, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING id`,
    [input.tenantId, input.kind, fn, input.to, input.mail.subject, input.mail.html, input.mail.text, status, error, input.idempotencyKey ?? null])).rows[0];
  if (inserted) return { id: inserted.id, status, deduplicated: false };
  const existing = (await db.query(
    "SELECT id, status FROM email_outbox WHERE COALESCE(tenant_id::text,'platform') = COALESCE($1::text,'platform') AND idempotency_key = $2", [input.tenantId, input.idempotencyKey])).rows[0];
  return { id: existing.id, status: existing.status, deduplicated: true };
}

export interface Deps { db: Db; providerFor?: (apiKey: string) => MailProvider; platformApiKey?: string; now?: () => Date }

async function resolve(deps: Deps, row: any): Promise<{ sender: Sender; provider: MailProvider }> {
  const make = deps.providerFor ?? ((k: string) => new ResendProvider(k));
  if (!row.tenant_id) {
    const key = deps.platformApiKey ?? process.env.RESEND_API_KEY ?? "";
    if (!key) throw new MailProviderError("PLATFORM_MAIL_NOT_CONFIGURED", true);
    return { sender: platformSender((row.function_name || "noreply") as PlatformFunction), provider: make(key) };
  }
  const s = (await deps.db.query(
    "SELECT credentials_enc, from_address, from_name, reply_to FROM tenant_mail_settings WHERE tenant_id = $1 AND active AND verified_domain IS NOT NULL", [row.tenant_id])).rows[0];
  if (!s) throw new MailProviderError("MAIL_NOT_CONFIGURED", false);
  let apiKey: string;
  try { apiKey = String(JSON.parse(decryptSecret(s.credentials_enc)).apiKey || ""); } catch { throw new MailProviderError("MAIL_CREDENTIALS_INVALID", false); }
  if (!apiKey) throw new MailProviderError("MAIL_CREDENTIALS_INVALID", false);
  return { sender: { address: s.from_address, name: s.from_name, replyTo: s.reply_to }, provider: make(apiKey) };
}

export async function processOutbox(deps: Deps, limit = 20): Promise<{ sent: number; retried: number; failed: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const due = "(status = 'queued' AND next_attempt_at <= $1) OR (status = 'sending' AND claimed_at < $1::timestamptz - interval '15 minutes')";
  const claimed = (await deps.db.query(
    `UPDATE email_outbox SET status = 'sending', claimed_at = $1, attempts = attempts + 1
      WHERE id IN (SELECT id FROM email_outbox WHERE ${due} ORDER BY next_attempt_at LIMIT $2) AND (${due}) RETURNING *`, [now, limit])).rows;
  const result = { sent: 0, retried: 0, failed: 0 };
  for (const row of claimed) {
    try {
      const { sender, provider } = await resolve(deps, row);
      const { id } = await provider.send({ from: { address: sender.address, name: sender.name }, replyTo: sender.replyTo, to: row.to_address, subject: row.subject, html: row.html, text: row.text_body }, row.id);
      await deps.db.query("UPDATE email_outbox SET status = 'sent', sent_at = $2, provider_message_id = $3, last_error = NULL WHERE id = $1", [row.id, now, id]);
      result.sent++;
    } catch (e: any) {
      const retryable = e instanceof MailProviderError ? e.retryable : true;
      const code = String(e?.message || "SEND_FAILED").slice(0, 200);
      if (!retryable || row.attempts >= MAX_ATTEMPTS) {
        await deps.db.query("UPDATE email_outbox SET status = 'failed', last_error = $2 WHERE id = $1", [row.id, code]);
        result.failed++;
      } else {
        const minutes = BACKOFF_MINUTES[Math.min(row.attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 720;
        await deps.db.query("UPDATE email_outbox SET status = 'queued', last_error = $2, next_attempt_at = $3 WHERE id = $1", [row.id, code, new Date(now.getTime() + minutes * 60_000)]);
        result.retried++;
      }
    }
  }
  return result;
}
