-- Payment reminders by e-mail with a "read" link. Two per booking: a few days before the payment due date and on it.
-- The second is skipped once the first was read. Mail goes out with the booking agency's DMC's own mail settings.
CREATE TABLE IF NOT EXISTS booking_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('payment_due_soon','payment_due')),
  due_date date NOT NULL,
  send_on date NOT NULL,
  state text NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled','sent','skipped')),
  skip_reason text,
  read_token text NOT NULL UNIQUE,
  read_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, kind)
);
CREATE INDEX IF NOT EXISTS booking_reminders_due_idx ON booking_reminders (state, send_on);
