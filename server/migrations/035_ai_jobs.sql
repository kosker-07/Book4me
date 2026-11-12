-- Platform inbound AI job queue. Tenant-owned mail is never queued.
CREATE TABLE IF NOT EXISTS ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL REFERENCES ai_agents(id),
  kind text NOT NULL,
  ref_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  run_id uuid REFERENCES ai_runs(id),
  UNIQUE (kind, ref_id)
);
CREATE INDEX IF NOT EXISTS ai_jobs_pending_idx ON ai_jobs (created_at,id) WHERE state='queued';

CREATE INDEX IF NOT EXISTS ai_jobs_expired_lease_idx ON ai_jobs(lease_expires_at) WHERE state='running';
