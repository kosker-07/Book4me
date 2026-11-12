-- AI tool records; idempotent migration 034.
CREATE TABLE IF NOT EXISTS ai_reply_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 inbox_id uuid NOT NULL REFERENCES email_inbox(id),
 agent_id text NOT NULL REFERENCES ai_agents(id),
 to_address text NOT NULL,
 subject text NOT NULL,
 text_body text NOT NULL,
 state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','approved','sent','rejected')),
 approval_id uuid REFERENCES approval_queue(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_reply_drafts_inbox_idx ON ai_reply_drafts(inbox_id);

CREATE TABLE IF NOT EXISTS ai_booking_flags (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 booking_id uuid NOT NULL REFERENCES bookings(id),
 agent_id text NOT NULL REFERENCES ai_agents(id),
 reason text NOT NULL CHECK (char_length(reason) <= 500),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_booking_flags_booking_idx ON ai_booking_flags(booking_id);

CREATE TABLE IF NOT EXISTS refund_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 booking_id uuid NOT NULL REFERENCES bookings(id),
 amount numeric(14,2) NOT NULL CHECK (amount > 0),
 currency text NOT NULL,
 reason text NOT NULL,
 state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','approved','rejected')),
 requested_by_agent text NOT NULL REFERENCES ai_agents(id),
 approved_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refund_requests_booking_idx ON refund_requests(booking_id);
