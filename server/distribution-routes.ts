// Marketplace distribution rules (stage 1). Platform operator only: system_admin and back_office.
// A rule opens (allow) or closes (deny) one seller DMC's inventory to the sub-agencies of another DMC —
// all of the seller's hotels or one hotel, one buyer DMC or every other DMC. Rules are evaluated by the
// effective_agency_sales function (migration 010); nothing here is ever visible to a DMC or a sub-agency.
import { Router } from "express";
import type { PoolClient } from "pg";
import { pool, withTransaction } from "./db";
import { audit, authenticate, httpError, roles, uuidParam } from "./http";
import { UUID_RE } from "./validation";
import { h } from "./admin-routes";

export const distributionRouter = Router();

const operators = [authenticate, roles("system_admin", "back_office")] as const;
const EFFECTS = ["allow", "deny"];
const NOTE_MAX = 500;
const validPercent = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 &&
  Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-7;

const RULE_SQL = `SELECT d.id, d.seller_agency_id, s.name AS seller_name, d.buyer_agency_id, b.name AS buyer_name,
                         d.hotel_id, ht.name AS hotel_name, d.effect, d.active, d.platform_margin_percent::text AS platform_margin_percent, d.note, d.created_by, d.created_at, d.updated_at
                    FROM marketplace_distribution_rules d
                    JOIN agencies s ON s.id = d.seller_agency_id
                    LEFT JOIN agencies b ON b.id = d.buyer_agency_id
                    LEFT JOIN hotels ht ON ht.id = d.hotel_id`;

const ruleById = async (db: { query: PoolClient["query"] }, id: string) =>
  (await db.query(`${RULE_SQL} WHERE d.id = $1`, [id])).rows[0] ?? null;

/** undefined and null both mean "not set" (every other DMC / all hotels); anything else must be a UUID. */
const optionalId = (v: unknown, code: string): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !UUID_RE.test(v)) throw httpError(400, "INVALID_DISTRIBUTION_RULE", { reason: code });
  return v;
};

distributionRouter.get("/api/admin/distribution-rules", ...operators, h(async (_req, res) => {
  const items = (await pool.query(`${RULE_SQL} ORDER BY s.name, b.name NULLS FIRST, ht.name NULLS FIRST, d.id`)).rows;
  res.json({ items });
}));

