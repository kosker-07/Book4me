-- BED4BOOK 004: additive, re-runnable Phase 1 contract and proforma foundations.
-- Never run against production without backup, migration runner and independent review.
BEGIN;
CREATE TABLE IF NOT EXISTS currencies (
 code char(3) PRIMARY KEY,
 minor_units smallint NOT NULL CHECK (minor_units BETWEEN 0 AND 3),
 active boolean NOT NULL DEFAULT true
);
INSERT INTO currencies(code,minor_units) VALUES
 ('USD',2),('EUR',2),('GBP',2),('AED',2),('TRY',2),('SAR',2),('QAR',2),('KWD',3),('BHD',3),('OMR',3),('EGP',2),('JOD',3),('MAD',2),('TND',3),('RUB',2),('KZT',2),('UZS',2),('CNY',2),('JPY',0),('INR',2),('CHF',2),('CAD',2),('AUD',2),('SGD',2),('PLN',2)
ON CONFLICT(code) DO NOTHING;

CREATE TABLE IF NOT EXISTS hotel_contracts (
 id uuid PRIMARY KEY,
 hotel_id uuid NOT NULL REFERENCES hotels(id),
 code text NOT NULL,
 name text NOT NULL,
 currency char(3) NOT NULL REFERENCES currencies(code),
 valid_from date,
 valid_to date,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','inactive')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(hotel_id,code),
 CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE TABLE IF NOT EXISTS contract_rate_plans (
 contract_id uuid NOT NULL REFERENCES hotel_contracts(id),
 rate_plan_id uuid NOT NULL UNIQUE REFERENCES rate_plans(id),
 PRIMARY KEY(contract_id,rate_plan_id)
);
CREATE OR REPLACE FUNCTION b4b_check_contract_rate_plan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contract_hotel uuid; contract_currency char(3); plan_hotel uuid; plan_currency char(3);
BEGIN
 SELECT hotel_id,currency INTO contract_hotel,contract_currency FROM hotel_contracts WHERE id=NEW.contract_id;
 SELECT r.hotel_id,rp.currency INTO plan_hotel,plan_currency FROM rate_plans rp JOIN rooms r ON r.id=rp.room_id WHERE rp.id=NEW.rate_plan_id;
 IF contract_hotel IS DISTINCT FROM plan_hotel OR contract_currency IS DISTINCT FROM plan_currency THEN
  RAISE EXCEPTION 'CONTRACT_RATE_PLAN_MISMATCH';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_b4b_contract_rate_plan ON contract_rate_plans;
CREATE TRIGGER trg_b4b_contract_rate_plan BEFORE INSERT OR UPDATE ON contract_rate_plans
 FOR EACH ROW EXECUTE FUNCTION b4b_check_contract_rate_plan();

CREATE TABLE IF NOT EXISTS market_groups (
 id uuid PRIMARY KEY,
 code text NOT NULL UNIQUE,
 name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS market_group_members (
 group_id uuid NOT NULL REFERENCES market_groups(id) ON DELETE CASCADE,
 nationality char(2) NOT NULL CHECK(nationality ~ '^[A-Z]{2}$'),
 PRIMARY KEY(group_id,nationality)
);
CREATE TABLE IF NOT EXISTS contract_nationality_rules (
 id uuid PRIMARY KEY,
 contract_id uuid NOT NULL REFERENCES hotel_contracts(id) ON DELETE CASCADE,
 rule_type text NOT NULL CHECK(rule_type IN ('include','exclude')),
 nationality char(2) CHECK(nationality ~ '^[A-Z]{2}$'),
 group_id uuid REFERENCES market_groups(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid REFERENCES users(id),
 CHECK((nationality IS NOT NULL)::integer + (group_id IS NOT NULL)::integer = 1)
);
CREATE INDEX IF NOT EXISTS b4b_rules_contract_idx ON contract_nationality_rules(contract_id);

CREATE TABLE IF NOT EXISTS fx_rate_versions (
 id uuid PRIMARY KEY,
 currency char(3) NOT NULL REFERENCES currencies(code),
 eur_per_unit numeric(24,12) NOT NULL CHECK(eur_per_unit > 0),
 source text NOT NULL,
 source_published_at timestamptz,
 fetched_at timestamptz NOT NULL DEFAULT now(),
 valid_from timestamptz NOT NULL DEFAULT now(),
 manual_override boolean NOT NULL DEFAULT false,
 created_by uuid REFERENCES users(id),
 UNIQUE(currency,valid_from)
);
CREATE INDEX IF NOT EXISTS b4b_fx_versions_idx ON fx_rate_versions(currency,valid_from DESC);

CREATE TABLE IF NOT EXISTS booking_guests (
 id uuid PRIMARY KEY,
 booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 guest_index integer NOT NULL CHECK(guest_index >= 0),
 first_name text NOT NULL,
 last_name text NOT NULL,
 guest_type text NOT NULL CHECK(guest_type IN ('adult','child')),
 age smallint CHECK(age BETWEEN 0 AND 17),
 nationality char(2) NOT NULL CHECK(nationality ~ '^[A-Z]{2}$'),
 UNIQUE(booking_id,guest_index)
);
CREATE TABLE IF NOT EXISTS booking_price_snapshots (
 booking_id uuid PRIMARY KEY REFERENCES bookings(id),
 contract_id uuid REFERENCES hotel_contracts(id),
 contract_code text,
 rate_plan_id uuid NOT NULL REFERENCES rate_plans(id),
 guest_eligibility jsonb NOT NULL,
 contract_currency char(3) NOT NULL,
 contract_total numeric(20,3) NOT NULL,
 markup_details jsonb NOT NULL,
 fx_details jsonb NOT NULL,
 payment_currency char(3) NOT NULL REFERENCES currencies(code),
 payment_total numeric(20,3) NOT NULL,
 rounding_rule text NOT NULL DEFAULT 'HALF_UP',
 quote_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION b4b_immutable_financial_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE_FINANCIAL_RECORD'; END $$;
DROP TRIGGER IF EXISTS trg_b4b_snapshot_immutable ON booking_price_snapshots;
CREATE TRIGGER trg_b4b_snapshot_immutable BEFORE UPDATE OR DELETE ON booking_price_snapshots
 FOR EACH ROW EXECUTE FUNCTION b4b_immutable_financial_record();

CREATE TABLE IF NOT EXISTS proforma_year_counters (
 year integer PRIMARY KEY,
 last_number bigint NOT NULL CHECK(last_number >= 0)
);
CREATE TABLE IF NOT EXISTS proformas (
 id uuid PRIMARY KEY,
 booking_id uuid NOT NULL REFERENCES bookings(id),
 year integer NOT NULL,
 sequence_number bigint NOT NULL,
 version integer NOT NULL CHECK(version > 0),
 previous_proforma_id uuid REFERENCES proformas(id),
 payment_currency char(3) NOT NULL REFERENCES currencies(code),
 payment_total numeric(20,3) NOT NULL,
 document_sha256 char(64) NOT NULL,
 issued_by uuid NOT NULL REFERENCES users(id),
 issued_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(year,sequence_number),
 UNIQUE(booking_id,version)
);
DROP TRIGGER IF EXISTS trg_b4b_proforma_immutable ON proformas;
CREATE TRIGGER trg_b4b_proforma_immutable BEFORE UPDATE OR DELETE ON proformas
 FOR EACH ROW EXECUTE FUNCTION b4b_immutable_financial_record();

-- Backfill one unrestricted contract per hotel and currency.
-- Uses deterministic UUIDs derived from hotel ID and currency; existing data is never modified.
INSERT INTO hotel_contracts(id,hotel_id,code,name,currency,status)
SELECT (
 substr(md5(h.id::text || ':' || rp.currency::text),1,8)||'-'||
 substr(md5(h.id::text || ':' || rp.currency::text),9,4)||'-'||
 substr(md5(h.id::text || ':' || rp.currency::text),13,4)||'-'||
 substr(md5(h.id::text || ':' || rp.currency::text),17,4)||'-'||
 substr(md5(h.id::text || ':' || rp.currency::text),21,12)
)::uuid, h.id, 'LEGACY-GENERAL-'||trim(rp.currency), 'Legacy general market ('||trim(rp.currency)||')',rp.currency,'active'
FROM hotels h JOIN rooms r ON r.hotel_id=h.id JOIN rate_plans rp ON rp.room_id=r.id
GROUP BY h.id,rp.currency
ON CONFLICT(hotel_id,code) DO NOTHING;
INSERT INTO contract_rate_plans(contract_id,rate_plan_id)
SELECT hc.id,rp.id FROM rate_plans rp JOIN rooms r ON r.id=rp.room_id
JOIN hotel_contracts hc ON hc.hotel_id=r.hotel_id AND hc.currency=rp.currency AND hc.code='LEGACY-GENERAL-'||trim(rp.currency)
ON CONFLICT(rate_plan_id) DO NOTHING;
COMMIT;
