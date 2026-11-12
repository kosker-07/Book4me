-- AI foundation: agents, runs with token accounting, append-only audit, approval queue, owner notification rules.
-- tenant_id NULL = platform agents (BED4BOOK's own business). A DMC's data is never visible to another tenant's run.

CREATE TABLE IF NOT EXISTS ai_agents (
  id text PRIMARY KEY,
  name text NOT NULL,
  function_name text NOT NULL,
  model text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  daily_token_budget bigint NOT NULL DEFAULT 200000 CHECK (daily_token_budget >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL REFERENCES ai_agents(id),
  tenant_id uuid REFERENCES agencies(id),
  trigger text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed','budget_exceeded','step_limit')),
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_runs_agent_day_idx ON ai_runs (agent_id, started_at DESC);

CREATE TABLE IF NOT EXISTS ai_audit (
  id bigserial PRIMARY KEY,
  run_id uuid REFERENCES ai_runs(id),
  agent_id text NOT NULL,
  tenant_id uuid,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_audit_run_idx ON ai_audit (run_id);

CREATE OR REPLACE FUNCTION ai_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ai_audit is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ai_audit_no_change ON ai_audit;
CREATE TRIGGER ai_audit_no_change BEFORE UPDATE OR DELETE ON ai_audit FOR EACH ROW EXECUTE FUNCTION ai_audit_immutable();

CREATE TABLE IF NOT EXISTS approval_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES ai_runs(id),
  agent_id text NOT NULL,
  tenant_id uuid REFERENCES agencies(id),
  action text NOT NULL,
  payload jsonb NOT NULL,
  summary text NOT NULL,
  risk text NOT NULL CHECK (risk IN ('medium','high')),
  amount_eur numeric(14,2),
  required_approvals int NOT NULL DEFAULT 1 CHECK (required_approvals >= 1),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','expired')),
  result text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '72 hours',
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS approval_queue_state_idx ON approval_queue (state, created_at DESC);

CREATE TABLE IF NOT EXISTS approval_votes (
  approval_id uuid NOT NULL REFERENCES approval_queue(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  decision text NOT NULL CHECK (decision IN ('approve','reject')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (approval_id, user_id)
);

CREATE TABLE IF NOT EXISTS notify_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position int NOT NULL DEFAULT 0,
  match_kind text NOT NULL CHECK (match_kind IN ('function','from_domain','risk','amount_over')),
  match_value text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('instant','digest','count_only','never')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
