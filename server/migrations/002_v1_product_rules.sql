-- 002: BED4BOOK v1 product rules.
-- Backward compatible with 001_initial.sql (which is NOT modified). Safe to re-run.
-- Approved decisions implemented here:
--   * Back Office is platform-wide (not bound to a master agency tenant).
--   * Price = inventory_daily.price (net per room per night) + agency markup (percent or fixed).
--   * Nightly price snapshot per booking.
--   * Mandatory guest fields stored on the booking.
BEGIN;

-- 1. Back Office is platform-wide ----------------------------------------------------------
-- Drop the role/agency CHECK from 001 (auto-named) first, then detach existing back_office users
-- from their master agency, then add the v1 rule.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'users'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%agency_id%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

UPDATE users SET agency_id = NULL WHERE role = 'back_office' AND agency_id IS NOT NULL;

ALTER TABLE users ADD CONSTRAINT users_role_agency_scope CHECK (
  (role IN ('system_admin', 'back_office') AND agency_id IS NULL) OR
  (role IN ('master_agency', 'sub_agency') AND agency_id IS NOT NULL)
);

-- master_agency users must belong to a master agency, sub_agency users to a sub agency.
CREATE OR REPLACE FUNCTION users_role_matches_agency_type() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE agency_type text;
BEGIN
  IF NEW.agency_id IS NULL THEN RETURN NEW; END IF;
  SELECT type INTO agency_type FROM agencies WHERE id = NEW.agency_id;
  IF (NEW.role = 'master_agency' AND agency_type IS DISTINCT FROM 'master')
     OR (NEW.role = 'sub_agency' AND agency_type IS DISTINCT FROM 'sub') THEN
    RAISE EXCEPTION 'role % does not match agency type %', NEW.role, agency_type
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_role_matches_agency_type ON users;
CREATE TRIGGER users_role_matches_agency_type
  BEFORE INSERT OR UPDATE OF role, agency_id ON users
  FOR EACH ROW EXECUTE FUNCTION users_role_matches_agency_type();

-- 2. Pricing: net nightly price + agency markup ---------------------------------------------
ALTER TABLE agency_hotel_sales
  ADD COLUMN IF NOT EXISTS markup_type text NOT NULL DEFAULT 'percent'
    CHECK (markup_type IN ('percent', 'fixed')),
  ADD COLUMN IF NOT EXISTS markup_value numeric(14,2) NOT NULL DEFAULT 0
    CHECK (markup_value >= 0);

-- sell_price / sell_currency are no longer used for pricing (they were a flat override).
ALTER TABLE agency_hotel_sales ALTER COLUMN sell_price DROP NOT NULL;
ALTER TABLE agency_hotel_sales ALTER COLUMN sell_currency DROP NOT NULL;
COMMENT ON COLUMN agency_hotel_sales.sell_price IS
  'Deprecated since 002; not used for pricing. Price = inventory_daily.price + markup.';
COMMENT ON COLUMN agency_hotel_sales.markup_value IS
  'percent: percentage of the net nightly price; fixed: amount per room per night in the rate plan currency.';

-- Exchange rates for comparing offers. An offer whose currency has no rate is not evaluated.
CREATE TABLE IF NOT EXISTS fx_rates (
  currency char(3) PRIMARY KEY,
  eur_per_unit numeric(18,8) NOT NULL CHECK (eur_per_unit > 0),
  source text NOT NULL,
  valid_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Mandatory guest fields (nullable for bookings created before 002) ----------------------
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS adults integer CHECK (adults >= 1),
  ADD COLUMN IF NOT EXISTS children integer CHECK (children >= 0),
  ADD COLUMN IF NOT EXISTS child_ages integer[],
  ADD COLUMN IF NOT EXISTS guest_phone text,
  ADD COLUMN IF NOT EXISTS guest_nationality char(2),
  ADD COLUMN IF NOT EXISTS operation_note text;

-- 4. Nightly price snapshot -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_nights (
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  stay_date date NOT NULL,
  inventory_id uuid NOT NULL REFERENCES inventory_daily(id),
  rooms integer NOT NULL CHECK (rooms > 0),
  net_price numeric(14,2) NOT NULL CHECK (net_price >= 0),
  markup_type text NOT NULL CHECK (markup_type IN ('percent', 'fixed')),
  markup_value numeric(14,2) NOT NULL CHECK (markup_value >= 0),
  sell_price numeric(14,2) NOT NULL CHECK (sell_price >= 0), -- per room per night
  currency char(3) NOT NULL,
  PRIMARY KEY (booking_id, stay_date)
);

-- 5. Collision-free booking numbers ---------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS booking_no_seq;

-- 6. Idempotency request fingerprint --------------------------------------------------------
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS request_hash text;

-- 7. Indexes used by the v1 queries ---------------------------------------------------------
CREATE INDEX IF NOT EXISTS bookings_hotel_idx ON bookings(hotel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agency_hotel_sales_agency_idx ON agency_hotel_sales(agency_id) WHERE active;
CREATE INDEX IF NOT EXISTS booking_status_history_booking_idx ON booking_status_history(booking_id);
CREATE INDEX IF NOT EXISTS booking_nights_inventory_idx ON booking_nights(inventory_id);

COMMIT;
