// Management API for nationality-based pricing: hotel contracts, nationality rules, market groups,
// currencies and exchange rates.
// Authorization (backend):
//   contracts / nationality rules : system_admin and back_office platform-wide; master_agency own hotels only
//   market groups                 : system_admin and back_office write; master_agency read
//   currencies                    : everyone with management access reads; system_admin activates/deactivates
//   exchange rates                : system_admin and back_office write; management roles read
//   sub_agency                    : no access
// Every change is audited with before/after values. Changes never touch existing bookings: price, contract,
// eligibility and FX of a booking are frozen in its snapshot.
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "./db";
import { audit, authenticate, httpError, roles, uuidParam } from "./http";
import { h, HOTEL_SQL, managers, ownedHotel, RATE_PLAN_SQL, rowJson } from "./admin-routes";
import { isCalendarDate, UUID_RE } from "./validation";
import { isCountryCode } from "./reference";
import { evaluateContract, NationalityRule } from "./eligibility";
import { parseMinor } from "./pricing";

export const contractRouter = Router();

const CONTRACT_SQL = `SELECT c.hotel_id, h.owner_agency_id FROM hotel_contracts c JOIN hotels h ON h.id = c.hotel_id WHERE c.id = $1`;
const RULE_SQL = `SELECT c.hotel_id, h.owner_agency_id FROM contract_nationality_rules r JOIN hotel_contracts c ON c.id = r.contract_id
                  JOIN hotels h ON h.id = c.hotel_id WHERE r.id = $1`;
const CODE_RE = /^[A-Z0-9_-]{1,40}$/;
const STATUSES = ["draft", "active", "inactive"];
const optDate = (v: unknown) => v === undefined || v === null || isCalendarDate(v);
const platformWriters = [authenticate, roles("system_admin", "back_office")] as const;

async function rulesOf(contractId: string): Promise<NationalityRule[]> {
  const rows = (await pool.query(
    `SELECT r.id, r.contract_id, r.rule_type, r.country_code, r.market_group_id, g.code AS group_code,
            coalesce(array_agg(m.country_code ORDER BY m.country_code) FILTER (WHERE m.country_code IS NOT NULL), '{}') AS members
       FROM contract_nationality_rules r LEFT JOIN market_groups g ON g.id = r.market_group_id
       LEFT JOIN market_group_members m ON m.group_id = r.market_group_id
      WHERE r.contract_id = $1 GROUP BY r.id, g.code ORDER BY r.rule_type DESC, r.id`, [contractId])).rows;
  return rows.map((r: any) => ({ id: r.id, contractId: r.contract_id, type: r.rule_type, countryCode: r.country_code ? String(r.country_code).trim() : null,
                                 marketGroupId: r.market_group_id, marketGroupCode: r.group_code, members: (r.members as string[]).map(x => x.trim()) }));
}

