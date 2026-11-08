-- Existing bookings predate per-room occupancy. NULL denotes legacy unknown distribution.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS room_occupancies JSONB;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_room_occupancies_array;
ALTER TABLE bookings ADD CONSTRAINT bookings_room_occupancies_array
  CHECK (room_occupancies IS NULL OR jsonb_typeof(room_occupancies) = 'array');

COMMENT ON COLUMN bookings.room_occupancies IS
  'NULL for legacy bookings; new bookings store the signed per-room guest distribution.';
