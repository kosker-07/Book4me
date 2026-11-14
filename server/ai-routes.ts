// AI Center API — operator-facing audit, approvals, runs and agent management.
// P0-F: integrates existing AI registry/runtime/approvals/audit/notification foundations.
// No autonomous actions: medium/high-risk tools are queued for human approval only.
import { Router } from "express";
import { pool, withTransaction } from "./db";
import { authenticate, roles, httpError, uuidParam, isPlatformWide } from "./http";
import { h } from "./admin-routes";
import { pgRunStore } from "./ai/store";
import { runAgent } from "./ai/runtime";
import { registerPlatformApprovalHandlers } from "./ai/tools/handlers";
import { AnthropicClient } from "./ai/model";
import type { Agent } from "./ai/runtime";

registerPlatformApprovalHandlers();

export const aiRouter = Router();
const aiAccess = [authenticate, roles("system_admin", "back_office", "master_agency")] as const;
const store = pgRunStore({ query: (sql: string, params?: any[]) => pool.query(sql, params) });
let anthropic: AnthropicClient | null = null;
function getAnthropic(): AnthropicClient {
  if (!anthropic) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("AI_NOT_CONFIGURED");
    anthropic = new AnthropicClient(key);
  }
  return anthropic;
}

// Minimal in-memory agent registry for Phase 1 (bounded, auditable, tenant-scoped).
const agents: Agent[] = [
  {
    id: "ops-assistant",
    model: "claude-3-5-sonnet-20241022",
    system: "You are a BED4BOOK platform operations assistant. You may only run low-risk tools directly. Medium/high-risk actions require human approval. Never reveal supplier identity, confidential net prices, margins or platform fees.",
    enabled: true,
    dailyTokenBudget: 50000,
    tools: []
  }
];

aiRouter.get("/api/ai/agents", ...aiAccess, h(async (_req, res) => {
  res.json({ items: agents.map(a => ({ id: a.id, model: a.model, enabled: a.enabled, dailyTokenBudget: a.dailyTokenBudget })) });
}));

aiRouter.get("/api/ai/runs", ...aiAccess, h(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
  const result = await pool.query(
    "SELECT id, agent_id, tenant_id, trigger, status, input_tokens, output_tokens, started_at, finished_at, error FROM ai_runs ORDER BY started_at DESC LIMIT $1",
    [limit]
  );
  res.json({ items: result.rows });
}));

aiRouter.get("/api/ai/runs/:id", ...aiAccess, h(async (req, res) => {
  const id = uuidParam(req);
  const run = (await pool.query("SELECT * FROM ai_runs WHERE id = $1", [id])).rows[0];
  if (!run) throw httpError(404, "NOT_FOUND");
  const audit = await pool.query(
    "SELECT action, detail, created_at FROM ai_audit WHERE run_id = $1 ORDER BY created_at", [id]
  );
  res.json({ run, audit: audit.rows });
}));

aiRouter.get("/api/ai/approvals", ...aiAccess, h(async (req, res) => {
  const result = await pool.query(
    "SELECT id, run_id, agent_id, tenant_id, action, summary, risk, amount_eur, state, required_approvals, created_at, expires_at FROM approval_queue WHERE state = 'pending' ORDER BY created_at"
  );
  res.json({ items: result.rows });
}));

aiRouter.post("/api/ai/approvals/:id/decide", ...aiAccess, h(async (req, res) => {
  const id = uuidParam(req);
  const { decision } = req.body || {};
  if (decision !== "approve" && decision !== "reject") throw httpError(400, "INVALID_DECISION");
  const { decideApproval } = await import("./ai/approvals");
  const result = await withTransaction(async client => {
    return decideApproval(client as any, id, req.auth!.sub, decision as "approve" | "reject");
  });
  res.json(result ?? { state: "not_found" });
}));

aiRouter.post("/api/ai/agents/:id/run", ...aiAccess, h(async (req, res) => {
  const agentId = uuidParam(req);
  const { prompt, tenantId } = req.body || {};
  if (typeof prompt !== "string" || !prompt.trim()) throw httpError(400, "PROMPT_REQUIRED");
  const agent = agents.find(a => a.id === agentId);
  if (!agent || !agent.enabled) throw httpError(404, "AGENT_NOT_FOUND");
  const result = await runAgent({ store, model: getAnthropic() }, agent, {
    tenantId: isPlatformWide(req.auth!.role) ? (tenantId ?? null) : req.auth!.agencyId,
    trigger: "operator",
    prompt: prompt.trim()
  });
  res.json(result);
}));

aiRouter.get("/api/ai/audit", ...aiAccess, h(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
  const result = await pool.query(
    "SELECT id, run_id, agent_id, tenant_id, action, detail, created_at FROM ai_audit ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
  res.json({ items: result.rows });
}));
