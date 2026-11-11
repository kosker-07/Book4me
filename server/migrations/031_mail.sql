-- Mail layer: per-DMC mail settings (own domain, own provider key), outbox with retries, inbox for received mail.
-- tenant_id = the DMC (master agency). tenant_id NULL = platform mail (bed4book.com addresses, platform business only).
-- Sub-agencies use their parent DMC's settings. There is deliberately no fallback from a DMC to platform mail.

CREATE TABLE IF NOT EXISTS tenant_mail_settings (
  tenant_id uuid PRIMARY KEY REFERENCES agencies(id),
  provider text NOT NULL DEFAULT 'resend' CHECK (provider = 'resend'),
  credentials_enc text NOT NULL,
  from_address text NOT NULL,
  from_name text NOT NULL,
  reply_to text,
  verified_domain text,
  inbound_key text NOT NULL UNIQUE,
  inbound_webhook_secret_enc text,
  active boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES agencies(id),
  kind text NOT NULL,
  function_name text,
  to_address text NOT NULL,
  subject text NOT NULL,
  html text NOT NULL,
  text_body text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  last_error text,
  provider_message_id text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS email_outbox_idem_idx ON email_outbox ((COALESCE(tenant_id::text, 'platform')), idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_outbox_due_idx ON email_outbox (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS email_outbox_tenant_idx ON email_outbox (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS email_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES agencies(id),
  provider_email_id text NOT NULL,
  message_id text,
  to_address text NOT NULL,
  from_address text NOT NULL,
  subject text NOT NULL DEFAULT '',
  text_body text,
  html text,
  function_name text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','classified','handled')),
  body_status text NOT NULL DEFAULT 'pending' CHECK (body_status IN ('pending','fetched','failed')),
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_inbox_dedupe_idx ON email_inbox ((COALESCE(tenant_id::text, 'platform')), provider_email_id);
CREATE INDEX IF NOT EXISTS email_inbox_tenant_idx ON email_inbox (tenant_id, received_at DESC);

CREATE TABLE IF NOT EXISTS inbound_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_id uuid NOT NULL REFERENCES email_inbox(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes int NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 15728640),
  sha256 text NOT NULL,
  data bytea NOT NULL
);
CREATE INDEX IF NOT EXISTS inbound_attachments_inbox_idx ON inbound_attachments (inbox_id);