// ---------------------------------------------------------------- contracts
contractRouter.post("/api/admin/hotels/:id/contracts", ...managers, h(async (req, res) => {
  const hotelId = uuidParam(req), b = req.body || {};
  if (typeof b.code !== "string" || !CODE_RE.test(b.code) || typeof b.name !== "string" || !b.name.trim() || b.name.length > 200
      || typeof b.currency !== "string" || !optDate(b.validFrom) || !optDate(b.validTo)
      || (b.validFrom && b.validTo && b.validTo < b.validFrom) || (b.status !== undefined && !STATUSES.includes(b.status))
      || typeof b.sellerLegalName !== "string" || !b.sellerLegalName.trim() || b.sellerLegalName.length > 300)
    throw httpError(400, "INVALID_CONTRACT");
  const owner = await ownedHotel(pool, req, HOTEL_SQL, hotelId);
  if (!(await pool.query("SELECT 1 FROM currencies WHERE code = $1 AND active", [b.currency])).rowCount) throw httpError(400, "CURRENCY_NOT_SUPPORTED");
  const id = randomUUID();
  await withTransaction(async client => {
    await client.query(
      `INSERT INTO hotel_contracts(id, hotel_id, code, name, currency, valid_from, valid_to, seller_legal_name, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, hotelId, b.code, b.name.trim(), b.currency, b.validFrom ?? null, b.validTo ?? null, b.sellerLegalName.trim(), b.status ?? "draft"]);
    await audit(client, req.auth!.sub, owner.owner_agency_id, "contract.created", "contract", id, { after: await rowJson(client, "hotel_contracts", id) });
  });
  res.status(201).json(await rowJson(pool, "hotel_contracts", id));
}));

contractRouter.get("/api/admin/hotels/:id/contracts", ...managers, h(async (req, res) => {
  const hotelId = uuidParam(req);
  await ownedHotel(pool, req, HOTEL_SQL, hotelId);
  const items = (await pool.query(
    `SELECT c.*, (SELECT count(*)::int FROM contract_rate_plans crp WHERE crp.contract_id = c.id) AS rate_plan_count,
            (SELECT count(*)::int FROM contract_nationality_rules r WHERE r.contract_id = c.id) AS rule_count
       FROM hotel_contracts c WHERE c.hotel_id = $1 ORDER BY c.is_default DESC, c.code`, [hotelId])).rows;
  res.json({ items });
}));

contractRouter.get("/api/admin/contracts/:id", ...managers, h(async (req, res) => {
  const id = uuidParam(req);
  await ownedHotel(pool, req, CONTRACT_SQL, id);
  const contract = (await pool.query("SELECT * FROM hotel_contracts WHERE id = $1", [id])).rows[0];
  const ratePlans = (await pool.query(
    `SELECT rp.id, rp.board_name, rp.currency, rp.active, r.name AS room_name FROM contract_rate_plans crp
       JOIN rate_plans rp ON rp.id = crp.rate_plan_id JOIN rooms r ON r.id = rp.room_id WHERE crp.contract_id = $1 ORDER BY r.name, rp.board_name`, [id])).rows;
  res.json({ ...contract, ratePlans, nationalityRules: await rulesOf(id) });
}));

contractRouter.patch("/api/admin/contracts/:id", ...managers, h(async (req, res) => {
  const id = uuidParam(req), b = req.body || {};
  if ("currency" in b || "hotelId" in b || "code" in b) throw httpError(400, "IMMUTABLE_FIELD");
  if ((b.name !== undefined && (typeof b.name !== "string" || !b.name.trim())) || !optDate(b.validFrom) || !optDate(b.validTo)
      || (b.status !== undefined && !STATUSES.includes(b.status))
      || (b.sellerLegalName !== undefined && (typeof b.sellerLegalName !== "string" || !b.sellerLegalName.trim())))
    throw httpError(400, "INVALID_CONTRACT");
  const owner = await ownedHotel(pool, req, CONTRACT_SQL, id);
  const fields: Record<string, unknown> = { name: b.name?.trim(), valid_from: b.validFrom, valid_to: b.validTo, status: b.status,
                                            seller_legal_name: b.sellerLegalName?.trim() };
  const cols = Object.keys(fields).filter(k => fields[k] !== undefined);
  if (!cols.length) throw httpError(400, "NO_FIELDS_TO_UPDATE");
  const row = await withTransaction(async client => {
    const before = await rowJson(client, "hotel_contracts", id);
    await client.query(`UPDATE hotel_contracts SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
      [id, ...cols.map(c => fields[c])]);
    const after = await rowJson(client, "hotel_contracts", id);
    if (after.valid_from && after.valid_to && after.valid_to < after.valid_from) throw httpError(400, "INVALID_CONTRACT");
    await audit(client, req.auth!.sub, owner.owner_agency_id, "contract.updated", "contract", id, { before, after });
    return after;
  });
  res.json(row);
}));

