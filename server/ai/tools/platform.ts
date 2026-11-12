import type { AgentTool, ToolContext } from "../runtime";
import type { Db } from "../store";
import { TOOL_RISKS } from "../agents/registry";

const uuid = (value: unknown): string => {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error("INVALID_UUID");
  return value;
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_INPUT");
  return value as Record<string, unknown>;
};
const string = (v: unknown, max: number): string => {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new Error("INVALID_INPUT");
  return v.trim();
};
const platform = (ctx: ToolContext): void => {
  if (ctx.tenantId !== null) throw new Error("PLATFORM_ONLY");
};
const json = (value: unknown): string => JSON.stringify(value).slice(0, 8000);
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const idField = { type: "string", format: "uuid" };
const textField = { type: "string", maxLength: 500 };
const build = (name: keyof typeof TOOL_RISKS, input_schema: Record<string, unknown>, run: AgentTool["run"], summarize?: AgentTool["summarize"], amountEur?: AgentTool["amountEur"]): AgentTool =>
  ({ name, description: name, input_schema, risk: TOOL_RISKS[name], run, ...(summarize ? { summarize } : {}), ...(amountEur ? { amountEur } : {}) });

/** The platform operator may read every BED4BOOK booking, but never DMC-private mail or credentials. */
export function platformTools(db: Db): AgentTool[] {
  const bookingColumns = `b.id, b.booking_no, b.status, b.check_in::text, b.check_out::text,
    b.total, b.currency, h.name AS hotel_name, r.name AS room_name, a.name AS agency_name`;
  const bookingJoin = `FROM bookings b JOIN hotels h ON h.id=b.hotel_id
    JOIN agencies a ON a.id=b.agency_id JOIN rate_plans rp ON rp.id=b.rate_plan_id
    JOIN rooms r ON r.id=rp.room_id`;
  return [
    build("getBooking", schema({ bookingId: idField }, ["bookingId"]), async (input, ctx) => {
      platform(ctx); const id = uuid(object(input).bookingId);
      const rows = (await db.query(`SELECT ${bookingColumns} ${bookingJoin} WHERE b.id=$1`, [id])).rows;
      if (!rows.length) return json({ error: "NOT_FOUND" });
      const history = (await db.query("SELECT from_status,to_status,created_at FROM booking_status_history WHERE booking_id=$1 ORDER BY id DESC LIMIT 5", [id])).rows;
      return json({ ...rows[0], history });
    }),
    build("listBookings", schema({ status: { type: "string", maxLength: 40 }, from: { type: "string", format: "date" }, to: { type: "string", format: "date" }, limit: { type: "integer", minimum: 1, maximum: 50 } }), async (input, ctx) => {
      platform(ctx); const v = object(input);
      const limit = v.limit === undefined ? 20 : v.limit;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("INVALID_LIMIT");
      const status = v.status === undefined ? null : string(v.status, 40);
      const date = (x: unknown): string | null => {
        if (x === undefined) return null;
        if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x) || Number.isNaN(Date.parse(x))) throw new Error("INVALID_DATE");
        return x;
      };
      const from = date(v.from), to = date(v.to);
      return json((await db.query(`SELECT ${bookingColumns} ${bookingJoin}
        WHERE ($1::text IS NULL OR b.status=$1) AND ($2::date IS NULL OR b.check_in >= $2::date)
          AND ($3::date IS NULL OR b.check_out <= $3::date)
        ORDER BY b.created_at DESC LIMIT $4`, [status, from, to, limit])).rows);
    }),
    build("getAgencySummary", schema({ agencyId: idField }, ["agencyId"]), async (input, ctx) => {
      platform(ctx); const id = uuid(object(input).agencyId);
      const rows = (await db.query(`SELECT a.id,a.name,a.active,COUNT(b.id)::int AS booking_count,
        COALESCE(SUM(b.total),0)::text AS booking_total
        FROM agencies a LEFT JOIN bookings b ON b.agency_id=a.id
          AND b.created_at >= date_trunc('month',now())
        WHERE a.id=$1 AND a.type='master'
        GROUP BY a.id,a.name,a.active`, [id])).rows;
      return json(rows[0] ?? { error: "NOT_FOUND" });
    }),
    build("getInboxEmail", schema({ inboxId: idField }, ["inboxId"]), async (input, ctx) => {
      platform(ctx); const id = uuid(object(input).inboxId);
      const rows = (await db.query(`SELECT id,to_address,from_address,subject,text_body,function_name,status,received_at
        FROM email_inbox WHERE id=$1 AND tenant_id IS NULL`, [id])).rows;
      if (!rows.length) return json({ error: "NOT_FOUND" });
      const attachments = (await db.query("SELECT filename,content_type,size_bytes FROM inbound_attachments WHERE inbox_id=$1", [id])).rows;
      return json({ ...rows[0], attachments });
    }),
    build("listOpenApprovals", schema({ limit: { type: "integer", minimum: 1, maximum: 50 } }), async (input, ctx) => {
      platform(ctx); const v = object(input), limit = v.limit ?? 20;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("INVALID_LIMIT");
      return json((await db.query(`SELECT id,agent_id,action,summary,risk,amount_eur,created_at
        FROM approval_queue WHERE tenant_id IS NULL AND state='pending' ORDER BY created_at DESC LIMIT $1`, [limit])).rows);
    }),
    build("getDailyStats", schema({}), async (input, ctx) => {
      platform(ctx); object(input);
      const rows = (await db.query(`SELECT
        (SELECT COUNT(*)::int FROM bookings WHERE created_at >= CURRENT_DATE) AS bookings_today,
        (SELECT COUNT(*)::int FROM email_inbox WHERE tenant_id IS NULL AND received_at >= CURRENT_DATE) AS platform_emails_today,
        (SELECT COUNT(*)::int FROM approval_queue WHERE tenant_id IS NULL AND state='pending') AS pending_approvals`)).rows;
      return json(rows[0]);
    }),
    build("draftReply", schema({ inboxId: idField, toAddress: { type: "string", maxLength: 320 }, subject: { type: "string", maxLength: 250 }, textBody: { type: "string", maxLength: 8000 } }, ["inboxId","toAddress","subject","textBody"]),
      async () => { throw new Error("APPROVAL_REQUIRED"); },
      input => `Draft reply for ${string(object(input).toAddress,320)}`),
    build("flagBooking", schema({ bookingId: idField, reason: textField }, ["bookingId","reason"]),
      async () => { throw new Error("APPROVAL_REQUIRED"); },
      input => `Flag booking ${uuid(object(input).bookingId)}`),
    build("requestRefund", schema({ bookingId: idField, amount: { type: "number", exclusiveMinimum: 0 }, currency: { type: "string", maxLength: 3 }, reason: textField }, ["bookingId","amount","currency","reason"]),
      async () => { throw new Error("APPROVAL_REQUIRED"); },
      input => `Request refund for booking ${uuid(object(input).bookingId)}`,
      input => { const amount = object(input).amount; if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) throw new Error("INVALID_AMOUNT"); return amount; }),
    build("changeBookingStatus", schema({ bookingId: idField, status: { type: "string", enum: ["approved","rejected","cancelled"] }, reason: textField }, ["bookingId","status","reason"]),
      async () => { throw new Error("APPROVAL_REQUIRED"); },
      input => `Change booking ${uuid(object(input).bookingId)} status`),
  ];
}
