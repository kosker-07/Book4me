// PostgreSQL implementation of the runtime's store.
import type { RunStore } from "./runtime";
import { recordOwnerNotification } from "./owner-notify";
export interface Db { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }

export const pgRunStore = (db: Db): RunStore => ({
  async tokensUsedToday(agentId) {
    return Number((await db.query("SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS n FROM ai_runs WHERE agent_id = $1 AND started_at >= date_trunc('day', now())", [agentId])).rows[0]?.n ?? 0);
  },
  async startRun(agentId, tenantId, trigger) {
    return (await db.query("INSERT INTO ai_runs(agent_id, tenant_id, trigger) VALUES ($1,$2,$3) RETURNING id", [agentId, tenantId, trigger])).rows[0].id;
  },
  async addUsage(runId, input, output) {
    await db.query("UPDATE ai_runs SET input_tokens = input_tokens + $2, output_tokens = output_tokens + $3 WHERE id = $1", [runId, input, output]);
  },
  async finishRun(runId, status, error) {
    await db.query("UPDATE ai_runs SET status = $2, error = $3, finished_at = now() WHERE id = $1", [runId, status, error ?? null]);
  },
  async audit(e) {
    await db.query("INSERT INTO ai_audit(run_id, agent_id, tenant_id, action, detail) VALUES ($1,$2,$3,$4,$5)", [e.runId, e.agentId, e.tenantId, e.action, JSON.stringify(e.detail)]);
  },
  async enqueueApproval(a) {
    const id = (await db.query(
      "INSERT INTO approval_queue(run_id, agent_id, tenant_id, action, payload, summary, risk, amount_eur) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [a.runId, a.agentId, a.tenantId, a.action, JSON.stringify(a.payload), a.summary.slice(0, 500), a.risk, a.amountEur ?? null])).rows[0].id;
    if (a.tenantId === null) await recordOwnerNotification(db,"approval:"+id,
      {kind:"approval",risk:a.risk,amountEur:a.amountEur},a.summary);
    return id;
  }
});
