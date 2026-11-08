-- Existing bookings predate per-room occupancy. NULL denotes legacy unknown distribution.
ALTER TABLE bookings
  ADD COLUMN room_occupancies JSONB;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_room_occupancies_array
  CHECK (room_occupancies IS NULL OR jsonb_typeof(room_occupancies) = 'array');

COMMENT ON COLUMN bookings.room_occupancies IS
  'NULL for legacy bookings; new bookings store the signed per-room guest distribution.';
