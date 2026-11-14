-- Occupancy pricing, minimum stay and release per night.
--  * inventory_daily.occupancy_prices: total room price per occupancy key (sgl, dbl, dbl_exb, pax3, child_2_adl_1_chd_2_11_99,
--    ...). NULL = the rate plan has one room price (inventory_daily.price) for every allowed occupancy, as before.
--  * min_stay applies to the arrival night; release_days = days before arrival after which the night is closed.
--  * booking_nights gets one row per room when rooms are priced by occupancy (room_no); classic bookings keep one row
--    per night with rooms = N.
ALTER TABLE inventory_daily ADD COLUMN IF NOT EXISTS occupancy_prices jsonb;
ALTER TABLE inventory_daily ADD COLUMN IF NOT EXISTS min_stay smallint;
ALTER TABLE inventory_daily ADD COLUMN IF NOT EXISTS release_days smallint;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_daily_min_stay_check') THEN
    ALTER TABLE inventory_daily ADD CONSTRAINT inventory_daily_min_stay_check CHECK (min_stay IS NULL OR min_stay BETWEEN 1 AND 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_daily_release_days_check') THEN
    ALTER TABLE inventory_daily ADD CONSTRAINT inventory_daily_release_days_check CHECK (release_days IS NULL OR release_days BETWEEN 0 AND 365);
  END IF;
END $$;

ALTER TABLE booking_nights ADD COLUMN IF NOT EXISTS room_no smallint NOT NULL DEFAULT 1;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.booking_nights'::regclass AND c.contype = 'p' AND a.attname = 'room_no') THEN
    ALTER TABLE booking_nights DROP CONSTRAINT IF EXISTS booking_nights_pkey;
    ALTER TABLE booking_nights ADD CONSTRAINT booking_nights_pkey PRIMARY KEY (booking_id, stay_date, room_no);
  END IF;
END $$;
