// Approval queue. An agent can only queue a medium/high-risk action; a human decides. The action runs exactly
// once, after the last required approval, through a registered handler. One rejection closes the item.
import type { Db } from "./store";

export interface Approval { id: string; agent_id: string; tenant_id: string | null; action: string; payload: any; risk: "medium" | "high"; required_approvals: number; state: string }
export type ApprovalHandler = (db: Db, approval: Approval) => Promise<string | void>;
const handlers = new Map<string, ApprovalHandler>();
export const registerApprovalHandler = (action: string, handler: ApprovalHandler) => { handlers.set(action, handler); };

export interface Decision { state: "pending" | "approved" | "rejected" | "expired"; approvals: number; required: number }

export async function decideApproval(db: Db, id: string, userId: string, decision: "approve" | "reject", now: Date = new Date()): Promise<Decision | null> {
  const a = (await db.query("SELECT id, agent_id, tenant_id, action, payload, risk, required_approvals, state, expires_at FROM approval_queue WHERE id = $1", [id])).rows[0] as (Approval & { expires_at: Date }) | undefined;
  if (!a) return null;
  const required = a.required_approvals;
  const count = async () => Number((await db.query("SELECT count(*) AS n FROM approval_votes WHERE approval_id = $1 AND decision = 'approve'", [id])).rows[0].n);
  if (a.state !== "pending") return { state: a.state as Decision["state"], approvals: await count(), required };
  if (new Date(a.expires_at) <= now) {
    await db.query("UPDATE approval_queue SET state = 'expired', decided_at = $2 WHERE id = $1 AND state = 'pending'", [id, now]);
    return { state: "expired", approvals: await count(), required };
  }
  const handler = handlers.get(a.action);
  if (decision === "approve" && !handler) throw new Error("NO_HANDLER_FOR_ACTION");
  await db.query("INSERT INTO approval_votes(approval_id, user_id, decision) VALUES ($1,$2,$3) ON CONFLICT (approval_id, user_id) DO NOTHING", [id, userId, decision]);
  if (decision === "reject") {
    await db.query("UPDATE approval_queue SET state = 'rejected', decided_at = $2 WHERE id = $1 AND state = 'pending'", [id, now]);
    return { state: "rejected", approvals: await count(), required };
  }
  const approvals = await count();
  if (approvals < required) return { state: "pending", approvals, required };
  const claimed = (await db.query("UPDATE approval_queue SET state = 'approved', decided_at = $2 WHERE id = $1 AND state = 'pending' RETURNING id", [id, now])).rows[0];
  if (!claimed) return { state: "approved", approvals, required };
  const result = await handler!(db, a);
  await db.query("UPDATE approval_queue SET result = $2 WHERE id = $1", [id, typeof result === "string" ? result.slice(0, 500) : null]);
  return { state: "approved", approvals, required };
}
