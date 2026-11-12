import { Router } from "express";
import { pool, withTransaction } from "../db";
import { authenticate, type AuthedRequest } from "../http";
import { decideApproval } from "./approvals";
import { UUID_RE } from "../validation";

export const aiCenterRouter = Router();
aiCenterRouter.use("/api/ai", authenticate, (req: AuthedRequest, res, next) => {
  if (req.auth?.role !== "system_admin" && req.auth?.role !== "back_office")
    return res.status(404).json({ error: "NOT_FOUND" });
  next();
});
const write = (req: AuthedRequest, res: any, next: any) =>
  req.auth?.role === "system_admin" ? next() : res.status(403).json({ error: "FORBIDDEN" });
const wrap = (fn: any) => async (req: any, res: any, next: any) => {
  try { await fn(req, res); } catch (error) { next(error); }
};
const idOK = (id: unknown) => typeof id === "string" && UUID_RE.test(id);
const missing = (res: any) => res.status(404).json({ error: "NOT_FOUND" });
const fields = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

aiCenterRouter.get("/api/ai/agents", wrap(async (_req: AuthedRequest, res: any) => {
  const { rows } = await pool.query(`SELECT a.id, a.name, a.function_name, a.enabled, a.model,
    a.daily_token_budget, COALESCE(t.used,0)::bigint AS tokens_today,
    latest.id AS last_run_id, latest.status AS last_run_status, latest.started_at AS last_run_at
    FROM ai_agents a LEFT JOIN LATERAL
    (SELECT SUM(input_tokens + output_tokens) AS used FROM ai_runs
     WHERE agent_id=a.id AND started_at >= date_trunc('day',now())) t ON true
    LEFT JOIN LATERAL
    (SELECT id,status,started_at FROM ai_runs WHERE agent_id=a.id ORDER BY started_at DESC LIMIT 1) latest ON true
    ORDER BY a.id`);
  res.json({ items: rows, configured: Boolean(process.env.ANTHROPIC_API_KEY) });
}));
aiCenterRouter.patch("/api/ai/agents/:id", write, wrap(async (req: any, res: any) => {
  const b = req.body;
  if (!fields(b) || Object.keys(b).some(k => !["enabled","model","daily_token_budget"].includes(k))
      || Object.keys(b).length === 0
      || ("enabled" in b && typeof b.enabled !== "boolean")
      || ("model" in b && (typeof b.model !== "string" || !/^[a-zA-Z0-9._-]{1,100}$/.test(b.model)))
      || ("daily_token_budget" in b && (!Number.isSafeInteger(b.daily_token_budget) || (b.daily_token_budget as number) < 0 || (b.daily_token_budget as number) > 5000000)))
    return res.status(400).json({ error: "INVALID_INPUT" });
  const r = await pool.query(`UPDATE ai_agents SET enabled=COALESCE($2,enabled),
    model=COALESCE($3,model), daily_token_budget=COALESCE($4,daily_token_budget)
    WHERE id=$1 RETURNING id,enabled,model,daily_token_budget`,
    [req.params.id,b.enabled ?? null,b.model ?? null,b.daily_token_budget ?? null]);
  if (!r.rows[0]) return missing(res);
  res.json(r.rows[0]);
}));
aiCenterRouter.get("/api/ai/approvals", wrap(async (req: any, res: any) => {
  const state = req.query.state;
  if (state !== undefined && !["pending","approved","rejected","expired"].includes(state))
    return res.status(400).json({ error: "INVALID_STATE" });
  const r = await pool.query(`SELECT id,agent_id,action,summary,risk,amount_eur,state,created_at,
    required_approvals,expires_at FROM approval_queue WHERE tenant_id IS NULL
    AND ($1::text IS NULL OR state=$1) ORDER BY created_at DESC LIMIT 100`,[state ?? null]);
  res.json({ items:r.rows });
}));
for (const decision of ["approve","reject"] as const) {
  aiCenterRouter.post(`/api/ai/approvals/:id/${decision}`, write, wrap(async (req: AuthedRequest, res: any) => {
    if (!idOK(req.params.id)) return missing(res);
    if (req.body && (typeof req.body !== "object" || Array.isArray(req.body) ||
        (req.body.note !== undefined && (typeof req.body.note !== "string" || req.body.note.length > 500))))
      return res.status(400).json({ error: "INVALID_INPUT" });
    const result = await withTransaction(async client => {
      const visible = await client.query("SELECT id FROM approval_queue WHERE id=$1 AND tenant_id IS NULL", [req.params.id]);
      if (!visible.rows[0]) return null;
      return decideApproval(client, String(req.params.id), req.auth!.sub, decision);
    });
    if (!result) return missing(res);
    res.json(result);
  }));
}
aiCenterRouter.get("/api/ai/runs", wrap(async (req: any,res: any) => {
  const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({error:"INVALID_LIMIT"});
  const agent = typeof req.query.agent === "string" ? req.query.agent : null;
  const r = await pool.query(`SELECT id,agent_id,trigger,status,input_tokens,output_tokens,error,started_at,finished_at
    FROM ai_runs WHERE tenant_id IS NULL AND ($1::text IS NULL OR agent_id=$1)
    ORDER BY started_at DESC LIMIT $2`,[agent,limit]);
  res.json({items:r.rows});
}));
aiCenterRouter.get("/api/ai/runs/:id", wrap(async (req: any,res: any) => {
  if (!idOK(req.params.id)) return missing(res);
  const r = await pool.query("SELECT * FROM ai_runs WHERE id=$1 AND tenant_id IS NULL",[req.params.id]);
  if (!r.rows[0]) return missing(res);
  const audit = await pool.query("SELECT id,action,detail,created_at FROM ai_audit WHERE run_id=$1 ORDER BY id",[req.params.id]);
  res.json({run:r.rows[0],steps:audit.rows});
}));
const KINDS = ["function","from_domain","risk","amount_over"];
const CHANNELS = ["instant","digest","count_only","never"];
const validRule = (b: any) => fields(b) && KINDS.includes(b.match_kind) &&
  typeof b.match_value === "string" && b.match_value.length >= 1 && b.match_value.length <= 255 &&
  CHANNELS.includes(b.channel) && Number.isSafeInteger(b.position) && b.position >= 0 &&
  typeof b.active === "boolean";
