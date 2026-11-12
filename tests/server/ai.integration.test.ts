import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const skip = !process.env.DATABASE_URL ? "DATABASE_URL required" : false;
if (skip && process.env.CI) throw new Error("DATABASE_URL required in CI");

let pool: any, decideApproval: any, registerApprovalHandler: any, pgRunStore: any;
const executed: string[] = [];

before(async () => {
  if (skip) return;
  ({ pool } = await import("../../server/db"));
  ({ decideApproval, registerApprovalHandler } = await import("../../server/ai/approvals"));
  ({ pgRunStore } = await import("../../server/ai/store"));
  registerApprovalHandler("test.refund", async (_db: any, a: any) => { executed.push(a.id); return "refunded " + a.payload.amount; });
});
after(async () => { if (!skip) await pool.end(); });

const user = async () => {
  const id = randomUUID();
  await pool.query("INSERT INTO users(id,email,password_hash,role) VALUES ($1,$2,'x','system_admin')", [id, `ai-${id}@test.local`]);
  return id;
};
async function seedAgent() {
  const agentId = "test-" + randomUUID();
  await pool.query("INSERT INTO ai_agents(id,name,function_name,model,enabled,daily_token_budget) VALUES ($1,'Test','ops','m',true,1000)", [agentId]);
  return agentId;
}
async function queued(opts: { action?: string; required?: number; expiresInHours?: number } = {}) {
  const agentId = await seedAgent(), store = pgRunStore(pool);
  const runId = await store.startRun(agentId, null, "test");
  const id = await store.enqueueApproval({ runId, agentId, tenantId: null, action: opts.action ?? "test.refund", payload: { amount: 250 }, summary: "Refund 250", risk: "high", amountEur: 250 });
  if (opts.required) await pool.query("UPDATE approval_queue SET required_approvals=$2 WHERE id=$1", [id, opts.required]);
  if (opts.expiresInHours !== undefined) await pool.query("UPDATE approval_queue SET expires_at = now() + make_interval(hours => $2) WHERE id=$1", [id, opts.expiresInHours]);
  return { id, runId, agentId };
}
const row = async (id: string) => (await pool.query("SELECT state, result FROM approval_queue WHERE id=$1", [id])).rows[0];

test("AI1 store: run usage adds up, today's tokens per agent, finish status", { skip }, async () => {
  const agentId = await seedAgent(), store = pgRunStore(pool);
  const r1 = await store.startRun(agentId, null, "t"), r2 = await store.startRun(agentId, null, "t");
  await store.addUsage(r1, 100, 50); await store.addUsage(r1, 10, 5); await store.addUsage(r2, 1, 1);
  assert.equal(await store.tokensUsedToday(agentId), 167);
  assert.equal(await store.tokensUsedToday(await seedAgent()), 0);
  await store.finishRun(r1, "failed", "boom");
  const r = (await pool.query("SELECT status, error, finished_at FROM ai_runs WHERE id=$1", [r1])).rows[0];
  assert.deepEqual([r.status, r.error, !!r.finished_at], ["failed", "boom", true]);
});

test("AI2 approval runs the action exactly once; a second approve does not re-run it", { skip }, async () => {
  const { id } = await queued(), u1 = await user(), u2 = await user();
  const d = await decideApproval(pool, id, u1, "approve");
  assert.deepEqual(d, { state: "approved", approvals: 1, required: 1 });
  assert.deepEqual(await row(id), { state: "approved", result: "refunded 250" });
  assert.equal((await decideApproval(pool, id, u2, "approve")).state, "approved");
  assert.equal(executed.filter(x => x === id).length, 1);
  assert.equal(await decideApproval(pool, randomUUID(), u1, "approve"), null, "missing item");
});

test("AI3 rejection closes the item and the action never runs", { skip }, async () => {
  const { id } = await queued(), u = await user();
  assert.equal((await decideApproval(pool, id, u, "reject")).state, "rejected");
  assert.equal((await decideApproval(pool, id, await user(), "approve")).state, "rejected");
  assert.equal(executed.includes(id), false);
});

test("AI4 two-person approval: one vote is not enough, the same person twice is not enough", { skip }, async () => {
  const { id } = await queued({ required: 2 }), u1 = await user(), u2 = await user();
  assert.deepEqual(await decideApproval(pool, id, u1, "approve"), { state: "pending", approvals: 1, required: 2 });
  assert.deepEqual(await decideApproval(pool, id, u1, "approve"), { state: "pending", approvals: 1, required: 2 });
  assert.equal(executed.includes(id), false);
  assert.equal((await decideApproval(pool, id, u2, "approve")).state, "approved");
  assert.equal(executed.filter(x => x === id).length, 1);
});

test("AI5 expired item cannot be approved; unknown action cannot be approved", { skip }, async () => {
  const { id } = await queued({ expiresInHours: -1 });
  assert.equal((await decideApproval(pool, id, await user(), "approve")).state, "expired");
  assert.equal((await row(id)).state, "expired");
  assert.equal(executed.includes(id), false);
  const other = await queued({ action: "test.unregistered" });
  await assert.rejects(decideApproval(pool, other.id, await user(), "approve"), /NO_HANDLER_FOR_ACTION/);
  assert.equal((await row(other.id)).state, "pending");
});

test("AI6 audit is append-only: UPDATE and DELETE are refused", { skip }, async () => {
  const agentId = await seedAgent(), store = pgRunStore(pool), runId = await store.startRun(agentId, null, "t");
  await store.audit({ runId, agentId, tenantId: null, action: "tool.ran", detail: { name: "x" } });
  const r = (await pool.query("SELECT id, detail FROM ai_audit WHERE run_id=$1", [runId])).rows[0];
  assert.deepEqual(r.detail, { name: "x" });
  await assert.rejects(pool.query("UPDATE ai_audit SET action='edited' WHERE id=$1", [r.id]), /append-only/);
  await assert.rejects(pool.query("DELETE FROM ai_audit WHERE id=$1", [r.id]), /append-only/);
  assert.equal(Number((await pool.query("SELECT count(*) AS n FROM ai_audit WHERE run_id=$1", [runId])).rows[0].n), 1);
});
