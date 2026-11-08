-- Existing bookings predate per-room occupancy. NULL denotes legacy unknown distribution.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS room_occupancies JSONB;

DO $ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_room_occupancies_array' AND conrelid = 'bookings'::regclass) THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_room_occupancies_array
      CHECK (room_occupancies IS NULL OR jsonb_typeof(room_occupancies) = 'array');
  END IF;
END $;

COMMENT ON COLUMN bookings.room_occupancies IS
  'NULL for legacy bookings; new bookings store the signed per-room guest distribution.';
