import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const skip = !process.env.DATABASE_URL ? "DATABASE_URL required" : false;
if (skip && process.env.CI) throw new Error("DATABASE_URL required in CI");
process.env.SESSION_SECRET ||= "mail-integration-secret-at-least-32-chars";
process.env.MAIL_SECRET_KEY = randomBytes(32).toString("base64");
const WEBHOOK_SECRET = "whsec_" + randomBytes(24).toString("base64");
process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.MAIL_WORKER = "off";

let pool: any, server: Server, base: string, enqueueMail: any;
let dmcA = "", dmcB = "", subA = "", tokA = "", tokB = "", tokSub = "", tokAdmin = "";
async function call(method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const raw = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const r = await fetch(base + path, { method, headers: { ...(token ? { authorization: "Bearer " + token } : {}), "content-type": "application/json", ...headers }, body: raw });
  return { status: r.status, body: (r.headers.get("content-type") ?? "").includes("json") ? await r.json() as any : null };
}
const settings = (over: any = {}) => ({ apiKey: "re_dmc_secret_key", fromAddress: "res@hotelco.com", fromName: "Hotelco", verifiedDomain: "hotelco.com", active: true, ...over });
const signed = (body: string, secret = WEBHOOK_SECRET) => {
  const id = "msg_" + randomUUID(), ts = String(Math.floor(Date.now() / 1000));
  const sig = "v1," + createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": ts, "svix-signature": sig };
};
const event = (to: string, emailId = "em_" + randomUUID()) => JSON.stringify({ type: "email.received", data: { email_id: emailId, from: "a@b.co", to: [to], subject: "Hi" } });

