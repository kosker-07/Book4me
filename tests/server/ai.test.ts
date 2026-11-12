import test from "node:test";
import assert from "node:assert/strict";
import { classifyImportance } from "../../server/ai/notify";
import type { NotifyRule } from "../../server/ai/notify";
import { MAX_STEPS, runAgent } from "../../server/ai/runtime";
import type { Agent, AgentTool, RunStore } from "../../server/ai/runtime";
import { AnthropicClient } from "../../server/ai/model";
import type { ModelClient, ModelReply } from "../../server/ai/model";

test("notify: defaults, and the owner's rule wins (including never)", () => {
  assert.equal(classifyImportance({ kind: "alert" }, []), "instant");
  assert.equal(classifyImportance({ kind: "email", function: "security" }, []), "instant");
  assert.equal(classifyImportance({ kind: "approval", risk: "high" }, []), "instant");
  assert.equal(classifyImportance({ kind: "approval", risk: "medium" }, []), "digest");
  assert.equal(classifyImportance({ kind: "email", function: "accounting" }, []), "digest");
  assert.equal(classifyImportance({ kind: "email", function: "support" }, []), "count_only");
  const rules: NotifyRule[] = [
    { match_kind: "from_domain", match_value: "Spam.com", channel: "never", active: true },
    { match_kind: "amount_over", match_value: "5000", channel: "instant", active: true },
    { match_kind: "function", match_value: "security", channel: "never", active: false }
  ];
  assert.equal(classifyImportance({ kind: "alert", fromDomain: "spam.com" }, rules), "never");
  assert.equal(classifyImportance({ kind: "approval", risk: "medium", amountEur: 5000.01 }, rules), "instant");
  assert.equal(classifyImportance({ kind: "approval", risk: "medium", amountEur: 5000 }, rules), "digest");
  assert.equal(classifyImportance({ kind: "email", function: "security" }, rules), "instant", "inactive rule is ignored");
});

function memory(usedToday = 0) {
  const log: string[] = [], queued: any[] = []; let status = "", tokens = 0;
  const store: RunStore = {
    tokensUsedToday: async () => usedToday + tokens, startRun: async () => "run-1",
    addUsage: async (_r, i, o) => { tokens += i + o; }, finishRun: async (_r, s) => { status = s; },
    audit: async e => { log.push(e.action); }, enqueueApproval: async a => { queued.push(a); return "ap-" + queued.length; }
  };
  return { store, log, queued, get status() { return status; }, get tokens() { return tokens; } };
}
const scripted = (replies: ModelReply[]): ModelClient & { calls: any[] } => {
  const calls: any[] = [];
  return { calls, complete: async req => { calls.push(JSON.parse(JSON.stringify(req))); const r = replies.shift(); if (!r) throw new Error("no reply"); return r; } };
};
const say = (text: string, t = 10): ModelReply => ({ content: [{ type: "text", text }], stopReason: "end_turn", inputTokens: t, outputTokens: t });
const use = (name: string, input: any, t = 10): ModelReply => ({ content: [{ type: "tool_use", id: "tu_" + name, name, input }], stopReason: "tool_use", inputTokens: t, outputTokens: t });
const tool = (name: string, risk: AgentTool["risk"], ran: string[]): AgentTool => ({ name, description: name, input_schema: { type: "object" }, risk, run: async (_i, ctx) => { ran.push(name + ":" + ctx.tenantId); return "ok"; } });
const agent = (tools: AgentTool[], over: Partial<Agent> = {}): Agent => ({ id: "ops", model: "m", system: "s", enabled: true, dailyTokenBudget: 1000, tools, ...over });

