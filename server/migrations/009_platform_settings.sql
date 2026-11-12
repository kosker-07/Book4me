CREATE TABLE IF NOT EXISTS platform_settings (id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),legal_name text,address text,tax_office text,tax_number text,phone text,email text,updated_at timestamptz,updated_by uuid);
INSERT INTO platform_settings(id) VALUES (1) ON CONFLICT(id) DO NOTHING;
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS seller_settings jsonb;