before(async () => {
  if (skip) return;
  ({ pool } = await import("../../server/db"));
  ({ enqueueMail } = await import("../../server/mail/outbox"));
  const { default: app } = await import("../../server/app");
  server = app.listen(0); base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(async () => { if (!skip) { server.close(); await pool.end(); } });
beforeEach(async () => {
  if (skip) return;
  const { hashPassword, issueSession } = await import("../../server/security");
  await pool.query("TRUNCATE agencies, users, email_outbox, email_inbox, tenant_mail_settings CASCADE");
  dmcA = randomUUID(); dmcB = randomUUID(); subA = randomUUID();
  for (const [id, name, type, parent] of [[dmcA, "DMC A", "master", null], [dmcB, "DMC B", "master", null], [subA, "Sub A", "sub", dmcA]])
    await pool.query("INSERT INTO agencies(id,name,type,parent_agency_id) VALUES($1,$2,$3,$4)", [id, name, type, parent]);
  const mk = async (email: string, role: string, agency: string | null) => {
    const id = randomUUID();
    await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES($1,$2,$3,$4,$5)", [id, email, hashPassword("password-123"), role, agency]);
    return issueSession({ sub: id, role, agencyId: agency, ver: 0 } as any, process.env.SESSION_SECRET!);
  };
  tokA = await mk("a@t.local", "master_agency", dmcA); tokB = await mk("b@t.local", "master_agency", dmcB);
  tokSub = await mk("s@t.local", "sub_agency", subA); tokAdmin = await mk("admin@t.local", "system_admin", null);
});

test("M1 settings: credentials are write-only, platform domain reserved, sub-agency forbidden", { skip }, async () => {
  const put = await call("PUT", "/api/mail/settings", tokA, settings({ inboundWebhookSecret: "whsec_" + randomBytes(24).toString("base64") }));
  assert.equal(put.status, 200);
  const get = await call("GET", "/api/mail/settings", tokA);
  for (const r of [put, get]) {
    assert.ok(!JSON.stringify(r.body).includes("re_dmc_secret_key"));
    assert.equal(r.body.hasCredentials, true); assert.equal(r.body.hasWebhookSecret, true);
    assert.ok(!("apiKey" in r.body) && !("credentials_enc" in r.body));
  }
  const stored = (await pool.query("SELECT credentials_enc FROM tenant_mail_settings WHERE tenant_id=$1", [dmcA])).rows[0].credentials_enc;
  assert.ok(!stored.includes("re_dmc_secret_key"));
  const audit = JSON.stringify((await pool.query("SELECT before, after FROM audit_logs WHERE action='mail.settings.updated'")).rows);
  assert.ok(!audit.includes("re_dmc_secret_key") && !audit.includes(stored));
  assert.equal((await call("PUT", "/api/mail/settings", tokA, settings({ verifiedDomain: "bed4book.com", fromAddress: "x@bed4book.com" }))).body.error, "PLATFORM_DOMAIN_RESERVED");
  assert.equal((await call("PUT", "/api/mail/settings", tokA, settings({ verifiedDomain: "mail.bed4book.com", fromAddress: "x@mail.bed4book.com" }))).body.error, "PLATFORM_DOMAIN_RESERVED");
  assert.equal((await call("PUT", "/api/mail/settings", tokA, settings({ fromAddress: "x@other.com" }))).status, 400);
  assert.equal((await call("GET", "/api/mail/settings", tokSub)).status, 403);
  assert.equal((await call("GET", "/api/mail/settings", tokAdmin)).status, 403);
});

test("M2 no fallback: a DMC without verified settings is blocked, never sent from platform mail", { skip }, async () => {
  const mail = { subject: "s", html: "h", text: "t" };
  const blocked = await enqueueMail(pool, { tenantId: dmcB, kind: "test", to: "g@x.co", mail });
  assert.equal(blocked.status, "failed");
  assert.equal((await pool.query("SELECT last_error FROM email_outbox WHERE id=$1", [blocked.id])).rows[0].last_error, "MAIL_NOT_CONFIGURED");
  await call("PUT", "/api/mail/settings", tokA, settings());
  assert.equal((await enqueueMail(pool, { tenantId: dmcA, kind: "test", to: "g@x.co", mail })).status, "queued");
  const first = await enqueueMail(pool, { tenantId: null, kind: "t", to: "g@x.co", mail, idempotencyKey: "k1" });
  const again = await enqueueMail(pool, { tenantId: null, kind: "t", to: "g@x.co", mail, idempotencyKey: "k1" });
  assert.equal(again.deduplicated, true); assert.equal(again.id, first.id);
  assert.equal((await enqueueMail(pool, { tenantId: dmcA, kind: "t", to: "g@x.co", mail, idempotencyKey: "k1" })).deduplicated, false, "keys are per tenant");
});

test("M3 visibility: a DMC sees only its own mail; platform roles never see DMC mail content", { skip }, async () => {
  await call("PUT", "/api/mail/settings", tokA, settings()); await call("PUT", "/api/mail/settings", tokB, settings({ fromAddress: "r@bco.com", verifiedDomain: "bco.com" }));
  const mail = (s: string) => ({ subject: s, html: "h", text: "t" });
  await enqueueMail(pool, { tenantId: dmcA, kind: "t", to: "g@x.co", mail: mail("SECRET-A") });
  await enqueueMail(pool, { tenantId: dmcB, kind: "t", to: "g@x.co", mail: mail("SECRET-B") });
  await enqueueMail(pool, { tenantId: null, kind: "t", to: "g@x.co", mail: mail("PLATFORM") });
  const inboxA = (await pool.query("INSERT INTO email_inbox(tenant_id, provider_email_id, to_address, from_address, subject) VALUES($1,'e1','a@h.co','x@y.co','INBOX-A') RETURNING id", [dmcA])).rows[0].id;
  const a = await call("GET", "/api/mail/outbox", tokA), b = await call("GET", "/api/mail/outbox", tokB), admin = await call("GET", "/api/mail/outbox", tokAdmin);
  assert.deepEqual(a.body.items.map((x: any) => x.subject), ["SECRET-A"]);
  assert.deepEqual(b.body.items.map((x: any) => x.subject), ["SECRET-B"]);
  assert.deepEqual(admin.body.items.map((x: any) => x.subject), ["PLATFORM"]);
  const foreign = await call("GET", "/api/mail/inbox/" + inboxA, tokB), absent = await call("GET", "/api/mail/inbox/" + randomUUID(), tokB);
  assert.equal(foreign.status, 404); assert.deepEqual(foreign, absent);
  assert.equal((await call("GET", "/api/mail/inbox/" + inboxA, tokAdmin)).status, 404);
  assert.equal((await call("GET", "/api/mail/inbox", tokAdmin)).body.items.length, 0);
  const counters = await call("GET", "/api/mail/counters", tokAdmin);
  assert.equal(counters.status, 200);
  assert.ok(!/SECRET-|INBOX-A|g@x\.co/.test(JSON.stringify(counters.body)));
  assert.equal((await call("GET", "/api/mail/counters", tokA)).status, 403);
});

test("M4 inbound webhooks: bad signature is 401, valid is stored once, tenant webhooks use the tenant's own secret", { skip }, async () => {
  const body = event("support@bed4book.com", "em_1");
  assert.equal((await call("POST", "/api/webhooks/mail/inbound", null, body)).status, 401);
  assert.equal((await call("POST", "/api/webhooks/mail/inbound", null, body, signed(body, "whsec_" + randomBytes(24).toString("base64")))).status, 401);
  const ok = await call("POST", "/api/webhooks/mail/inbound", null, body, signed(body));
  assert.equal(ok.status, 200);
  const dup = await call("POST", "/api/webhooks/mail/inbound", null, body, signed(body));
  assert.equal(dup.body.deduplicated, true);
  const rows = (await pool.query("SELECT tenant_id, function_name FROM email_inbox")).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].tenant_id, null); assert.equal(rows[0].function_name, "support");
  const tenantSecret = "whsec_" + randomBytes(24).toString("base64");
  await call("PUT", "/api/mail/settings", tokA, settings({ inboundWebhookSecret: tenantSecret }));
  const url = (await call("GET", "/api/mail/settings", tokA)).body.inboundUrl as string;
  const tb = event("res@hotelco.com", "em_t1");
  assert.equal((await call("POST", url, null, tb, signed(tb))).status, 401, "platform secret must not work for a tenant");
  assert.equal((await call("POST", url, null, tb, signed(tb, tenantSecret))).status, 200);
  assert.equal((await call("POST", "/api/webhooks/mail/inbound/unknown-key", null, tb, signed(tb, tenantSecret))).status, 401);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM email_inbox WHERE tenant_id=$1", [dmcA])).rows[0].n, 1);
  assert.equal((await call("GET", "/api/mail/inbox", tokB)).body.items.length, 0);
});
