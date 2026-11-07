-- Data shaped like a database that only has 001_initial.sql applied (pre-002 rows).
INSERT INTO agencies(id,name,type) VALUES ('11111111-1111-1111-1111-111111111111','Legacy Master','master'),('22222222-2222-2222-2222-222222222222','Legacy Sub','sub');
INSERT INTO users(email,password_hash,role,agency_id) VALUES
  ('bo@legacy.test','x','back_office','11111111-1111-1111-1111-111111111111'),
  ('a@legacy.test','x','sub_agency','22222222-2222-2222-2222-222222222222'),
  ('admin@legacy.test','x','system_admin',NULL);
INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','Legacy Hotel','Antalya','active');
INSERT INTO rooms(id,hotel_id,name) VALUES ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','DBL');
INSERT INTO rate_plans(id,room_id,board_name,currency) VALUES ('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','AI','EUR');
INSERT INTO inventory_daily(rate_plan_id,stay_date,price,allotment,reserved) VALUES
  ('55555555-5555-5555-5555-555555555555','2030-06-01',100,5,2),('55555555-5555-5555-5555-555555555555','2030-06-02',100,5,2);
INSERT INTO agency_hotel_sales(agency_id,hotel_id,rate_plan_id,sell_price,sell_currency) VALUES
  ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555',120,'EUR');
INSERT INTO bookings(id,booking_no,agency_id,hotel_id,rate_plan_id,check_in,check_out,room_count,total,currency,status,guest_first_name,guest_last_name)
  VALUES ('66666666-6666-6666-6666-666666666666','B4B-LEGACY','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333',
          '55555555-5555-5555-5555-555555555555','2030-06-01','2030-06-03',2,480,'EUR','pending','Old','Booking');
-- Idempotency key written by the pre-002 API (no request_hash column yet).
INSERT INTO idempotency_keys(agency_id,key,response) VALUES
  ('22222222-2222-2222-2222-222222222222','legacy-key-1','{"id":"66666666-6666-6666-6666-666666666666","bookingNo":"B4B-LEGACY","status":"pending"}');
