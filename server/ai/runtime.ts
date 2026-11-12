// Agent runtime. Our own layer owns the rules: daily token budget, tenant scope, audit of every step, and the
// approval gate. Low-risk tools run directly; medium/high-risk tools are never executed by the agent, they are
// queued for a human and the agent is told so. The model loop itself sits behind ModelClient.
import type { Block, Message, ModelClient, ToolSpec } from "./model";

export type Risk = "low" | "medium" | "high";
export interface ToolContext { tenantId: string | null; runId: string; agentId: string }
export interface AgentTool extends ToolSpec { risk: Risk; validate?: (input: any) => void; summarize?: (input: any) => string; amountEur?: (input: any) => number | undefined; run: (input: any, ctx: ToolContext) => Promise<string> }
export interface Agent { id: string; model: string; system: string; enabled: boolean; dailyTokenBudget: number; tools: AgentTool[] }
export interface RunStore {
  tokensUsedToday(agentId: string): Promise<number>;
  startRun(agentId: string, tenantId: string | null, trigger: string): Promise<string>;
  addUsage(runId: string, input: number, output: number): Promise<void>;
  finishRun(runId: string, status: RunStatus, error?: string): Promise<void>;
  audit(entry: { runId: string; agentId: string; tenantId: string | null; action: string; detail: Record<string, unknown> }): Promise<void>;
  enqueueApproval(a: { runId: string; agentId: string; tenantId: string | null; action: string; payload: unknown; summary: string; risk: "medium" | "high"; amountEur?: number }): Promise<string>;
}
export type RunStatus = "done" | "failed" | "budget_exceeded" | "step_limit";
export interface RunResult { runId: string | null; status: RunStatus | "disabled"; text: string; approvals: string[] }

export const MAX_STEPS = 8;

export async function runAgent(deps: { store: RunStore; model: ModelClient }, agent: Agent, input: { tenantId: string | null; trigger: string; prompt: string }): Promise<RunResult> {
  if (!agent.enabled) return { runId: null, status: "disabled", text: "", approvals: [] };
  const { store, model } = deps;
  let used = await store.tokensUsedToday(agent.id);
  const runId = await store.startRun(agent.id, input.tenantId, input.trigger);
  const ctx: ToolContext = { tenantId: input.tenantId, runId, agentId: agent.id };
  const log = (action: string, detail: Record<string, unknown>) => store.audit({ runId, agentId: agent.id, tenantId: input.tenantId, action, detail });
  const approvals: string[] = [];
  const end = async (status: RunStatus, text: string, error?: string): Promise<RunResult> => { await store.finishRun(runId, status, error); await log("run." + status, error ? { error } : {}); return { runId, status, text, approvals }; };
  if (used >= agent.dailyTokenBudget) return end("budget_exceeded", "");

  const specs: ToolSpec[] = agent.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  const messages: Message[] = [{ role: "user", content: input.prompt }];
  let text = "";
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const reply = await model.complete({ model: agent.model, system: agent.system, messages, tools: specs, maxTokens: 2000 });
      await store.addUsage(runId, reply.inputTokens, reply.outputTokens);
      used += reply.inputTokens + reply.outputTokens;
      text = reply.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map(b => b.text).join("\n");
      const calls = reply.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
      if (!calls.length) return end("done", text);
      messages.push({ role: "assistant", content: reply.content });
      const results: Block[] = [];
      for (const call of calls) {
        const tool = agent.tools.find(t => t.name === call.name);
        if (!tool) { await log("tool.unknown", { name: call.name }); results.push({ type: "tool_result", tool_use_id: call.id, content: "UNKNOWN_TOOL", is_error: true }); continue; }
        try { tool.validate?.(call.input); } catch (e) {
          await log("tool.failed", { name: tool.name, error: String((e as Error).message).slice(0, 300) });
          results.push({ type: "tool_result", tool_use_id: call.id, content: "TOOL_FAILED", is_error: true });
          continue;
        }
        if (tool.risk !== "low") {
          const amountEur = tool.amountEur?.(call.input);
          const id = await store.enqueueApproval({ runId, agentId: agent.id, tenantId: input.tenantId, action: tool.name, payload: call.input, summary: tool.summarize?.(call.input) ?? tool.name, risk: tool.risk, ...(amountEur === undefined ? {} : { amountEur }) });
          approvals.push(id);
          await log("tool.queued_for_approval", { name: tool.name, approvalId: id, risk: tool.risk });
          results.push({ type: "tool_result", tool_use_id: call.id, content: "QUEUED_FOR_HUMAN_APPROVAL: not executed. Do not retry; report that it awaits approval." });
          continue;
        }
        try {
          const out = await tool.run(call.input, ctx);
          await log("tool.ran", { name: tool.name });
          results.push({ type: "tool_result", tool_use_id: call.id, content: out.slice(0, 8000) });
        } catch (e) {
          await log("tool.failed", { name: tool.name, error: String((e as Error).message).slice(0, 300) });
          results.push({ type: "tool_result", tool_use_id: call.id, content: "TOOL_FAILED", is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
      if (used >= agent.dailyTokenBudget) return end("budget_exceeded", text);
    }
    return end("step_limit", text);
  } catch (e) {
    return end("failed", text, String((e as Error).message).slice(0, 300));
  }
}