aiCenterRouter.get("/api/ai/notify-rules", wrap(async (_req: any,res: any) => {
  const r=await pool.query("SELECT id,match_kind,match_value,channel,position,active FROM notify_rules ORDER BY position,id");
  res.json({items:r.rows});
}));
aiCenterRouter.post("/api/ai/notify-rules", write, wrap(async (req: any,res: any) => {
  if (!validRule(req.body)) return res.status(400).json({error:"INVALID_INPUT"});
  const b=req.body;
  const r=await pool.query(`INSERT INTO notify_rules(match_kind,match_value,channel,position,active)
    VALUES($1,$2,$3,$4,$5) RETURNING *`,[b.match_kind,b.match_value,b.channel,b.position,b.active]);
  res.status(201).json(r.rows[0]);
}));
aiCenterRouter.patch("/api/ai/notify-rules/:id", write, wrap(async (req: any,res: any) => {
  if (!idOK(req.params.id)) return missing(res);
  const old=await pool.query("SELECT * FROM notify_rules WHERE id=$1",[req.params.id]);
  if (!old.rows[0]) return missing(res);
  const b={...old.rows[0],...(fields(req.body)?req.body:{})};
  if (!validRule(b) || Object.keys(req.body ?? {}).some(k=>!["match_kind","match_value","channel","position","active"].includes(k)))
    return res.status(400).json({error:"INVALID_INPUT"});
  const r=await pool.query(`UPDATE notify_rules SET match_kind=$2,match_value=$3,channel=$4,position=$5,active=$6
    WHERE id=$1 RETURNING *`,[req.params.id,b.match_kind,b.match_value,b.channel,b.position,b.active]);
  res.json(r.rows[0]);
}));
aiCenterRouter.delete("/api/ai/notify-rules/:id", write, wrap(async (req: any,res: any) => {
  if (!idOK(req.params.id)) return missing(res);
  const r=await pool.query("DELETE FROM notify_rules WHERE id=$1 RETURNING id",[req.params.id]);
  if (!r.rows[0]) return missing(res);
  res.status(204).end();
}));