// Move a rate plan into this contract (same hotel and currency, enforced in the database as well).
contractRouter.post("/api/admin/contracts/:id/rate-plans", ...managers, h(async (req, res) => {
  const id = uuidParam(req), ratePlanId = req.body?.ratePlanId;
  if (typeof ratePlanId !== "string" || !UUID_RE.test(ratePlanId)) throw httpError(400, "RATE_PLAN_REQUIRED");
  const owner = await ownedHotel(pool, req, CONTRACT_SQL, id);
  const rp = await ownedHotel(pool, req, RATE_PLAN_SQL, ratePlanId);
  if (rp.hotel_id !== owner.hotel_id) throw httpError(400, "RATE_PLAN_OF_ANOTHER_HOTEL");
  const result = await withTransaction(async client => {
    const before = (await client.query("SELECT contract_id FROM contract_rate_plans WHERE rate_plan_id = $1", [ratePlanId])).rows[0]?.contract_id ?? null;
    const c = (await client.query("SELECT currency FROM hotel_contracts WHERE id = $1", [id])).rows[0];
    const r = (await client.query("SELECT currency FROM rate_plans WHERE id = $1", [ratePlanId])).rows[0];
    if (String(c.currency).trim() !== String(r.currency).trim()) throw httpError(400, "CONTRACT_CURRENCY_MISMATCH");
    await client.query(
      `INSERT INTO contract_rate_plans(rate_plan_id, contract_id) VALUES ($1,$2)
       ON CONFLICT (rate_plan_id) DO UPDATE SET contract_id = EXCLUDED.contract_id`, [ratePlanId, id]);
    await audit(client, req.auth!.sub, owner.owner_agency_id, "contract.rate_plan_moved", "rate_plan", ratePlanId,
      { before: { contract_id: before }, after: { contract_id: id } });
    return { ratePlanId, contractId: id, previousContractId: before };
  });
  res.json(result);
}));

