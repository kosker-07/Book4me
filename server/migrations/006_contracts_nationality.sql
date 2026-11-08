-- 006: nationality-based hotel contracts, market groups, per-guest nationality, immutable price snapshots and
-- proformas. Backward compatible and re-runnable.
--
-- Single sources of truth are NOT duplicated:
--   * inventory_daily keeps the nightly net price and allotment (allotment stays per rate plan);
--   * rate_plans.currency keeps the price currency — a contract's currency must equal it (enforced below);
--   * agency_hotel_sales keeps the publication and the agency markup.
-- A contract groups rate plans. Every rate plan belongs to exactly one contract; existing and new rate plans
-- without an explicit contract join their hotel's default "general market" contract (no nationality rules =
-- eligible for every nationality), so behaviour is unchanged until a hotel configures rules.

-- 1. Contracts -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hotel_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,40}$'),
  name text NOT NULL,
  currency char(3) NOT NULL REFERENCES currencies(code),
  valid_from date,                 -- first night covered (NULL = open)
  valid_to date,                   -- last night covered, inclusive (NULL = open)
  seller_legal_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'inactive')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, code),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS hotel_contracts_one_default_per_currency
  ON hotel_contracts(hotel_id, currency) WHERE is_default;

CREATE TABLE IF NOT EXISTS contract_rate_plans (
  rate_plan_id uuid PRIMARY KEY REFERENCES rate_plans(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES hotel_contracts(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS contract_rate_plans_contract_idx ON contract_rate_plans(contract_id);

-- A rate plan may only join a contract of its own hotel with the same currency.
CREATE OR REPLACE FUNCTION contract_rate_plans_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE c record; rp record;
BEGIN
  SELECT hotel_id, currency INTO c FROM hotel_contracts WHERE id = NEW.contract_id;
  SELECT r.hotel_id, p.currency INTO rp FROM rate_plans p JOIN rooms r ON r.id = p.room_id WHERE p.id = NEW.rate_plan_id;
  IF c.hotel_id IS DISTINCT FROM rp.hotel_id THEN
    RAISE EXCEPTION 'rate plan % belongs to another hotel than contract %', NEW.rate_plan_id, NEW.contract_id USING ERRCODE = '23514';
  END IF;
  IF c.currency IS DISTINCT FROM rp.currency THEN
    RAISE EXCEPTION 'contract currency % differs from rate plan currency %', c.currency, rp.currency USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contract_rate_plans_check ON contract_rate_plans;
CREATE TRIGGER contract_rate_plans_check BEFORE INSERT OR UPDATE ON contract_rate_plans
  FOR EACH ROW EXECUTE FUNCTION contract_rate_plans_check();

CREATE OR REPLACE FUNCTION rate_plans_currency_matches_contract() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency AND EXISTS (
       SELECT 1 FROM contract_rate_plans crp JOIN hotel_contracts c ON c.id = crp.contract_id
        WHERE crp.rate_plan_id = NEW.id AND c.currency <> NEW.currency) THEN
    RAISE EXCEPTION 'rate plan currency must equal its contract currency' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rate_plans_currency_matches_contract ON rate_plans;
CREATE TRIGGER rate_plans_currency_matches_contract BEFORE UPDATE OF currency ON rate_plans
  FOR EACH ROW EXECUTE FUNCTION rate_plans_currency_matches_contract();

CREATE OR REPLACE FUNCTION hotel_contracts_currency_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.currency IS DISTINCT FROM OLD.currency OR NEW.hotel_id IS DISTINCT FROM OLD.hotel_id)
     AND EXISTS (SELECT 1 FROM contract_rate_plans WHERE contract_id = NEW.id) THEN
    RAISE EXCEPTION 'currency and hotel of a contract with rate plans cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hotel_contracts_currency_locked ON hotel_contracts;
CREATE TRIGGER hotel_contracts_currency_locked BEFORE UPDATE ON hotel_contracts
  FOR EACH ROW EXECUTE FUNCTION hotel_contracts_currency_locked();

-- Default "general market" contract per hotel and currency; attaches a rate plan that has no contract yet.
CREATE OR REPLACE FUNCTION attach_rate_plan_to_default_contract(p_rate_plan uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_hotel uuid; v_currency char(3); v_contract uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM contract_rate_plans WHERE rate_plan_id = p_rate_plan) THEN RETURN; END IF;
  SELECT r.hotel_id, p.currency INTO v_hotel, v_currency FROM rate_plans p JOIN rooms r ON r.id = p.room_id WHERE p.id = p_rate_plan;
  IF v_hotel IS NULL OR NOT EXISTS (SELECT 1 FROM currencies WHERE code = v_currency) THEN
    RAISE NOTICE 'rate plan % not attached: currency % is not in the allow-list', p_rate_plan, v_currency;
    RETURN;
  END IF;
  SELECT id INTO v_contract FROM hotel_contracts WHERE hotel_id = v_hotel AND currency = v_currency AND is_default;
  IF v_contract IS NULL THEN
    INSERT INTO hotel_contracts(hotel_id, code, name, currency, is_default)
    VALUES (v_hotel, 'GENERAL-' || v_currency, 'General market (' || v_currency || ')', v_currency, true)
    RETURNING id INTO v_contract;
  END IF;
  INSERT INTO contract_rate_plans(rate_plan_id, contract_id) VALUES (p_rate_plan, v_contract);
END $$;

CREATE OR REPLACE FUNCTION rate_plans_attach_default_contract() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM attach_rate_plan_to_default_contract(NEW.id);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS rate_plans_attach_default_contract ON rate_plans;
CREATE TRIGGER rate_plans_attach_default_contract AFTER INSERT ON rate_plans
  FOR EACH ROW EXECUTE FUNCTION rate_plans_attach_default_contract();

-- Backfill existing rate plans.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.id FROM rate_plans p WHERE NOT EXISTS (SELECT 1 FROM contract_rate_plans c WHERE c.rate_plan_id = p.id) LOOP
    PERFORM attach_rate_plan_to_default_contract(r.id);
  END LOOP;
END $$;

-- 2. Market groups and nationality rules -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{1,40}$'),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS market_group_members (
  group_id uuid NOT NULL REFERENCES market_groups(id) ON DELETE CASCADE,
  country_code char(2) NOT NULL REFERENCES countries(code),
  PRIMARY KEY (group_id, country_code)
);

CREATE TABLE IF NOT EXISTS contract_nationality_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES hotel_contracts(id) ON DELETE CASCADE,
  rule_type text NOT NULL CHECK (rule_type IN ('include', 'exclude')),
  country_code char(2) REFERENCES countries(code),
  market_group_id uuid REFERENCES market_groups(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(country_code, market_group_id) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS contract_nationality_rules_unique
  ON contract_nationality_rules(contract_id, rule_type, coalesce(country_code, ''), coalesce(market_group_id::text, ''));

-- 3. Per-guest data (the lead guest stays in bookings.guest_* as before) ---------------------------
CREATE TABLE IF NOT EXISTS booking_guests (
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  guest_index smallint NOT NULL CHECK (guest_index >= 0),
  first_name text NOT NULL,
  last_name text NOT NULL,
  guest_type text NOT NULL CHECK (guest_type IN ('adult', 'child')),
  age smallint CHECK (age BETWEEN 0 AND 17),
  nationality char(2) NOT NULL REFERENCES countries(code),
  is_lead boolean NOT NULL DEFAULT false,
  PRIMARY KEY (booking_id, guest_index),
  CHECK ((guest_type = 'child') = (age IS NOT NULL))
);

-- 4. Immutable booking price snapshot ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_price_snapshots (
  booking_id uuid PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES hotel_contracts(id),
  contract_code text NOT NULL,
  contract_name text NOT NULL,
  seller_legal_name text NOT NULL,
  rate_plan_id uuid NOT NULL REFERENCES rate_plans(id),
  nationalities char(2)[] NOT NULL,
  eligibility jsonb NOT NULL,          -- per nationality: matched rule id/type/target
  contract_currency char(3) NOT NULL REFERENCES currencies(code),
  contract_minor_units smallint NOT NULL,
  total numeric NOT NULL CHECK (total >= 0),
  eur_per_unit numeric(18,8) NOT NULL CHECK (eur_per_unit > 0),
  fx_rate_history_id bigint REFERENCES fx_rate_history(id),   -- NULL for EUR
  fx_source text,
  fx_valid_at timestamptz,
  payment_currency char(3) NOT NULL REFERENCES currencies(code),
  payment_minor_units smallint NOT NULL,
  payment_eur_per_unit numeric(18,8) NOT NULL CHECK (payment_eur_per_unit > 0),
  payment_fx_rate_history_id bigint REFERENCES fx_rate_history(id),
  payment_amount numeric NOT NULL CHECK (payment_amount >= 0),
  rounding text NOT NULL DEFAULT 'half-up',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Proformas (not tax invoices) ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proforma_counters (
  year integer PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS proformas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  number text NOT NULL UNIQUE,
  year integer NOT NULL,
  seq integer NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  supersedes uuid REFERENCES proformas(id),
  reason text NOT NULL DEFAULT '',
  booking_status text NOT NULL,
  payment_currency char(3) NOT NULL,
  payment_amount numeric NOT NULL,
  contract_currency char(3) NOT NULL,
  contract_amount numeric NOT NULL,
  seller_legal_name text NOT NULL,
  issued_by uuid NOT NULL REFERENCES users(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  pdf bytea NOT NULL,
  sha256 text NOT NULL,
  UNIQUE (booking_id, version),
  UNIQUE (year, seq)
);

-- Snapshots, guests and proformas never change after insert.
CREATE OR REPLACE FUNCTION refuse_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable (% refused)', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS booking_price_snapshots_immutable ON booking_price_snapshots;
CREATE TRIGGER booking_price_snapshots_immutable BEFORE UPDATE ON booking_price_snapshots
  FOR EACH ROW EXECUTE FUNCTION refuse_modification();
DROP TRIGGER IF EXISTS booking_guests_immutable ON booking_guests;
CREATE TRIGGER booking_guests_immutable BEFORE UPDATE ON booking_guests
  FOR EACH ROW EXECUTE FUNCTION refuse_modification();
DROP TRIGGER IF EXISTS proformas_immutable ON proformas;
CREATE TRIGGER proformas_immutable BEFORE UPDATE OR DELETE ON proformas
  FOR EACH ROW EXECUTE FUNCTION refuse_modification();