distributionRouter.post("/api/admin/distribution-rules", ...operators, h(async (req, res) => {
  const b = req.body || {};
  if (typeof b.sellerAgencyId !== "string" || !UUID_RE.test(b.sellerAgencyId) || !EFFECTS.includes(b.effect)
      || (b.platformMarginPercent !== undefined && !validPercent(b.platformMarginPercent))
      || (b.active !== undefined && typeof b.active !== "boolean")
      || (b.note !== undefined && (typeof b.note !== "string" || b.note.length > NOTE_MAX)))
    throw httpError(400, "INVALID_DISTRIBUTION_RULE");
  if (b.effect === "allow" && b.platformMarginPercent === undefined)
    throw httpError(400, "PLATFORM_MARGIN_REQUIRED");
  if (b.effect === "deny" && b.platformMarginPercent !== undefined)
    throw httpError(400, "INVALID_DISTRIBUTION_RULE");
  const buyerId = optionalId(b.buyerAgencyId, "BUYER"), hotelId = optionalId(b.hotelId, "HOTEL");
  if (buyerId === b.sellerAgencyId) throw httpError(400, "BUYER_MUST_DIFFER_FROM_SELLER");

  const seller = (await pool.query("SELECT type FROM agencies WHERE id = $1", [b.sellerAgencyId])).rows[0];
  if (!seller || seller.type !== "master") throw httpError(400, "SELLER_MUST_BE_MASTER");
  if (buyerId) {
    const buyer = (await pool.query("SELECT type FROM agencies WHERE id = $1", [buyerId])).rows[0];
    if (!buyer || buyer.type !== "master") throw httpError(400, "BUYER_MUST_BE_MASTER");
  }
  if (hotelId) {
    const hotel = (await pool.query("SELECT owner_agency_id FROM hotels WHERE id = $1", [hotelId])).rows[0];
    if (!hotel || hotel.owner_agency_id !== b.sellerAgencyId) throw httpError(400, "HOTEL_NOT_OWNED_BY_SELLER");
  }

  try {
    const row = await withTransaction(async client => {
      const id = (await client.query(
        `INSERT INTO marketplace_distribution_rules(seller_agency_id, buyer_agency_id, hotel_id, effect, active, note, created_by, platform_margin_percent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [b.sellerAgencyId, buyerId, hotelId, b.effect, b.active ?? true, (b.note ?? "").trim(), req.auth!.sub, b.effect === "allow" ? b.platformMarginPercent : 0])).rows[0].id;
      const after = await ruleById(client, id);
      await audit(client, req.auth!.sub, null, "distribution_rule.created", "distribution_rule", id,
        { targetAgencyId: b.sellerAgencyId, after });
      return after;
    });
    res.status(201).json(row);
  } catch (error: any) {
    if (error?.code === "23505") throw httpError(409, "DISTRIBUTION_RULE_EXISTS");
    throw error;
  }
}));

distributionRouter.patch("/api/admin/distribution-rules/:id", ...operators, h(async (req, res) => {
  const id = uuidParam(req), b = req.body || {};
  const sets: string[] = [], values: unknown[] = [];
  if (b.effect !== undefined) {
    if (!EFFECTS.includes(b.effect)) throw httpError(400, "INVALID_DISTRIBUTION_RULE");
    values.push(b.effect); sets.push(`effect = $${values.length + 1}`);
  }
  if (b.active !== undefined) {
    if (typeof b.active !== "boolean") throw httpError(400, "INVALID_DISTRIBUTION_RULE");
    values.push(b.active); sets.push(`active = $${values.length + 1}`);
  }
  if (b.platformMarginPercent !== undefined) {
    if (!validPercent(b.platformMarginPercent)) throw httpError(400, "INVALID_DISTRIBUTION_RULE");
    values.push(b.platformMarginPercent); sets.push(`platform_margin_percent = $${values.length + 1}`);
  }
  if (b.note !== undefined) {
    if (typeof b.note !== "string" || b.note.length > NOTE_MAX) throw httpError(400, "INVALID_DISTRIBUTION_RULE");
    values.push(b.note.trim()); sets.push(`note = $${values.length + 1}`);
  }
  // The scope (seller, buyer, hotel) is the rule's identity: delete and create instead of moving it.
  if (b.sellerAgencyId !== undefined || b.buyerAgencyId !== undefined || b.hotelId !== undefined)
    throw httpError(400, "DISTRIBUTION_RULE_SCOPE_IS_FIXED");
  if (!sets.length) throw httpError(400, "NO_FIELDS_TO_UPDATE");

  const row = await withTransaction(async client => {
    const before = await ruleById(client, id);
    if (!before) throw httpError(404, "NOT_FOUND");
    const nextEffect = b.effect ?? before.effect;
    if (nextEffect === "deny" && b.platformMarginPercent !== undefined)
      throw httpError(400, "INVALID_DISTRIBUTION_RULE");
    if (nextEffect === "allow" && before.effect === "deny" && b.platformMarginPercent === undefined)
      throw httpError(400, "PLATFORM_MARGIN_REQUIRED");
    await client.query(`UPDATE marketplace_distribution_rules SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, [id, ...values]);
    const after = await ruleById(client, id);
    await audit(client, req.auth!.sub, null, "distribution_rule.updated", "distribution_rule", id,
      { targetAgencyId: before.seller_agency_id, before, after });
    return after;
  });
  res.json(row);
}));

distributionRouter.delete("/api/admin/distribution-rules/:id", ...operators, h(async (req, res) => {
  const id = uuidParam(req);
  await withTransaction(async client => {
    const before = await ruleById(client, id);
    if (!before) throw httpError(404, "NOT_FOUND");
    await client.query("DELETE FROM marketplace_distribution_rules WHERE id = $1", [id]);
    await audit(client, req.auth!.sub, null, "distribution_rule.deleted", "distribution_rule", id,
      { targetAgencyId: before.seller_agency_id, before });
  });
  res.status(204).end();
}));