// ---------------------------------------------------------------- nationality rules
contractRouter.post("/api/admin/contracts/:id/nationality-rules", ...managers, h(async (req, res) => {
  const id = uuidParam(req), b = req.body || {};
  const country = typeof b.countryCode === "string" ? b.countryCode.trim().toUpperCase() : undefined;
  if (!["include", "exclude"].includes(b.ruleType) || (country === undefined) === (b.marketGroupId === undefined)
      || (country !== undefined && !isCountryCode(country))
      || (b.marketGroupId !== undefined && (typeof b.marketGroupId !== "string" || !UUID_RE.test(b.marketGroupId))))
    throw httpError(400, "INVALID_RULE", { hint: "ruleType include|exclude and exactly one of countryCode (ISO 3166-1 alpha-2) or marketGroupId" });
  const owner = await ownedHotel(pool, req, CONTRACT_SQL, id);
  if (b.marketGroupId && !(await pool.query("SELECT 1 FROM market_groups WHERE id = $1", [b.marketGroupId])).rowCount)
    throw httpError(400, "MARKET_GROUP_NOT_FOUND");
  const ruleId = randomUUID();
  await withTransaction(async client => {
    await client.query(
      `INSERT INTO contract_nationality_rules(id, contract_id, rule_type, country_code, market_group_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [ruleId, id, b.ruleType, country ?? null, b.marketGroupId ?? null, req.auth!.sub]);
    await audit(client, req.auth!.sub, owner.owner_agency_id, "contract.rule_added", "contract", id,
      { after: { ruleId, ruleType: b.ruleType, countryCode: country ?? null, marketGroupId: b.marketGroupId ?? null } });
  });
  res.status(201).json({ id: ruleId, contractId: id, ruleType: b.ruleType, countryCode: country ?? null, marketGroupId: b.marketGroupId ?? null });
}));

contractRouter.delete("/api/admin/nationality-rules/:id", ...managers, h(async (req, res) => {
  const id = uuidParam(req);
  const owner = await ownedHotel(pool, req, RULE_SQL, id);
  await withTransaction(async client => {
    const before = (await client.query("SELECT to_jsonb(r) AS j FROM contract_nationality_rules r WHERE id = $1", [id])).rows[0].j;
    await client.query("DELETE FROM contract_nationality_rules WHERE id = $1", [id]);
    await audit(client, req.auth!.sub, owner.owner_agency_id, "contract.rule_removed", "contract", before.contract_id, { before });
  });
  res.json({ id, deleted: true });
}));

// Exclusion-first preview for the admin UI: which nationalities may book this contract, and why.
contractRouter.get("/api/admin/contracts/:id/eligibility", ...managers, h(async (req, res) => {
  const id = uuidParam(req);
  await ownedHotel(pool, req, CONTRACT_SQL, id);
  const list = String(req.query.nationalities ?? "").split(",").map(x => x.trim().toUpperCase()).filter(Boolean);
  if (!list.length || list.length > 50 || !list.every(isCountryCode)) throw httpError(400, "NATIONALITIES_REQUIRED");
  res.json(evaluateContract(await rulesOf(id), list));
}));

// ---------------------------------------------------------------- market groups (platform-wide reference data)
const validCountries = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.length <= 249 && v.every(c => typeof c === "string" && isCountryCode(c.trim().toUpperCase()));

contractRouter.post("/api/admin/market-groups", ...platformWriters, h(async (req, res) => {
  const b = req.body || {};
  if (typeof b.code !== "string" || !CODE_RE.test(b.code) || typeof b.name !== "string" || !b.name.trim() || !validCountries(b.countries))
    throw httpError(400, "INVALID_MARKET_GROUP");
  const id = randomUUID(), countries = [...new Set(b.countries.map((c: string) => c.trim().toUpperCase()))].sort() as string[];
  await withTransaction(async client => {
    await client.query("INSERT INTO market_groups(id, code, name) VALUES ($1,$2,$3)", [id, b.code, b.name.trim()]);
    await client.query("INSERT INTO market_group_members(group_id, country_code) SELECT $1, unnest($2::char(2)[])", [id, countries]);
    await audit(client, req.auth!.sub, null, "market_group.created", "market_group", id, { after: { code: b.code, name: b.name.trim(), countries } });
  });
  res.status(201).json({ id, code: b.code, name: b.name.trim(), countries });
}));

contractRouter.put("/api/admin/market-groups/:id/countries", ...platformWriters, h(async (req, res) => {
  const id = uuidParam(req), b = req.body || {};
  if (!validCountries(b.countries)) throw httpError(400, "INVALID_MARKET_GROUP");
  const countries = [...new Set(b.countries.map((c: string) => c.trim().toUpperCase()))].sort() as string[];
  await withTransaction(async client => {
    const before = (await client.query("SELECT array_agg(country_code ORDER BY country_code) AS c FROM market_group_members WHERE group_id = $1", [id])).rows[0].c;
    if (!(await client.query("SELECT 1 FROM market_groups WHERE id = $1", [id])).rowCount) throw httpError(404, "NOT_FOUND");
    await client.query("DELETE FROM market_group_members WHERE group_id = $1", [id]);
    await client.query("INSERT INTO market_group_members(group_id, country_code) SELECT $1, unnest($2::char(2)[])", [id, countries]);
    await audit(client, req.auth!.sub, null, "market_group.countries_replaced", "market_group", id, { before: { countries: before ?? [] }, after: { countries } });
  });
  res.json({ id, countries });
}));

contractRouter.get("/api/admin/market-groups", ...managers, h(async (_req, res) => {
  const items = (await pool.query(
    `SELECT g.id, g.code, g.name, coalesce(array_agg(m.country_code ORDER BY m.country_code) FILTER (WHERE m.country_code IS NOT NULL), '{}') AS countries
       FROM market_groups g LEFT JOIN market_group_members m ON m.group_id = g.id GROUP BY g.id ORDER BY g.code`)).rows;
  res.json({ items });
}));

// ---------------------------------------------------------------- currencies and exchange rates
contractRouter.get("/api/admin/currencies", ...managers, h(async (_req, res) => {
  res.json({ items: (await pool.query("SELECT code, name, minor_units, active FROM currencies ORDER BY code")).rows });
}));

contractRouter.patch("/api/admin/currencies/:code", authenticate, roles("system_admin"), h(async (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || typeof req.body?.active !== "boolean") throw httpError(400, "INVALID_CURRENCY");
  if (code === "EUR" && req.body.active === false) throw httpError(400, "EUR_IS_THE_REFERENCE_CURRENCY");
  const row = await withTransaction(async client => {
    const before = (await client.query("SELECT code, active FROM currencies WHERE code = $1", [code])).rows[0];
    if (!before) throw httpError(404, "NOT_FOUND");
    const after = (await client.query("UPDATE currencies SET active = $2 WHERE code = $1 RETURNING code, name, minor_units, active", [code, req.body.active])).rows[0];
    await audit(client, req.auth!.sub, null, req.body.active ? "currency.activated" : "currency.deactivated", "currency", code, { before, after });
    return after;
  });
  res.json(row);
}));

contractRouter.get("/api/admin/fx-rates", ...managers, h(async (_req, res) => {
  const items = (await pool.query(
    `SELECT f.currency, f.eur_per_unit::text AS eur_per_unit, f.source, f.valid_at, f.history_id,
            round(extract(epoch FROM now() - f.valid_at) / 3600, 1)::float8 AS age_hours
       FROM fx_rates f ORDER BY f.currency`)).rows;
  res.json({ items });
}));

/** Records rates from an approved source (manual entry for currencies the ECB does not publish). Each rate is
 *  "EUR per one unit". Existing bookings are unaffected: they reference the history row they were priced with. */
contractRouter.post("/api/admin/fx-rates", ...platformWriters, h(async (req, res) => {
  const b = req.body || {};
  const validAt = b.validAt === undefined ? new Date() : new Date(b.validAt);
  if (typeof b.source !== "string" || !b.source.trim() || b.source.length > 100 || !Array.isArray(b.rates) || !b.rates.length
      || Number.isNaN(validAt.getTime()) || validAt.getTime() > Date.now() + 5 * 60 * 1000) throw httpError(400, "INVALID_FX_RATES");
  for (const r of b.rates) {
    const ok = r && typeof r.currency === "string" && /^[A-Z]{3}$/.test(r.currency) && r.currency !== "EUR"
      && (typeof r.eurPerUnit === "number" || typeof r.eurPerUnit === "string") && Number(r.eurPerUnit) > 0 && Number(r.eurPerUnit) < 1e10
      && (() => { try { parseMinor(r.eurPerUnit, 8); return true; } catch { return false; } })();
    if (!ok) throw httpError(400, "INVALID_FX_RATES", { rate: r });
  }
  const result = await withTransaction(async client => {
    const out: unknown[] = [];
    for (const r of b.rates) {
      if (!(await client.query("SELECT 1 FROM currencies WHERE code = $1 AND active", [r.currency])).rowCount) throw httpError(400, "CURRENCY_NOT_SUPPORTED", { currency: r.currency });
      const before = (await client.query("SELECT eur_per_unit::text AS eur_per_unit, source, valid_at, history_id FROM fx_rates WHERE currency = $1", [r.currency])).rows[0] ?? null;
      const after = (await client.query(
        `INSERT INTO fx_rates(currency, eur_per_unit, source, valid_at) VALUES ($1, $2::numeric, $3, $4)
         ON CONFLICT (currency) DO UPDATE SET eur_per_unit = EXCLUDED.eur_per_unit, source = EXCLUDED.source, valid_at = EXCLUDED.valid_at
         RETURNING currency, eur_per_unit::text AS eur_per_unit, source, valid_at, history_id`,
        [r.currency, String(r.eurPerUnit), b.source.trim(), validAt.toISOString()])).rows[0];
      await audit(client, req.auth!.sub, null, "fx_rate.recorded", "currency", r.currency, { before, after });
      out.push(after);
    }
    return out;
  });
  res.status(201).json({ items: result });
}));
