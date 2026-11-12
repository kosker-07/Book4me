-- Assertions after applying 002+ on top of legacy_001_data.sql. Any failure raises and aborts psql.
DO $$
BEGIN
  IF (SELECT count(*) FROM bookings WHERE booking_no = 'B4B-LEGACY' AND status = 'pending' AND total = 480) <> 1 THEN
    RAISE EXCEPTION 'legacy booking changed or lost'; END IF;
  IF EXISTS (SELECT 1 FROM users WHERE role = 'back_office' AND agency_id IS NOT NULL) THEN
    RAISE EXCEPTION 'back_office user still bound to an agency'; END IF;
  IF (SELECT count(*) FROM users) <> 3 THEN RAISE EXCEPTION 'users lost'; END IF;
  IF (SELECT markup_type || ':' || markup_value FROM agency_hotel_sales) <> 'percent:0.00' THEN
    RAISE EXCEPTION 'unexpected markup defaults'; END IF;
  IF (SELECT sum(reserved) FROM inventory_daily) <> 4 THEN RAISE EXCEPTION 'inventory changed by migration'; END IF;
  IF (SELECT count(*) FROM idempotency_keys WHERE key = 'legacy-key-1' AND request_hash IS NULL
        AND response->>'id' = '66666666-6666-6666-6666-666666666666') <> 1 THEN
    RAISE EXCEPTION 'legacy idempotency key changed or lost'; END IF;
  BEGIN
    INSERT INTO users(email,password_hash,role,agency_id) VALUES ('bad@x','x','master_agency','22222222-2222-2222-2222-222222222222');
    RAISE EXCEPTION 'trigger did not reject master_agency under a sub agency';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO users(email,password_hash,role,agency_id) VALUES ('bo2@x','x','back_office','11111111-1111-1111-1111-111111111111');
    RAISE EXCEPTION 'back_office with agency was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- 005/006: the legacy rate plan joined its hotel's default general-market contract; money text unchanged
  IF (SELECT c.code FROM contract_rate_plans crp JOIN hotel_contracts c ON c.id = crp.contract_id
       WHERE crp.rate_plan_id = '55555555-5555-5555-5555-555555555555') IS DISTINCT FROM 'GENERAL-EUR' THEN
    RAISE EXCEPTION 'legacy rate plan not attached to the default contract'; END IF;
  IF (SELECT total::text FROM bookings WHERE booking_no = 'B4B-LEGACY') <> '480.00' THEN
    RAISE EXCEPTION 'legacy booking total text changed'; END IF;
  IF (SELECT count(*) FROM contract_nationality_rules) <> 0 THEN RAISE EXCEPTION 'unexpected nationality rules'; END IF;
  RAISE NOTICE 'legacy upgrade checks passed';
END $$;
