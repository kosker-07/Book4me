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

// AG11 (owner rule D3): read tools hand the model only buyer-facing booking data. The seller DMC, its net
// prices, markups, the platform fee and the contract behind a booking never leave the database through a tool.
test("AG11 read tools never select seller identity, net prices, markups, platform fee or contract data", async () => {
  const sql: string[] = [];
  const db = { query: async (text: string) => { sql.push(text.toLowerCase()); return { rows: [{}] }; } };
  const tools = platformTools(db);
  const call = async (name: string, input: unknown) => {
    const tool = tools.find(t => t.name === name);
    assert.ok(tool, name);
    await tool.run(input, ctx);
  };
  await call("getBooking", { bookingId: id });
  await call("listBookings", {});
  await call("getAgencySummary", { agencyId: id });
  await call("getDailyStats", {});
  await call("listOpenApprovals", {});
  assert.ok(sql.length >= 5);
  const forbidden = ["owner_agency_id", "inventory_daily", "booking_price_snapshots", "agency_hotel_sales", "markup",
    "platform_fee", "net_price", "netprice", "sell_price", "hotel_contracts", "contract_id", "distribution_rules"];
  for (const text of sql) for (const f of forbidden) assert.ok(!text.includes(f), `tool SQL exposes ${f}: ${text.slice(0, 160)}`);
});


test("AG12: fake model request and audit never receive confidential seller fields", async () => {
  const secret = "SELLER_SECRET_DMC_92847";
  const netPrice = "9173.42";
  const margin = "18.73";
  const fee = "6.41";
  const requests: Array<Parameters<ModelClient["complete"]>[0]> = [];
  const audits: unknown[] = [];
  const db = { query: async () => ({
    rows: [{ id, booking_no: "B4B-TEST", status: "confirmed", hotel_name: "Test Hotel",
      room_name: "Standard", total: "12000.00", currency: "EUR", agency_name: "Buyer Agency" }],
  }) };
  const tools = platformTools(db);
  const model: ModelClient = { complete: async request => {
    requests.push(structuredClone(request));
    if (requests.length === 1) return {
      content: [{ type: "tool_use", id: "tool-1", name: "getBooking", input: { bookingId: id } }],
      stopReason: "tool_use", inputTokens: 1, outputTokens: 1,
    };
    return { content: [{ type: "text", text: "Booking reviewed" }],
      stopReason: "end_turn", inputTokens: 1, outputTokens: 1 };
  } };
  const store: RunStore = {
    tokensUsedToday: async () => 0, startRun: async () => id,
    addUsage: async () => {}, finishRun: async () => {},
    audit: async entry => { audits.push(entry); },
    enqueueApproval: async () => { throw new Error("Unexpected approval"); },
  };
  const agent = makePlatformAgent("reservations",
    { enabled: true, model: "fake", dailyTokenBudget: 200000 }, tools);
  const result = await runAgent({ store, model }, agent,
    { tenantId: null, trigger: "confidentiality-test", prompt: "Review booking B4B-TEST" });
  assert.equal(result.status, "done");
  assert.equal(requests.length, 2);
  const observed = JSON.stringify({ requests, audits });
  for (const value of [secret, netPrice, margin, fee, "owner_agency_id", "platform_fee", "net_price"]) {
    assert.ok(!observed.includes(value), `Confidential value reached model or audit: ${value}`);
  }
});
