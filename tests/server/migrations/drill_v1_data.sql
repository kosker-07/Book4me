-- v1-shaped rows (after 002+003) so the backup/restore drill covers every critical table.
INSERT INTO agencies(id,name,type) VALUES ('77777777-7777-7777-7777-777777777777','Drill Sub','sub') ON CONFLICT DO NOTHING;
INSERT INTO users(id,email,password_hash,role,agency_id) VALUES ('88888888-8888-8888-8888-888888888888','drill@legacy.test','x','sub_agency','77777777-7777-7777-7777-777777777777') ON CONFLICT DO NOTHING;
INSERT INTO agency_hotel_sales(agency_id,hotel_id,rate_plan_id,markup_type,markup_value)
  VALUES ('77777777-7777-7777-7777-777777777777','33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555','fixed',12.5) ON CONFLICT DO NOTHING;
INSERT INTO fx_rates(currency,eur_per_unit,source) VALUES ('USD',0.91,'drill') ON CONFLICT DO NOTHING;
INSERT INTO bookings(id,booking_no,agency_id,hotel_id,rate_plan_id,check_in,check_out,room_count,total,quoted_total,currency,status,
                     guest_first_name,guest_last_name,guest_email,guest_phone,guest_nationality,adults,children,child_ages,operation_note)
  VALUES ('99999999-9999-9999-9999-999999999999','B4B-'||lpad(nextval('booking_no_seq')::text,8,'0'),'77777777-7777-7777-7777-777777777777',
          '33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555','2030-06-01','2030-06-03',1,225,225,'EUR','approved',
          'Drill','Guest','drill@example.com','+90 555 000 00 00','TR',2,1,'{4}','Drill note') ON CONFLICT DO NOTHING;
INSERT INTO booking_nights(booking_id,stay_date,inventory_id,rooms,net_price,markup_type,markup_value,sell_price,currency)
  SELECT '99999999-9999-9999-9999-999999999999', stay_date, id, 1, price, 'fixed', 12.5, price + 12.5, 'EUR'
    FROM inventory_daily WHERE rate_plan_id='55555555-5555-5555-5555-555555555555' ON CONFLICT DO NOTHING;
INSERT INTO booking_status_history(booking_id,from_status,to_status,actor_id,note)
  SELECT '99999999-9999-9999-9999-999999999999', NULL, 'pending', '88888888-8888-8888-8888-888888888888', 'drill'
   WHERE NOT EXISTS (SELECT 1 FROM booking_status_history WHERE booking_id='99999999-9999-9999-9999-999999999999');
INSERT INTO audit_logs(actor_id,agency_id,action,entity_type,entity_id)
  SELECT '88888888-8888-8888-8888-888888888888','77777777-7777-7777-7777-777777777777','booking.created','booking','99999999-9999-9999-9999-999999999999'
   WHERE NOT EXISTS (SELECT 1 FROM audit_logs WHERE entity_id='99999999-9999-9999-9999-999999999999');
