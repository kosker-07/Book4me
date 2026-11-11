-- Marketplace stage 2: frozen per-night accounting breakdown.
-- Existing booking_nights remain readable; nullable columns mark legacy/manual publications.
ALTER TABLE booking_nights
  ADD COLUMN IF NOT EXISTS marketplace_platform_margin_percent numeric(6,3),
  ADD COLUMN IF NOT EXISTS marketplace_platform_margin numeric(14,3),
  ADD COLUMN IF NOT EXISTS marketplace_buyer_cost numeric(14,3),
  ADD COLUMN IF NOT EXISTS marketplace_buyer_markup_percent numeric(6,3),
  ADD COLUMN IF NOT EXISTS marketplace_buyer_markup numeric(14,3);

-- Booked amounts must never be edited after insertion.
CREATE OR REPLACE FUNCTION b4b_prevent_marketplace_price_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.net_price, OLD.sell_price, OLD.markup_type, OLD.markup_value,
      OLD.marketplace_platform_margin_percent, OLD.marketplace_platform_margin,
      OLD.marketplace_buyer_cost, OLD.marketplace_buyer_markup_percent,
      OLD.marketplace_buyer_markup)
     IS DISTINCT FROM
     (NEW.net_price, NEW.sell_price, NEW.markup_type, NEW.markup_value,
      NEW.marketplace_platform_margin_percent, NEW.marketplace_platform_margin,
      NEW.marketplace_buyer_cost, NEW.marketplace_buyer_markup_percent,
      NEW.marketplace_buyer_markup) THEN
    RAISE EXCEPTION 'booked marketplace price is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS b4b_marketplace_price_immutable ON booking_nights;
CREATE TRIGGER b4b_marketplace_price_immutable
  BEFORE UPDATE ON booking_nights FOR EACH ROW
  EXECUTE FUNCTION b4b_prevent_marketplace_price_change();
