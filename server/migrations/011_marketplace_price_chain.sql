-- Marketplace stage 2: independent platform and buyer-DMC percentages.
-- Re-runnable; do not modify stage-1 migration.
ALTER TABLE marketplace_distribution_rules
  ADD COLUMN IF NOT EXISTS platform_margin_percent numeric NOT NULL DEFAULT 0;
ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS marketplace_markup_percent numeric NOT NULL DEFAULT 0;
ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS platform_fee_percent numeric NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'distribution_platform_margin_range') THEN
    ALTER TABLE marketplace_distribution_rules ADD CONSTRAINT distribution_platform_margin_range
      CHECK (platform_margin_percent BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agencies_marketplace_markup_range') THEN
    ALTER TABLE agencies ADD CONSTRAINT agencies_marketplace_markup_range
      CHECK (marketplace_markup_percent BETWEEN 0 AND 100 AND (type = 'master' OR marketplace_markup_percent = 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agencies_platform_fee_range') THEN
    ALTER TABLE agencies ADD CONSTRAINT agencies_platform_fee_range
      CHECK (platform_fee_percent BETWEEN 0 AND 100 AND (type = 'master' OR platform_fee_percent = 0));
  END IF;
END $$;

-- Returns the highest-specificity active allow rule. A deny rule is evaluated separately
-- by effective_agency_sales and continues to override all allows.
CREATE OR REPLACE FUNCTION marketplace_applicable_margin(
  p_seller uuid, p_buyer uuid, p_hotel uuid
) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT r.platform_margin_percent
    FROM marketplace_distribution_rules r
   WHERE r.active AND r.effect = 'allow'
     AND r.seller_agency_id = p_seller
     AND (r.buyer_agency_id IS NULL OR r.buyer_agency_id = p_buyer)
     AND (r.hotel_id IS NULL OR r.hotel_id = p_hotel)
   ORDER BY CASE
      WHEN r.hotel_id IS NOT NULL AND r.buyer_agency_id IS NOT NULL THEN 3
      WHEN r.hotel_id IS NOT NULL THEN 2
      WHEN r.buyer_agency_id IS NOT NULL THEN 1
      ELSE 0 END DESC
   LIMIT 1
$$;