test("runtime: a low-risk tool runs with the run's tenant; a risky tool is queued and never executed", async () => {
  const ran: string[] = [], m = memory();
  const model = scripted([use("lookup", { q: 1 }), use("refund", { amount: 250 }), say("done")]);
  const refund = { ...tool("refund", "high", ran), amountEur: (i: any) => i.amount, summarize: (i: any) => `Refund ${i.amount} EUR` };
  const r = await runAgent({ store: m.store, model }, agent([tool("lookup", "low", ran), refund]), { tenantId: "dmc-a", trigger: "test", prompt: "go" });
  assert.equal(r.status, "done"); assert.equal(r.text, "done");
  assert.deepEqual(ran, ["lookup:dmc-a"]);
  assert.deepEqual(r.approvals, ["ap-1"]);
  assert.equal(m.queued[0].risk, "high"); assert.equal(m.queued[0].amountEur, 250); assert.equal(m.queued[0].summary, "Refund 250 EUR"); assert.equal(m.queued[0].tenantId, "dmc-a");
  assert.match(model.calls[2].messages.at(-1).content[0].content, /QUEUED_FOR_HUMAN_APPROVAL/);
  assert.deepEqual(m.log, ["tool.ran", "tool.queued_for_approval", "run.done"]);
  assert.equal(m.tokens, 60);
});

test("runtime: disabled agent, spent budget, budget crossed mid-run, unknown tool, tool failure, step limit, provider error", async () => {
  const ran: string[] = [];
  const off = await runAgent({ store: memory().store, model: scripted([]) }, agent([], { enabled: false }), { tenantId: null, trigger: "t", prompt: "p" });
  assert.equal(off.status, "disabled"); assert.equal(off.runId, null);

  const spent = memory(1000), noCall = scripted([]);
  assert.equal((await runAgent({ store: spent.store, model: noCall }, agent([]), { tenantId: null, trigger: "t", prompt: "p" })).status, "budget_exceeded");
  assert.equal(noCall.calls.length, 0, "the model is not called once the budget is spent");

  const mid = memory(900);
  assert.equal((await runAgent({ store: mid.store, model: scripted([use("lookup", {}, 50), say("never")]) }, agent([tool("lookup", "low", ran)]), { tenantId: null, trigger: "t", prompt: "p" })).status, "budget_exceeded");

  const unk = memory(), unkModel = scripted([use("nope", {}), say("ok")]);
  assert.equal((await runAgent({ store: unk.store, model: unkModel }, agent([]), { tenantId: null, trigger: "t", prompt: "p" })).status, "done");
  assert.equal(unkModel.calls[1].messages.at(-1).content[0].is_error, true);

  const boom = { ...tool("boom", "low", ran), run: async () => { throw new Error("secret detail"); } };
  const failModel = scripted([use("boom", {}), say("ok")]);
  await runAgent({ store: memory().store, model: failModel }, agent([boom]), { tenantId: null, trigger: "t", prompt: "p" });
  assert.equal(failModel.calls[1].messages.at(-1).content[0].content, "TOOL_FAILED", "error text is not fed back to the model");

  const loop = memory();
  const many = Array.from({ length: MAX_STEPS + 2 }, () => use("lookup", {}, 1));
  assert.equal((await runAgent({ store: loop.store, model: scripted(many) }, agent([tool("lookup", "low", ran)]), { tenantId: null, trigger: "t", prompt: "p" })).status, "step_limit");

  const down = memory();
  assert.equal((await runAgent({ store: down.store, model: scripted([]) }, agent([]), { tenantId: null, trigger: "t", prompt: "p" })).status, "failed");
  assert.equal(down.status, "failed");
});

test("anthropic client: request shape, usage mapping, provider error, missing key", async () => {
  let seen: any;
  const ok = (async (url: any, init: any) => { seen = { url, init }; return new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 4 } }), { status: 200 }); }) as typeof fetch;
  const reply = await new AnthropicClient("k", ok).complete({ model: "m", system: "s", messages: [{ role: "user", content: "x" }], tools: [], maxTokens: 5 });
  assert.equal(seen.url, "https://api.anthropic.com/v1/messages");
  assert.equal(seen.init.headers["x-api-key"], "k");
  assert.equal("tools" in JSON.parse(seen.init.body), false);
  assert.deepEqual([reply.inputTokens, reply.outputTokens, reply.stopReason], [3, 4, "end_turn"]);
  const bad = (async () => new Response("{}", { status: 529 })) as typeof fetch;
  await assert.rejects(new AnthropicClient("k", bad).complete({ model: "m", system: "s", messages: [], tools: [], maxTokens: 5 }), /AI_PROVIDER_529/);
  assert.throws(() => new AnthropicClient(""), /AI_NOT_CONFIGURED/);
});
