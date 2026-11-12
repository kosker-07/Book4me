-- 004: audit log extension (remaining-fixes item A7). Backward compatible, re-runnable.
-- Adds who/what/where context and before/after values, and makes audit_logs append-only at database level.

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS target_agency_id uuid REFERENCES agencies(id),
  ADD COLUMN IF NOT EXISTS before jsonb,
  ADD COLUMN IF NOT EXISTS after jsonb,
  ADD COLUMN IF NOT EXISTS ip text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS request_id text;

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_request_idx ON audit_logs(request_id) WHERE request_id IS NOT NULL;

-- Append-only: rows can be inserted, never updated or deleted (TRUNCATE by an operator is not affected).
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% refused)', TG_OP USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
