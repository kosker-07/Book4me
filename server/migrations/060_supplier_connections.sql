-- Integration readiness: registry of supplier connections (hotel APIs, channel managers, ...). No external calls yet;
-- the system is built so a connector can later report status and errors here. Managed by system_admin only.
CREATE TABLE IF NOT EXISTS supplier_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('hotel_api','channel_manager','flight','transfer','payment','other')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'disabled' CHECK (status IN ('disabled','active','error')),
  last_error text,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
