// Mail provider abstraction. Only Resend is implemented (plain fetch, no extra package).
export interface OutgoingMail {
  from: { address: string; name: string };
  replyTo: string | null;
  to: string;
  subject: string;
  html: string;
  text: string;
}
export interface MailProvider { send(mail: OutgoingMail, idempotencyKey: string): Promise<{ id: string }> }

export class MailProviderError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

type FetchLike = typeof fetch;
const RESEND_API = "https://api.resend.com";

export class ResendProvider implements MailProvider {
  constructor(private apiKey: string, private fetchImpl: FetchLike = fetch) {}

  async send(mail: OutgoingMail, idempotencyKey: string): Promise<{ id: string }> {
    const response = await this.fetchImpl(`${RESEND_API}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({
        from: `${mail.from.name.replace(/[<>"\r\n]/g, "")} <${mail.from.address}>`,
        to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {})
      })
    });
    if (!response.ok) {
      // 4xx (except 408/409/429) will not succeed on retry; 5xx and rate limits will.
      const retryable = response.status >= 500 || [408, 409, 429].includes(response.status);
      throw new MailProviderError(`RESEND_${response.status}`, retryable);
    }
    const body = await response.json() as { id?: string };
    if (!body.id) throw new MailProviderError("RESEND_NO_ID", true);
    return { id: body.id };
  }
}

export interface ReceivedEmail { text: string | null; html: string | null; messageId: string | null; attachments: ReceivedAttachment[] }
export interface ReceivedAttachment { filename: string; contentType: string; size: number; downloadUrl: string }

/** Webhooks carry metadata only; the body and attachment list are fetched with the Receiving API.
 *  Endpoint paths follow Resend's Receiving API; verify against the live API before production use. */
export async function fetchReceivedEmail(apiKey: string, emailId: string, fetchImpl: FetchLike = fetch): Promise<ReceivedEmail> {
  const headers = { authorization: `Bearer ${apiKey}` };
  const response = await fetchImpl(`${RESEND_API}/emails/receiving/${encodeURIComponent(emailId)}`, { headers });
  if (!response.ok) throw new MailProviderError(`RESEND_RECEIVE_${response.status}`, response.status >= 500 || response.status === 429);
  const body = await response.json() as any;
  const list = await fetchImpl(`${RESEND_API}/emails/receiving/${encodeURIComponent(emailId)}/attachments`, { headers });
  const attachments: ReceivedAttachment[] = [];
  if (list.ok) {
    const parsed = await list.json() as any;
    for (const a of (parsed?.data ?? [])) {
      if (a && typeof a.filename === "string" && typeof a.download_url === "string")
        attachments.push({ filename: a.filename, contentType: String(a.content_type || "application/octet-stream"), size: Number(a.size) || 0, downloadUrl: a.download_url });
    }
  }
  return { text: typeof body.text === "string" ? body.text : null, html: typeof body.html === "string" ? body.html : null, messageId: typeof body.message_id === "string" ? body.message_id : null, attachments };
}
