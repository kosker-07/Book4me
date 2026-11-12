-- Marketplace stage 1: bulk distribution rules.
-- The platform operator opens (allow) or closes (deny) a seller DMC's inventory to the sub-agencies of
-- another DMC, for all of the seller's hotels or for one hotel, and for one buyer DMC or for every other DMC.
--
-- Precedence, evaluated per (sub-agency, rate plan) by effective_agency_sales(agency):
--   1. An agency_hotel_sales row decides on its own: active = open with its markup, inactive = closed.
--   2. Otherwise the plan is open when an active allow rule matches and no active deny rule matches.
--      Deny always beats allow.
-- A rule never applies inside one DMC (seller = buyer's parent); that stays with publications.
-- Rule-based sales carry no markup yet (the fee chain is marketplace stage 2).
-- Re-runnable: every statement is idempotent.

CREATE TABLE IF NOT EXISTS marketplace_distribution_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_agency_id uuid NOT NULL REFERENCES agencies(id),
  buyer_agency_id uuid REFERENCES agencies(id),
  hotel_id uuid REFERENCES hotels(id) ON DELETE CASCADE,
  effect text NOT NULL CHECK (effect IN ('allow', 'deny')),
  active boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (buyer_agency_id IS NULL OR buyer_agency_id <> seller_agency_id)
);

-- One rule per scope (seller, buyer-or-everyone, hotel-or-all); its effect and active flag are edited in place.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_distribution_rules_scope_idx ON marketplace_distribution_rules
  (seller_agency_id,
   coalesce(buyer_agency_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(hotel_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS marketplace_distribution_rules_active_idx ON marketplace_distribution_rules
  (seller_agency_id, effect) WHERE active;

CREATE OR REPLACE FUNCTION enforce_distribution_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agencies WHERE id = NEW.seller_agency_id AND type = 'master') THEN
    RAISE EXCEPTION 'distribution rule seller must be a master agency' USING ERRCODE = '23514';
  END IF;
  IF NEW.buyer_agency_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM agencies WHERE id = NEW.buyer_agency_id AND type = 'master') THEN
    RAISE EXCEPTION 'distribution rule buyer must be a master agency' USING ERRCODE = '23514';
  END IF;
  IF NEW.hotel_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM hotels WHERE id = NEW.hotel_id AND owner_agency_id = NEW.seller_agency_id) THEN
    RAISE EXCEPTION 'distribution rule hotel must belong to the seller' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS marketplace_distribution_rules_check ON marketplace_distribution_rules;
CREATE TRIGGER marketplace_distribution_rules_check BEFORE INSERT OR UPDATE OF seller_agency_id, buyer_agency_id, hotel_id
  ON marketplace_distribution_rules FOR EACH ROW EXECUTE FUNCTION enforce_distribution_rule();

-- SQL twin of validateRatePlanTerms (server/validation.ts). A publication is refused without valid terms;
-- a rule opens plans without that step, so effective_agency_sales applies the same requirement itself.
CREATE OR REPLACE FUNCTION b4b_json_int_between(v jsonb, lo integer, hi integer) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN v IS NULL OR jsonb_typeof(v) <> 'number' THEN false
              ELSE (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric) AND (v #>> '{}')::numeric BETWEEN lo AND hi END
$$;

CREATE OR REPLACE FUNCTION rate_plan_terms_valid(c jsonb, p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(
    jsonb_typeof(c) = 'object' AND jsonb_typeof(p) = 'object'
    AND b4b_json_int_between(c -> 'freeUntilDays', 0, 365)
    AND c ->> 'penaltyType' IN ('nights', 'percent') AND jsonb_typeof(c -> 'penaltyType') = 'string'
    AND b4b_json_int_between(c -> 'penaltyValue', 1, CASE WHEN c ->> 'penaltyType' = 'nights' THEN 30 ELSE 100 END)
    AND c ->> 'noShowPenaltyType' IN ('nights', 'percent') AND jsonb_typeof(c -> 'noShowPenaltyType') = 'string'
    AND b4b_json_int_between(c -> 'noShowPenaltyValue', 1, CASE WHEN c ->> 'noShowPenaltyType' = 'nights' THEN 30 ELSE 100 END)
    AND b4b_json_int_between(p -> 'dueDaysBeforeCheckIn', 0, 365),
    false)
$$;

-- What one sub-agency may be sold: its own publication rows as they are, plus rule-based rows.
-- A function rather than a view on purpose: a view would pin the column types of agency_hotel_sales and
-- make earlier migrations (005 alters markup_value) impossible to re-run by hand.
CREATE OR REPLACE FUNCTION effective_agency_sales(p_agency_id uuid)
RETURNS TABLE (agency_id uuid, hotel_id uuid, rate_plan_id uuid, markup_type text, markup_value numeric, active boolean, source text)
LANGUAGE sql STABLE AS $$
  SELECT s.agency_id, s.hotel_id, s.rate_plan_id, s.markup_type::text, s.markup_value::numeric, s.active, 'publication'::text
    FROM agency_hotel_sales s
   WHERE s.agency_id = p_agency_id
  UNION ALL
  SELECT b.id, h.id, rp.id, 'percent'::text, 0::numeric, true, 'distribution_rule'::text
    FROM agencies b
    JOIN agencies bp ON bp.id = b.parent_agency_id AND bp.type = 'master' AND bp.active
    JOIN hotels h ON h.owner_agency_id <> bp.id
    JOIN rooms r ON r.hotel_id = h.id
    JOIN rate_plans rp ON rp.room_id = r.id
   WHERE b.id = p_agency_id AND b.type = 'sub'
     AND rate_plan_terms_valid(rp.cancellation_policy, rp.payment_terms)
     AND NOT EXISTS (SELECT 1 FROM agency_hotel_sales x WHERE x.agency_id = b.id AND x.rate_plan_id = rp.id)
     AND EXISTS (SELECT 1 FROM marketplace_distribution_rules a
                  WHERE a.active AND a.effect = 'allow' AND a.seller_agency_id = h.owner_agency_id
                    AND (a.buyer_agency_id IS NULL OR a.buyer_agency_id = bp.id)
                    AND (a.hotel_id IS NULL OR a.hotel_id = h.id))
     AND NOT EXISTS (SELECT 1 FROM marketplace_distribution_rules d
                      WHERE d.active AND d.effect = 'deny' AND d.seller_agency_id = h.owner_agency_id
                        AND (d.buyer_agency_id IS NULL OR d.buyer_agency_id = bp.id)
                        AND (d.hotel_id IS NULL OR d.hotel_id = h.id))
$$;
