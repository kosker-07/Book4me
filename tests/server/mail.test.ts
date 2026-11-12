import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "../../server/mail/crypto";
import { verifySvix } from "../../server/mail/svix";
import { functionForAddress, platformSender } from "../../server/mail/addresses";
import { assertSafeTemplateData, bookingConfirmation, contractExpiry, paymentReminder, voucherReady } from "../../server/mail/templates";
import { MailProviderError, ResendProvider, fetchReceivedEmail } from "../../server/mail/provider";
import { BACKOFF_MINUTES, MAX_ATTEMPTS, processOutbox } from "../../server/mail/outbox";

process.env.MAIL_SECRET_KEY = randomBytes(32).toString("base64");

test("credentials round-trip and tampering is detected", () => {
  const stored = encryptSecret(JSON.stringify({ apiKey: "re_secret" }));
  assert.ok(!stored.includes("re_secret"));
  assert.equal(JSON.parse(decryptSecret(stored)).apiKey, "re_secret");
  assert.notEqual(stored, encryptSecret(JSON.stringify({ apiKey: "re_secret" })));
  const buf = Buffer.from(stored, "base64"); buf[buf.length - 1] = (buf[buf.length - 1] ?? 0) ^ 1;
  assert.throws(() => decryptSecret(buf.toString("base64")));
});

const sign = (secret: string, id: string, ts: string, body: string) => "v1," + createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64");
test("svix signature: valid, wrong secret, tampered body, stale timestamp", () => {
  const secret = "whsec_" + randomBytes(24).toString("base64"), body = '{"type":"email.received"}', id = "msg_1", now = Date.now(), ts = String(Math.floor(now / 1000));
  const sig = sign(secret, id, ts, body);
  assert.equal(verifySvix(secret, { id, timestamp: ts, signature: sig }, body, now), true);
  assert.equal(verifySvix(secret, { id, timestamp: ts, signature: "v1,AAAA " + sig }, body, now), true, "any listed signature may match");
  assert.equal(verifySvix("whsec_" + randomBytes(24).toString("base64"), { id, timestamp: ts, signature: sig }, body, now), false);
  assert.equal(verifySvix(secret, { id, timestamp: ts, signature: sig }, body + " ", now), false);
  assert.equal(verifySvix(secret, { id, timestamp: String(Math.floor(now / 1000) - 3600), signature: sign(secret, id, String(Math.floor(now / 1000) - 3600), body) }, body, now), false);
  assert.equal(verifySvix(secret, {}, body, now), false);
  assert.equal(verifySvix("", { id, timestamp: ts, signature: sig }, body, now), false);
});

test("platform addresses: function mapping and senders", () => {
  assert.equal(functionForAddress("Support@bed4book.com"), "support");
  assert.equal(functionForAddress("contracts@in.bed4book.com"), "contracts");
  assert.equal(functionForAddress("support@bed4book.com.evil.com"), null);
  assert.equal(functionForAddress("founder@bed4book.com"), null);
  assert.equal(functionForAddress("support@other.com"), null);
  assert.equal(platformSender("support").address, "support@bed4book.com");
  assert.equal(platformSender("noreply").replyTo, "support@bed4book.com");
});

test("templates reject net, margin, fee and DMC identity; allowed data renders escaped", () => {
  for (const key of ["netPrice", "margin", "platformFee", "dmcName", "markup", "supplierName", "net_total", "commission"])
    assert.throws(() => assertSafeTemplateData({ [key]: 1 }), /FORBIDDEN_MAIL_FIELD/, key);
  assert.throws(() => assertSafeTemplateData({ nested: { dmc_name: "x" } }), /FORBIDDEN_MAIL_FIELD/);
  assert.doesNotThrow(() => assertSafeTemplateData({ reference: "B1", guestName: "A", hotelName: "H", checkIn: "2027-01-01", checkOut: "2027-01-02", total: "100", currency: "EUR" }));
  const m = bookingConfirmation({ reference: "B1", guestName: "<b>Ann</b>", hotelName: "H", checkIn: "2027-01-01", checkOut: "2027-01-02", total: "100", currency: "EUR" });
  assert.ok(!m.html.includes("<b>Ann"));
  for (const out of [m, voucherReady({ reference: "B1", guestName: "A", hotelName: "H" }), paymentReminder({ reference: "B1", amountDue: "5", currency: "EUR", dueDate: "2027-01-01" }), contractExpiry({ contractNumber: "C1", endDate: "2027-01-01" })])
    assert.ok(!/net price|margin|platform fee|markup/i.test(out.html + out.text));
  assert.throws(() => bookingConfirmation({ reference: "B1", guestName: "A", hotelName: "H", checkIn: "x", checkOut: "y", total: "1", currency: "EUR", netPrice: "90" } as any), /FORBIDDEN_MAIL_FIELD/);
});

const mail = { from: { address: "noreply@bed4book.com", name: "BED4BOOK" }, replyTo: null, to: "a@b.co", subject: "s", html: "<p>x</p>", text: "x" };
test("resend provider: request shape, idempotency key, retry classification", async () => {
  let seen: any;
  const ok = new ResendProvider("re_key", (async (url: any, init: any) => { seen = { url, init }; return new Response(JSON.stringify({ id: "m1" }), { status: 200 }); }) as any);
  assert.deepEqual(await ok.send(mail, "idem-1"), { id: "m1" });
  assert.equal(seen.url, "https://api.resend.com/emails");
  assert.equal(seen.init.headers["idempotency-key"], "idem-1");
  assert.equal(seen.init.headers.authorization, "Bearer re_key");
  assert.equal(JSON.parse(seen.init.body).from, "BED4BOOK <noreply@bed4book.com>");
  for (const [status, retryable] of [[500, true], [429, true], [422, false], [401, false]] as const) {
    const p = new ResendProvider("k", (async () => new Response("{}", { status })) as any);
    await assert.rejects(p.send(mail, "i"), (e: any) => e instanceof MailProviderError && e.retryable === retryable);
  }
});

