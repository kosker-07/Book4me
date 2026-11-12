-- Excel contract imports: a preview is stored first; confirming writes hotels, rooms, rate plans, contracts and
-- inventory in one transaction. The same DMC cannot confirm the same file (sha256) twice.
CREATE TABLE IF NOT EXISTS contract_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_agency_id uuid NOT NULL REFERENCES agencies(id),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  file_name text NOT NULL DEFAULT '',
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','confirmed')),
  preview jsonb NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS contract_imports_confirmed_once
  ON contract_imports(owner_agency_id, file_sha256) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS contract_imports_owner_idx ON contract_imports(owner_agency_id, created_at DESC);
