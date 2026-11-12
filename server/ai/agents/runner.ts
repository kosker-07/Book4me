import type { Db } from "../store";
import { pgRunStore } from "../store";
import { runAgent } from "../runtime";
import type { RunResult } from "../runtime";
import type { ModelClient } from "../model";
import { AnthropicClient } from "../model";
import { makePlatformAgent, PLATFORM_AGENTS } from "./registry";
import type { PlatformAgentId } from "./registry";
import { toolsForAgent } from "./tools-map";

/** Configuration always comes from PostgreSQL, not user-supplied agent settings. */
export async function loadAgent(db: Db, id: PlatformAgentId) {
  if (!PLATFORM_AGENTS.some(agent => agent.id === id)) throw new Error("UNKNOWN_AGENT");
  const row = (await db.query(
    "SELECT id, enabled, model, daily_token_budget FROM ai_agents WHERE id=$1", [id]
  )).rows[0];
  if (!row) throw new Error("UNKNOWN_AGENT");
  return makePlatformAgent(id, {
    enabled: row.enabled === true,
    model: String(row.model),
    dailyTokenBudget: Number(row.daily_token_budget),
  }, toolsForAgent(id, db));
}

/** Missing API credentials are recorded as failed runs; they never crash the HTTP server. */
export async function runPlatformAgent(
  db: Db,
  id: PlatformAgentId,
  input: { trigger: string; prompt: string },
  options: { apiKey?: string; model?: ModelClient } = {},
): Promise<RunResult> {
  const agent = await loadAgent(db, id);
  if (!agent.enabled) return { runId: null, status: "disabled", text: "", approvals: [] };
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
  const model: ModelClient = options.model ?? (apiKey
    ? new AnthropicClient(apiKey)
    : { complete: async () => { throw new Error("AI_NOT_CONFIGURED"); } });
  return runAgent({ store: pgRunStore(db), model }, agent, {
    tenantId: null, trigger: input.trigger, prompt: input.prompt,
  });
}
