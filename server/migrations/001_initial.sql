CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('master','sub')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid REFERENCES agencies(id),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('system_admin','master_agency','sub_agency','back_office')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role='system_admin' AND agency_id IS NULL) OR (role<>'system_admin' AND agency_id IS NOT NULL))
);

CREATE TABLE hotels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_agency_id uuid NOT NULL REFERENCES agencies(id),
  name text NOT NULL,
  location text NOT NULL,
  category text,
  description text NOT NULL DEFAULT '',
  amenities jsonb NOT NULL DEFAULT '[]'::jsonb,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  operational_notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hotels_owner_status_idx ON hotels(owner_agency_id,status);

CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  max_adults integer NOT NULL DEFAULT 2 CHECK (max_adults > 0),
  max_children integer NOT NULL DEFAULT 0 CHECK (max_children >= 0),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE rate_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  board_name text NOT NULL,
  currency char(3) NOT NULL,
  cancellation_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  sales_conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE inventory_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_plan_id uuid NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
  stay_date date NOT NULL,
  price numeric(14,2) NOT NULL CHECK (price >= 0),
  allotment integer NOT NULL CHECK (allotment >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0 AND reserved <= allotment),
  UNIQUE(rate_plan_id,stay_date)
);
CREATE INDEX inventory_date_idx ON inventory_daily(stay_date,rate_plan_id);

CREATE TABLE agency_hotel_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  rate_plan_id uuid NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
  sell_price numeric(14,2) NOT NULL CHECK (sell_price >= 0),
  sell_currency char(3) NOT NULL,
  agency_conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  UNIQUE(agency_id,rate_plan_id)
);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_no text NOT NULL UNIQUE,
  agency_id uuid NOT NULL REFERENCES agencies(id),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  rate_plan_id uuid NOT NULL REFERENCES rate_plans(id),
  check_in date NOT NULL,
  check_out date NOT NULL,
  room_count integer NOT NULL CHECK (room_count > 0),
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  currency char(3) NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled')),
  guest_first_name text NOT NULL,
  guest_last_name text NOT NULL,
  guest_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (check_out > check_in)
);
CREATE INDEX bookings_agency_idx ON bookings(agency_id,created_at DESC);
CREATE INDEX bookings_status_idx ON bookings(status,created_at DESC);

CREATE TABLE booking_status_history (
  id bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  agency_id uuid REFERENCES agencies(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_agency_idx ON audit_logs(agency_id,created_at DESC);

CREATE TABLE idempotency_keys (
  agency_id uuid NOT NULL REFERENCES agencies(id),
  key text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(agency_id,key)
);
