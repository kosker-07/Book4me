-- Durable owner notification events and idempotent daily delivery.
CREATE TABLE IF NOT EXISTS owner_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK(kind IN ('email','approval','alert')),
  function_name text,
  risk text,
  amount_eur numeric(14,2),
  from_domain text,
  summary text NOT NULL,
  channel text NOT NULL CHECK(channel IN ('instant','digest','count_only','never')),
  instant_hour timestamptz,
  instant_slot integer CHECK(instant_slot BETWEEN 1 AND 10),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS owner_notifications_hour_slot ON owner_notifications(instant_hour,instant_slot)
  WHERE instant_slot IS NOT NULL;
CREATE INDEX IF NOT EXISTS owner_notifications_day_idx ON owner_notifications(created_at DESC);
CREATE TABLE IF NOT EXISTS owner_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid REFERENCES owner_notifications(id),
  delivery_kind text NOT NULL CHECK(delivery_kind IN ('instant','digest')),
  delivery_day date NOT NULL,
  outbox_id uuid REFERENCES email_outbox(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notification_id,delivery_kind,delivery_day)
);
CREATE UNIQUE INDEX IF NOT EXISTS owner_daily_digest_unique ON owner_notification_deliveries(delivery_day)
  WHERE delivery_kind='digest' AND notification_id IS NULL;
