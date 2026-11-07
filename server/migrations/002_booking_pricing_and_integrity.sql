-- BED4BOOK v1 migration 002
-- Additive schema changes only. Never edit 001_initial.sql.
BEGIN;

-- Agency-wide markup policy: inventory_daily.price remains the net supplier cost.
ALTER TABLE agencies
  ADD COLUMN markup_type text NOT NULL DEFAULT 'percent'
    CHECK (markup_type IN ('percent','fixed')),
  ADD COLUMN markup_value numeric(14,4) NOT NULL DEFAULT 0
    CHECK (markup_value >= 0);

-- Explicit type columns allow PostgreSQL to enforce tenant-role relationships
-- with composite foreign keys (rather than relying only on application code).
ALTER TABLE agencies ADD CONSTRAINT agencies_id_type_unique UNIQUE (id, type);

ALTER TABLE users
  ADD CONSTRAINT users_agency_type_matches_role
  CHECK (
    (role = 'system_admin' AND agency_id IS NULL) OR
    (role IN ('master_agency','back_office') AND agency_id IS NOT NULL) OR
    (role = 'sub_agency' AND agency_id IS NOT NULL)
  );

-- Enforce agency role/type compatibility with triggers because role values
-- are application roles while agencies.type is the business tenant type.
CREATE OR REPLACE FUNCTION bed4book_check_user_agency_type()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE agency_type text;
BEGIN
  IF NEW.role = 'system_admin' THEN
    IF NEW.agency_id IS NOT NULL THEN
      RAISE EXCEPTION 'system_admin_must_not_have_agency';
    END IF;
    RETURN NEW;
  END IF;
  SELECT type INTO agency_type FROM agencies WHERE id = NEW.agency_id;
  IF agency_type IS NULL THEN
    RAISE EXCEPTION 'agency_required';
  END IF;
  IF NEW.role IN ('master_agency','back_office') AND agency_type <> 'master' THEN
    RAISE EXCEPTION 'role_requires_master_agency';
  END IF;
  IF NEW.role = 'sub_agency' AND agency_type <> 'sub' THEN
    RAISE EXCEPTION 'role_requires_sub_agency';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_agency_type_guard
BEFORE INSERT OR UPDATE OF role, agency_id ON users
FOR EACH ROW EXECUTE FUNCTION bed4book_check_user_agency_type();

-- Hotel ownership belongs to a master agency only.
CREATE OR REPLACE FUNCTION bed4book_check_hotel_owner_type()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE agency_type text;
BEGIN
  SELECT type INTO agency_type FROM agencies WHERE id = NEW.owner_agency_id;
  IF agency_type IS DISTINCT FROM 'master' THEN
    RAISE EXCEPTION 'hotel_owner_must_be_master_agency';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hotels_owner_type_guard
BEFORE INSERT OR UPDATE OF owner_agency_id ON hotels
FOR EACH ROW EXECUTE FUNCTION bed4book_check_hotel_owner_type();

-- Sales publication must target a sub-agency and the selected rate plan
-- must belong to the same hotel referenced by the publication.
CREATE OR REPLACE FUNCTION bed4book_check_sales_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE agency_type text; actual_hotel_id uuid;
BEGIN
  SELECT type INTO agency_type FROM agencies WHERE id = NEW.agency_id;
  IF agency_type IS DISTINCT FROM 'sub' THEN
    RAISE EXCEPTION 'sales_target_must_be_sub_agency';
  END IF;
  SELECT r.hotel_id INTO actual_hotel_id
    FROM rate_plans rp JOIN rooms r ON r.id = rp.room_id
    WHERE rp.id = NEW.rate_plan_id;
  IF actual_hotel_id IS NULL OR actual_hotel_id <> NEW.hotel_id THEN
    RAISE EXCEPTION 'sales_hotel_rate_plan_mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agency_hotel_sales_scope_guard
BEFORE INSERT OR UPDATE OF agency_id, hotel_id, rate_plan_id ON agency_hotel_sales
FOR EACH ROW EXECUTE FUNCTION bed4book_check_sales_scope();

-- A booking is always owned by a sub-agency.
CREATE OR REPLACE FUNCTION bed4book_check_booking_agency_type()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE agency_type text;
BEGIN
  SELECT type INTO agency_type FROM agencies WHERE id = NEW.agency_id;
  IF agency_type IS DISTINCT FROM 'sub' THEN
    RAISE EXCEPTION 'booking_agency_must_be_sub_agency';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_agency_type_guard
BEFORE INSERT OR UPDATE OF agency_id ON bookings
FOR EACH ROW EXECUTE FUNCTION bed4book_check_booking_agency_type();

-- Required guest data as explicitly approved by the project owner.
ALTER TABLE bookings
  ALTER COLUMN guest_email SET NOT NULL,
  ADD COLUMN guest_adult_count integer NOT NULL DEFAULT 1 CHECK (guest_adult_count >= 1),
  ADD COLUMN guest_child_count integer NOT NULL DEFAULT 0 CHECK (guest_child_count >= 0),
  ADD COLUMN guest_child_ages jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(guest_child_ages) = 'array'),
  ADD COLUMN guest_phone text NOT NULL DEFAULT '',
  ADD COLUMN guest_nationality text NOT NULL DEFAULT '',
  ADD COLUMN operational_note text NOT NULL DEFAULT '',
  ADD COLUMN created_by uuid REFERENCES users(id),
  ADD COLUMN updated_by uuid REFERENCES users(id),
  ADD CONSTRAINT bookings_child_age_count_matches
    CHECK (jsonb_array_length(guest_child_ages) = guest_child_count);

-- Snapshot each booked night. These values are immutable booking-time prices,
-- independent of later inventory or agency markup changes.
CREATE TABLE booking_nights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  stay_date date NOT NULL,
  room_count integer NOT NULL CHECK (room_count > 0),
  net_unit_price numeric(14,2) NOT NULL CHECK (net_unit_price >= 0),
  sell_unit_price numeric(14,2) NOT NULL CHECK (sell_unit_price >= 0),
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, stay_date)
);
CREATE INDEX booking_nights_date_idx ON booking_nights(stay_date);
CREATE INDEX booking_nights_booking_idx ON booking_nights(booking_id, stay_date);

-- Case-insensitive login uniqueness, including legacy mixed-case addresses.
CREATE UNIQUE INDEX users_email_lower_unique_idx ON users (lower(email));

-- Explicit audit actor fields on booking records; history/audit tables remain
-- the append-only event trail and are not replaced by these convenience fields.
CREATE INDEX bookings_hotel_created_idx ON bookings(hotel_id, created_at DESC);
CREATE INDEX bookings_agency_status_created_idx ON bookings(agency_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION bed4book_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_updated_at_trigger
BEFORE UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION bed4book_set_updated_at();
CREATE TRIGGER hotels_updated_at_trigger
BEFORE UPDATE ON hotels
FOR EACH ROW EXECUTE FUNCTION bed4book_set_updated_at();

COMMENT ON COLUMN inventory_daily.price IS
  'Net price before agency markup; sell price is calculated from agencies.markup_type and agencies.markup_value.';
COMMENT ON COLUMN agency_hotel_sales.sell_price IS
  'Legacy field retained for migration compatibility; pricing model A calculates sell price from net inventory price and agency markup.';

COMMIT;