test("received email fetch: body and attachment metadata", async () => {
  const f = (async (url: string) => String(url).endsWith("/attachments")
    ? new Response(JSON.stringify({ data: [{ filename: "c.xlsx", content_type: "application/vnd.ms-excel", size: 10, download_url: "https://x/y" }, { bad: true }] }))
    : new Response(JSON.stringify({ text: "hi", html: "<p>hi</p>", message_id: "<m@x>" }))) as any;
  const r = await fetchReceivedEmail("k", "e1", f);
  assert.equal(r.text, "hi"); assert.equal(r.messageId, "<m@x>");
  assert.deepEqual(r.attachments, [{ filename: "c.xlsx", contentType: "application/vnd.ms-excel", size: 10, downloadUrl: "https://x/y" }]);
});

// Minimal in-memory outbox standing in for PostgreSQL: it understands exactly the statements processOutbox issues.
function fakeDb(rows: any[], settings: any = null) {
  return {
    rows,
    async query(sql: string, p: any[] = []) {
      if (sql.startsWith("UPDATE email_outbox SET status = 'sending'")) {
        const now = p[0] as Date, out: any[] = [];
        for (const r of rows) if (r.status === "queued" && r.next_attempt_at <= now) { r.status = "sending"; r.attempts += 1; out.push({ ...r }); }
        return { rows: out };
      }
      if (sql.includes("FROM tenant_mail_settings")) return { rows: settings && p[0] === settings.tenant_id ? [settings] : [] };
      const r = rows.find(x => x.id === p[0]);
      if (sql.includes("SET status = 'sent'")) Object.assign(r, { status: "sent", sent_at: p[1], provider_message_id: p[2] });
      else if (sql.includes("SET status = 'failed'")) Object.assign(r, { status: "failed", last_error: p[1] });
      else if (sql.includes("SET status = 'queued'")) Object.assign(r, { status: "queued", last_error: p[1], next_attempt_at: p[2] });
      return { rows: [] };
    }
  };
}
const row = (over: any = {}) => ({ id: "o1", tenant_id: null, function_name: "support", to_address: "x@y.co", subject: "s", html: "h", text_body: "t", status: "queued", attempts: 0, next_attempt_at: new Date(0), ...over });

test("outbox: platform mail is sent from the function address, once, with the row id as idempotency key", async () => {
  const db = fakeDb([row()]); const calls: any[] = [];
  const r = await processOutbox({ db, platformApiKey: "k", providerFor: () => ({ send: async (m, key) => { calls.push({ m, key }); return { id: "pm1" }; } }) });
  assert.deepEqual(r, { sent: 1, retried: 0, failed: 0 });
  assert.equal(calls[0].m.from.address, "support@bed4book.com"); assert.equal(calls[0].key, "o1");
  assert.equal(db.rows[0].status, "sent");
  assert.deepEqual(await processOutbox({ db, platformApiKey: "k", providerFor: () => { throw new Error("must not run"); } }), { sent: 0, retried: 0, failed: 0 });
});

test("outbox: retryable failures back off, then fail after the maximum attempts", async () => {
  const db = fakeDb([row()]); const now = new Date("2027-01-01T00:00:00Z");
  const boom = () => ({ send: async () => { throw new MailProviderError("RESEND_500", true); } });
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    const r = await processOutbox({ db, platformApiKey: "k", providerFor: boom, now: () => now });
    assert.equal(r.retried, 1, "attempt " + i);
    assert.equal(db.rows[0].next_attempt_at.getTime(), now.getTime() + (BACKOFF_MINUTES[i - 1] ?? 720) * 60_000);
    db.rows[0].next_attempt_at = new Date(0);
  }
  const last = await processOutbox({ db, platformApiKey: "k", providerFor: boom, now: () => now });
  assert.equal(last.failed, 1); assert.equal(db.rows[0].status, "failed"); assert.equal(db.rows[0].last_error, "RESEND_500");
});

test("outbox: a non-retryable error fails immediately; a DMC without settings is blocked, never sent from platform mail", async () => {
  let used = 0; const spy = () => { used++; return { send: async () => ({ id: "x" }) }; };
  const a = fakeDb([row({ id: "a" })]);
  assert.equal((await processOutbox({ db: a, platformApiKey: "k", providerFor: () => ({ send: async () => { throw new MailProviderError("RESEND_422", false); } }) })).failed, 1);
  const b = fakeDb([row({ id: "b", tenant_id: "dmc-1", function_name: null })]);
  const r = await processOutbox({ db: b, platformApiKey: "platform-key", providerFor: spy });
  assert.equal(r.failed, 1); assert.equal(used, 0); assert.equal(b.rows[0].last_error, "MAIL_NOT_CONFIGURED");
});

test("outbox: a DMC sends with its own decrypted key and its own sender, not platform mail", async () => {
  const settings = { tenant_id: "dmc-1", credentials_enc: encryptSecret(JSON.stringify({ apiKey: "dmc_key" })), from_address: "res@hotelco.com", from_name: "Hotelco", reply_to: "help@hotelco.com" };
  const db = fakeDb([row({ tenant_id: "dmc-1", function_name: null })], settings); let key = "", from = "";
  const r = await processOutbox({ db, platformApiKey: "platform-key", providerFor: k => { key = k; return { send: async m => { from = m.from.address; return { id: "z" }; } }; } });
  assert.equal(r.sent, 1); assert.equal(key, "dmc_key"); assert.equal(from, "res@hotelco.com");
});
