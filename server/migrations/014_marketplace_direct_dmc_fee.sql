-- Stage 2: record operator service fee on direct master-DMC marketplace sales.
-- The fee is accounting-only and must not alter the buyer's sell price.
ALTER TABLE booking_nights
  ADD COLUMN IF NOT EXISTS marketplace_platform_fee_percent numeric(6,3),
  ADD COLUMN IF NOT EXISTS marketplace_platform_fee numeric(14,3);

CREATE OR REPLACE FUNCTION b4b_prevent_marketplace_price_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.net_price, OLD.sell_price, OLD.markup_type, OLD.markup_value,
      OLD.marketplace_platform_margin_percent, OLD.marketplace_platform_margin,
      OLD.marketplace_buyer_cost, OLD.marketplace_buyer_markup_percent,
      OLD.marketplace_buyer_markup, OLD.marketplace_platform_fee_percent,
      OLD.marketplace_platform_fee)
     IS DISTINCT FROM
     (NEW.net_price, NEW.sell_price, NEW.markup_type, NEW.markup_value,
      NEW.marketplace_platform_margin_percent, NEW.marketplace_platform_margin,
      NEW.marketplace_buyer_cost, NEW.marketplace_buyer_markup_percent,
      NEW.marketplace_buyer_markup, NEW.marketplace_platform_fee_percent,
      NEW.marketplace_platform_fee) THEN
    RAISE EXCEPTION 'booked marketplace price is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
