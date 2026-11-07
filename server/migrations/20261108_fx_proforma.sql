-- BED4BOOK FX and proforma extension; apply explicitly before enabling endpoints.
CREATE TABLE IF NOT EXISTS fx_settings (
 id integer PRIMARY KEY DEFAULT 1 CHECK (id=1),
 base_currency char(3) NOT NULL DEFAULT 'USD',
 mode text NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto','manual','hybrid')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO fx_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS fx_rates (
 currency char(3) PRIMARY KEY,
 rate numeric(24,10) NOT NULL CHECK(rate>0),
 source text NOT NULL CHECK(source IN ('auto','manual')),
 provider text,
 fetched_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid
);
CREATE TABLE IF NOT EXISTS fx_rate_history (
 id bigserial PRIMARY KEY,
 currency char(3) NOT NULL,
 old_rate numeric(24,10),
 new_rate numeric(24,10) NOT NULL CHECK(new_rate>0),
 source text NOT NULL,
 provider text,
 actor_id uuid,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS booking_proformas (
 id uuid PRIMARY KEY,
 booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id),
 proforma_no text NOT NULL UNIQUE,
 currency char(3) NOT NULL,
 amount numeric(18,2) NOT NULL CHECK(amount>=0),
 original_currency char(3) NOT NULL,
 original_amount numeric(18,2) NOT NULL,
 fx_rate numeric(24,10) NOT NULL CHECK(fx_rate>0),
 fx_source text NOT NULL,
 fx_fixed_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','partial','paid')),
 paid_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK(paid_amount>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 paid_at timestamptz,
 updated_by uuid,
 CHECK(paid_amount<=amount)
);
CREATE SEQUENCE IF NOT EXISTS proforma_no_seq;
CREATE INDEX IF NOT EXISTS fx_history_currency_time ON fx_rate_history(currency,changed_at DESC);
