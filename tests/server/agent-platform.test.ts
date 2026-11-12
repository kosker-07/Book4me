import test from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_AGENTS, TOOL_RISKS, makePlatformAgent } from "../../server/ai/agents/registry";
import { platformTools } from "../../server/ai/tools/platform";
import { runAgent } from "../../server/ai/runtime";
import type { ModelClient } from "../../server/ai/model";
import type { RunStore } from "../../server/ai/runtime";

const id = "11111111-1111-4111-8111-111111111111";
const ctx = { tenantId: null, agentId: "reservations", runId: id };

test("AG1: all eight platform agents exist and tool risks are declared", () => {
  assert.equal(PLATFORM_AGENTS.length, 8);
  assert.equal(new Set(PLATFORM_AGENTS.map(a => a.id)).size, 8);
  const tools = platformTools({ query: async () => ({ rows: [] }) });
  assert.deepEqual(new Set(tools.map(t => t.name)), new Set(Object.keys(TOOL_RISKS)));
  for (const t of tools) assert.equal(t.risk, TOOL_RISKS[t.name as keyof typeof TOOL_RISKS]);
  for (const name of ["requestRefund","changeBookingStatus"]) assert.equal(TOOL_RISKS[name as keyof typeof TOOL_RISKS], "high");
  assert.throws(() => makePlatformAgent("owner-assistant", { enabled: false, model: "m", dailyTokenBudget: 200000 }, tools), /OWNER_READ_ONLY/);
});

test("AG2: DMC-private inbox is never returned; non-platform context is rejected", async () => {
  const queries: string[] = [];
  const tools = platformTools({ query: async (sql) => { queries.push(sql); return { rows: [] }; } });
  const inbox = tools.find(t => t.name === "getInboxEmail")!;
  assert.deepEqual(JSON.parse(await inbox.run({ inboxId: id }, ctx)), { error: "NOT_FOUND" });
  assert.match(queries[0]!, /tenant_id IS NULL/);
  await assert.rejects(inbox.run({ inboxId: id }, { ...ctx, tenantId: id }), /PLATFORM_ONLY/);
  const agency = tools.find(t => t.name === "getAgencySummary")!;
  assert.deepEqual(JSON.parse(await agency.run({ agencyId: id }, ctx)), { error: "NOT_FOUND" });
  assert.match(queries.at(-1)!, /a.type='master'/);
});

test("AG3: high-risk actions never execute before approval", async () => {
  const queued: unknown[] = [];
  const store: RunStore = {
    tokensUsedToday: async () => 0, startRun: async () => id,
    addUsage: async () => {}, finishRun: async () => {}, audit: async () => {},
    enqueueApproval: async a => { queued.push(a); return id; },
  };
  let calls = 0;
  const model: ModelClient = { complete: async () => {
    calls++;
    return calls === 1
      ? { content: [{ type: "tool_use", id, name: "changeBookingStatus", input: { bookingId: id, status: "cancelled", reason: "Owner review" } }], stopReason: "tool_use", inputTokens: 1, outputTokens: 1 }
      : { content: [{ type: "text", text: "Queued" }], stopReason: "end_turn", inputTokens: 1, outputTokens: 1 };
  } };
  const tools = platformTools({ query: async () => { throw new Error("Action executed before approval"); } });
  const agent = makePlatformAgent("reservations", { enabled: true, model: "fake", dailyTokenBudget: 200000 }, tools);
  const result = await runAgent({ store, model }, agent, { tenantId: null, trigger: "test", prompt: "Review" });
  assert.equal(result.status, "done");
  assert.equal(queued.length, 1);
  assert.equal((queued[0] as { risk: string }).risk, "high");
});

test("AG4: disabled agents do not call a model", async () => {
  const agent = makePlatformAgent("reservations", { enabled: false, model: "fake", dailyTokenBudget: 200000 }, []);
  const model: ModelClient = { complete: async () => { throw new Error("MODEL_CALLED"); } };
  const store = {} as RunStore;
  const result = await runAgent({ store, model }, agent, { tenantId: null, trigger: "test", prompt: "Test" });
  assert.equal(result.status, "disabled");
});
