// Management API: hotels, rooms, rate plans, daily price/allotment calendar, agency publications, users.
// Authorization (backend): system_admin and back_office manage the whole platform; master_agency manages
// only hotels it owns; sub_agency has no access.
import { Router, Response, NextFunction } from "express";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "./db";
import { hashPassword } from "./security";
import { audit, authenticate, AuthedRequest, httpError, isPlatformWide, roles, uuidParam } from "./http";
import { isCalendarDate, nightsBetween, UUID_RE, validateRatePlanTerms } from "./validation";
import { formatMinor, normalizeDecimal, parseMinor } from "./pricing";

export const adminRouter = Router();
export const managers = [authenticate, roles("system_admin", "back_office", "master_agency")] as const;
type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
export const h = (fn: Handler) => async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try { await fn(req, res); } catch (error) { next(error); }
};
const text = (v: unknown, max = 500) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;
const optText = (v: unknown, max = 5000) => v === undefined || (typeof v === "string" && v.length <= max);
const optBool = (v: unknown) => v === undefined || typeof v === "boolean";
const isObj = (v: unknown) => v === undefined || (v !== null && typeof v === "object" && !Array.isArray(v));
const CURRENCY_RE = /^[A-Z]{3}$/;

/** Owner agency of a hotel / room / rate plan; 404 when it does not exist or the actor may not manage it. */
export async function ownedHotel(db: { query: PoolClient["query"] }, req: AuthedRequest, sql: string, id: string) {
  const row = (await db.query(sql, [id])).rows[0];
  if (!row) throw httpError(404, "NOT_FOUND");
  if (!isPlatformWide(req.auth!.role) && row.owner_agency_id !== req.auth!.agencyId) throw httpError(404, "NOT_FOUND");
  return row as { owner_agency_id: string; hotel_id: string };
}
export const HOTEL_SQL = "SELECT id AS hotel_id, owner_agency_id FROM hotels WHERE id = $1";
const ROOM_SQL = "SELECT h.id AS hotel_id, h.owner_agency_id FROM rooms r JOIN hotels h ON h.id = r.hotel_id WHERE r.id = $1";
export const RATE_PLAN_SQL = `SELECT h.id AS hotel_id, h.owner_agency_id FROM rate_plans rp JOIN rooms r ON r.id = rp.room_id
                       JOIN hotels h ON h.id = r.hotel_id WHERE rp.id = $1`;
const PUBLICATION_SQL = `SELECT h.id AS hotel_id, h.owner_agency_id FROM agency_hotel_sales s JOIN rate_plans rp ON rp.id = s.rate_plan_id
                         JOIN rooms r ON r.id = rp.room_id JOIN hotels h ON h.id = r.hotel_id WHERE s.id = $1`;

/** Current state of one row as JSON, for audit before/after values. Never selects password hashes. */
const AUDITED_TABLES = new Set(["hotels", "rooms", "rate_plans", "agency_hotel_sales", "agencies", "users", "hotel_contracts", "market_groups"]);
export async function rowJson(client: { query: PoolClient["query"] }, table: string, id: string) {
  if (!AUDITED_TABLES.has(table)) throw new Error(`rowJson: table ${table} not allowed`);
  const r = (await client.query(`SELECT to_jsonb(t) - 'password_hash' AS j FROM ${table} t WHERE id = $1`, [id])).rows[0];
  return r ? r.j : null;
}

/** Minor units of the rate plan's currency (EUR 2, JPY 0, KWD 3). */
async function currencyDigitsOfRatePlan(ratePlanId: string): Promise<number> {
  const r = (await pool.query("SELECT c.minor_units FROM rate_plans rp JOIN currencies c ON c.code = rp.currency WHERE rp.id = $1", [ratePlanId])).rows[0];
  if (!r) throw httpError(409, "CURRENCY_NOT_SUPPORTED");
  return Number(r.minor_units);
}
const hasAtMostDecimals = (v: number, digits: number) => Math.abs(v * 10 ** digits - Math.round(v * 10 ** digits)) < 1e-6;

/** Builds "SET a = $2, b = $3" from the provided fields only. */
function patchSet(fields: Record<string, unknown>, columns: Record<string, string>) {
  const sets: string[] = [], values: unknown[] = [];
  for (const [key, column] of Object.entries(columns))
    if (fields[key] !== undefined) { values.push(fields[key]); sets.push(`${column} = $${values.length + 1}`); }
  if (!sets.length) throw httpError(400, "NO_FIELDS_TO_UPDATE");
  return { sets: sets.join(", "), values };
}

// ---------------------------------------------------------------- hotels
adminRouter.post("/api/admin/hotels", ...managers, h(async (req, res) => {
  const { name, location, category, description, amenities, images, operationalNotes } = req.body || {};
  if (!text(name, 200) || !text(location, 200)) throw httpError(400, "HOTEL_NAME_AND_LOCATION_REQUIRED");
  const ownerAgencyId = isPlatformWide(req.auth!.role) ? req.body?.ownerAgencyId : req.auth!.agencyId;
  if (typeof ownerAgencyId !== "string") throw httpError(400, "OWNER_AGENCY_REQUIRED");
  const owner = (await pool.query("SELECT type, active FROM agencies WHERE id::text = $1", [ownerAgencyId])).rows[0];
  if (!owner || owner.type !== "master" || !owner.active) throw httpError(400, "OWNER_MUST_BE_ACTIVE_MASTER_AGENCY");
  const id = randomUUID();
  await withTransaction(async client => {
    await client.query(
      `INSERT INTO hotels(id, owner_agency_id, name, location, category, description, amenities, images, operational_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
      [id, ownerAgencyId, name.trim(), location.trim(), category || null, description || "", JSON.stringify(amenities || []), JSON.stringify(images || []), operationalNotes || ""]);
    await audit(client, req.auth!.sub, ownerAgencyId, "hotel.created", "hotel", id, { after: await rowJson(client, "hotels", id) });
  });
  res.status(201).json({ id, ownerAgencyId, name: name.trim(), status: "draft" });
}));

adminRouter.get("/api/admin/hotels/:id", ...managers, h(async (req, res) => {
  const id = uuidParam(req);
  await ownedHotel(pool, req, HOTEL_SQL, id);
  const hotel = (await pool.query("SELECT * FROM hotels WHERE id = $1", [id])).rows[0];
  const rooms = (await pool.query("SELECT * FROM rooms WHERE hotel_id = $1 ORDER BY name", [id])).rows;
  const ratePlans = (await pool.query(
    "SELECT rp.* FROM rate_plans rp JOIN rooms r ON r.id = rp.room_id WHERE r.hotel_id = $1 ORDER BY rp.board_name", [id])).rows;
  const publications = (await pool.query(
    `SELECT s.id, s.agency_id, a.name AS agency_name, s.rate_plan_id, s.markup_type, s.markup_value, s.active
       FROM agency_hotel_sales s JOIN agencies a ON a.id = s.agency_id JOIN rate_plans rp ON rp.id = s.rate_plan_id
       JOIN rooms r ON r.id = rp.room_id WHERE r.hotel_id = $1`, [id])).rows;
  res.json({ ...hotel, rooms, ratePlans, publications });
}));

adminRouter.patch("/api/admin/hotels/:id", ...managers, h(async (req, res) => {
  const id = uuidParam(req), b = req.body || {};
  if (b.status !== undefined && !["draft", "active", "inactive"].includes(b.status)) throw httpError(400, "INVALID_STATUS");
  if ((b.name !== undefined && !text(b.name, 200)) || (b.location !== undefined && !text(b.location, 200))
      || !optText(b.description) || !optText(b.operationalNotes) || !optText(b.category, 50)) throw httpError(400, "INVALID_HOTEL_FIELDS");
  const owner = await ownedHotel(pool, req, HOTEL_SQL, id);
  const { sets, values } = patchSet(b, { status: "status", name: "name", location: "location", category: "category", description: "description", operationalNotes: "operational_notes" });
  const row = await withTransaction(async client => {
    const before = await rowJson(client, "hotels", id);
    const r = (await client.query(`UPDATE hotels SET ${sets}, updated_at = now() WHERE id = $1 RETURNING id, name, status`, [id, ...values])).rows[0];
    await audit(client, req.auth!.sub, owner.owner_agency_id, b.status ? `hotel.status.${b.status}` : "hotel.updated", "hotel", id,
      { before, after: await rowJson(client, "hotels", id) });
    return r;
  });
  res.json(row);
}));

// ---------------------------------------------------------------- rooms
adminRouter.post("/api/admin/hotels/:id/rooms", ...managers, h(async (req, res) => {
  const hotelId = uuidParam(req), { name, description, maxAdults, maxChildren } = req.body || {};
  if (!text(name, 100) || !optText(description) || !Number.isInteger(maxAdults) || maxAdults < 1 || maxAdults > 10
      || !Number.isInteger(maxChildren) || maxChildren < 0 || maxChildren > 10) throw httpError(400, "INVALID_ROOM");
  const owner = await ownedHotel(pool, req, HOTEL_SQL, hotelId);
  const id = randomUUID();
  await withTransaction(async client => {
    await client.query("INSERT INTO rooms(id, hotel_id, name, description, max_adults, max_children) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, hotelId, name.trim(), description || "", maxAdults, maxChildren]);
    await audit(client, req.auth!.sub, owner.owner_agency_id, "room.created", "room", id, { after: await rowJson(client, "rooms", id) });
  });
  res.status(201).json({ id, hotelId, name: name.trim(), maxAdults, maxChildren, active: true });
}));

adminRouter.patch("/api/admin/rooms/:id", ...managers, h(async (req, res) => {
  const id = uuidParam(req), b = req.body || {};
  if ((b.name !== undefined && !text(b.name, 100)) || !optBool(b.active)
      || (b.maxAdults !== undefined && !(Number.isInteger(b.maxAdults) && b.maxAdults >= 1 && b.maxAdults <= 10))
      || (b.maxChildren !== undefined && !(Number.isInteger(b.maxChildren) && b.maxChildren >= 0 && b.maxChildren <= 10)))
    throw httpError(400, "INVALID_ROOM");
  const owner = await ownedHotel(pool, req, ROOM_SQL, id);
  const { sets, values } = patchSet(b, { name: "name", active: "active", maxAdults: "max_adults", maxChildren: "max_children" });
  const row = await withTransaction(async client => {
    const before = await rowJson(client, "rooms", id);
    const r = (await client.query(`UPDATE rooms SET ${sets} WHERE id = $1 RETURNING id, name, active, max_adults, max_children`, [id, ...values])).rows[0];
    await audit(client, req.auth!.sub, owner.owner_agency_id, "room.updated", "room", id, { before, after: await rowJson(client, "rooms", id) });
    return r;
  });
  res.json(row);
}));

// ---------------------------------------------------------------- rate plans
adminRouter.post("/api/admin/rooms/:id/rate-plans", ...managers, h(async (req, res) => {
  const roomId = uuidParam(req), { boardName, currency, cancellationPolicy, paymentTerms, salesConditions, contractId } = req.body || {};
  if (!text(boardName, 50) || typeof currency !== "string" || !CURRENCY_RE.test(currency)
      || !isObj(cancellationPolicy) || !isObj(paymentTerms) || !isObj(salesConditions)) throw httpError(400, "INVALID_RATE_PLAN");
  const termErrors: Record<string, string> = {};
  if (!validateRatePlanTerms(cancellationPolicy, paymentTerms, termErrors)) throw httpError(400, "VALIDATION_FAILED", { fields: termErrors });
  const owner = await ownedHotel(pool, req, ROOM_SQL, roomId);
  if (!(await pool.query("SELECT 1 FROM currencies WHERE code = $1 AND active", [currency])).rowCount) throw httpError(400, "CURRENCY_NOT_SUPPORTED");
  if (contractId !== undefined) {
    const c = typeof contractId === "string" && UUID_RE.test(contractId)
      ? (await pool.query("SELECT hotel_id, currency FROM hotel_contracts WHERE id = $1", [contractId])).rows[0] : undefined;
    if (!c || c.hotel_id !== owner.hotel_id) throw httpError(400, "CONTRACT_NOT_FOUND");
    if (String(c.currency).trim() !== currency) throw httpError(400, "CONTRACT_CURRENCY_MISMATCH");
  }
  const id = randomUUID();
  await withTransaction(async client => {
    await client.query(
      `INSERT INTO rate_plans(id, room_id, board_name, currency, cancellation_policy, payment_terms, sales_conditions)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,
      [id, roomId, boardName.trim(), currency, JSON.stringify(cancellationPolicy || {}), JSON.stringify(paymentTerms || {}), JSON.stringify(salesConditions || {})]);
    // the rate plan joined the hotel's default general-market contract (trigger); move it if a contract was given
    if (contractId !== undefined) await client.query("UPDATE contract_rate_plans SET contract_id = $2 WHERE rate_plan_id = $1", [id, contractId]);
    const contract = (await client.query("SELECT contract_id FROM contract_rate_plans WHERE rate_plan_id = $1", [id])).rows[0]?.contract_id ?? null;
    await audit(client, req.auth!.sub, owner.owner_agency_id, "rate_plan.created", "rate_plan", id,
      { after: { ...(await rowJson(client, "rate_plans", id)), contract_id: contract } });
  });
  const contract = (await pool.query("SELECT contract_id FROM contract_rate_plans WHERE rate_plan_id = $1", [id])).rows[0]?.contract_id ?? null;
  res.status(201).json({ id, roomId, boardName: boardName.trim(), currency, active: true, contractId: contract });
}));

adminRouter.patch("/api/admin/rate-plans/:id", ...managers, h(async (req, res) => {
  const id = uuidParam(req), b = req.body || {};
  if (!optBool(b.active) || !isObj(b.cancellationPolicy) || !isObj(b.paymentTerms)) throw httpError(400, "INVALID_RATE_PLAN");
  if (b.cancellationPolicy !== undefined || b.paymentTerms !== undefined) {
    const current = (await pool.query("SELECT cancellation_policy, payment_terms FROM rate_plans WHERE id = $1", [id])).rows[0];
    const termErrors: Record<string, string> = {};
    if (!validateRatePlanTerms(b.cancellationPolicy ?? current?.cancellation_policy, b.paymentTerms ?? current?.payment_terms, termErrors))
      throw httpError(400, "VALIDATION_FAILED", { fields: termErrors });
  }
  const owner = await ownedHotel(pool, req, RATE_PLAN_SQL, id);
  const fields = { active: b.active, cancellationPolicy: b.cancellationPolicy && JSON.stringify(b.cancellationPolicy), paymentTerms: b.paymentTerms && JSON.stringify(b.paymentTerms) };
  const { sets, values } = patchSet(fields, { active: "active", cancellationPolicy: "cancellation_policy", paymentTerms: "payment_terms" });
  const row = await withTransaction(async client => {
    const before = await rowJson(client, "rate_plans", id);
    const r = (await client.query(`UPDATE rate_plans SET ${sets} WHERE id = $1 RETURNING id, board_name, currency, active`, [id, ...values])).rows[0];
    await audit(client, req.auth!.sub, owner.owner_agency_id, "rate_plan.updated", "rate_plan", id, { before, after: await rowJson(client, "rate_plans", id) });
    return r;
  });
  res.json(row);
}));

// Daily net price and allotment for an inclusive date range (bulk upsert).
adminRouter.put("/api/admin/rate-plans/:id/calendar", ...managers, h(async (req, res) => {
  const id = uuidParam(req), { dateFrom, dateTo, price, allotment } = req.body || {};
  if (!isCalendarDate(dateFrom) || !isCalendarDate(dateTo) || dateTo < dateFrom) throw httpError(400, "INVALID_DATE_RANGE");
  const days = nightsBetween(dateFrom, dateTo).length + 1;
  if (days > 400) throw httpError(400, "DATE_RANGE_TOO_LONG");
  if (!Number.isInteger(allotment) || allotment < 0 || allotment > 10000) throw httpError(400, "INVALID_ALLOTMENT");
  const owner = await ownedHotel(pool, req, RATE_PLAN_SQL, id);
  const digits = await currencyDigitsOfRatePlan(id);
  // non-negative, at most as many decimals as the rate plan currency has (EUR 2, JPY 0, KWD 3)
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > 1e9 || !hasAtMostDecimals(price, digits))
    throw httpError(400, "INVALID_PRICE", { maxDecimals: digits });
  const storedPrice = formatMinor(parseMinor(price, digits), digits);
  const result = await withTransaction(async client => {
    const below = await client.query(
      "SELECT stay_date::text AS date, reserved FROM inventory_daily WHERE rate_plan_id = $1 AND stay_date BETWEEN $2::date AND $3::date AND reserved > $4 ORDER BY stay_date",
      [id, dateFrom, dateTo, allotment]);
    if (below.rowCount) throw httpError(409, "ALLOTMENT_BELOW_RESERVED", { dates: below.rows });
    const rangeJson = async () => (await client.query(
      `SELECT coalesce(json_agg(json_build_object('date', stay_date::text, 'price', price::text, 'allotment', allotment, 'reserved', reserved)
              ORDER BY stay_date), '[]'::json) AS j FROM inventory_daily WHERE rate_plan_id = $1 AND stay_date BETWEEN $2::date AND $3::date`,
      [id, dateFrom, dateTo])).rows[0].j;
    const before = await rangeJson();
    const up = await client.query(
      `INSERT INTO inventory_daily(rate_plan_id, stay_date, price, allotment)
       SELECT $1, d::date, $4::numeric, $5 FROM generate_series($2::date, $3::date, interval '1 day') AS d
       ON CONFLICT (rate_plan_id, stay_date) DO UPDATE SET price = EXCLUDED.price, allotment = EXCLUDED.allotment`,
      [id, dateFrom, dateTo, storedPrice, allotment]);
    await audit(client, req.auth!.sub, owner.owner_agency_id, "calendar.updated", "rate_plan", id, { before, after: await rangeJson() });
    return { ratePlanId: id, dateFrom, dateTo, days: up.rowCount, price: storedPrice, allotment };
  });
  res.json(result);
}));

adminRouter.get("/api/admin/rate-plans/:id/calendar", ...managers, h(async (req, res) => {
  const id = uuidParam(req);
  await ownedHotel(pool, req, RATE_PLAN_SQL, id);
  const rows = (await pool.query(
    "SELECT stay_date::text AS date, price, allotment, reserved FROM inventory_daily WHERE rate_plan_id = $1 ORDER BY stay_date LIMIT 1000", [id])).rows;
  res.json({ items: rows });
}));

// ---------------------------------------------------------------- publications (open a rate plan to a sub-agency)
async function requirePublishableRatePlan(ratePlanId: string) {
  const plan = (await pool.query("SELECT cancellation_policy, payment_terms FROM rate_plans WHERE id = $1", [ratePlanId])).rows[0];
  if (!plan || !validateRatePlanTerms(plan.cancellation_policy, plan.payment_terms))
    throw httpError(409, "RATE_PLAN_TERMS_REQUIRED");
}

const MARKUP_TYPES = ["percent", "fixed"];
const validMarkup = (type: unknown, value: unknown) =>
  MARKUP_TYPES.includes(type as string) && typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= (type === "percent" ? 1000 : 1e9);

adminRouter.post("/api/admin/publications", ...managers, h(async (req, res) => {
  const { ratePlanId, agencyId, markupType, markupValue } = req.body || {};
  if (typeof ratePlanId !== "string" || typeof agencyId !== "string" || !validMarkup(markupType, markupValue)) throw httpError(400, "INVALID_PUBLICATION");
  if (!UUID_RE.test(ratePlanId)) throw httpError(404, "NOT_FOUND");
  const owner = await ownedHotel(pool, req, RATE_PLAN_SQL, ratePlanId);
  if (!hasAtMostDecimals(markupValue, markupType === "fixed" ? await currencyDigitsOfRatePlan(ratePlanId) : 3))
    throw httpError(400, "INVALID_PUBLICATION", { reason: "MARKUP_PRECISION" });
  await requirePublishableRatePlan(ratePlanId);
  const target = (await pool.query("SELECT type, active FROM agencies WHERE id::text = $1", [agencyId])).rows[0];
  if (!target || target.type !== "sub" || !target.active) throw httpError(400, "TARGET_MUST_BE_ACTIVE_SUB_AGENCY");
  const row = await withTransaction(async client => {
    const r = (await client.query(
      `INSERT INTO agency_hotel_sales(agency_id, hotel_id, rate_plan_id, markup_type, markup_value, active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (agency_id, rate_plan_id) DO UPDATE SET markup_type = EXCLUDED.markup_type, markup_value = EXCLUDED.markup_value, active = true, hotel_id = EXCLUDED.hotel_id
       RETURNING id, agency_id, rate_plan_id, markup_type, markup_value, active`,
      [agencyId, owner.hotel_id, ratePlanId, markupType, normalizeDecimal(markupValue)])).rows[0];
    await audit(client, req.auth!.sub, owner.owner_agency_id, "publication.upserted", "publication", r.id,
      { targetAgencyId: agencyId, after: await rowJson(client, "agency_hotel_sales", r.id) });
    return r;
  });
  res.status(201).json(row);
}));

adminRouter.patch("/api/admin/publications/:id", ...managers, h(async (req, res) => {
  const id = uuidParam(req), b = req.body || {};
  if (!optBool(b.active) || ((b.markupType !== undefined || b.markupValue !== undefined) && !validMarkup(b.markupType, b.markupValue)))
    throw httpError(400, "INVALID_PUBLICATION");
  const owner = await ownedHotel(pool, req, PUBLICATION_SQL, id);
  if (b.active === true) {
    const rp = (await pool.query("SELECT rate_plan_id FROM agency_hotel_sales WHERE id = $1", [id])).rows[0]?.rate_plan_id;
    await requirePublishableRatePlan(rp);
  }
  if (b.markupValue !== undefined) {
    const rp = (await pool.query("SELECT rate_plan_id FROM agency_hotel_sales WHERE id = $1", [id])).rows[0].rate_plan_id;
    if (!hasAtMostDecimals(b.markupValue, b.markupType === "fixed" ? await currencyDigitsOfRatePlan(rp) : 3))
      throw httpError(400, "INVALID_PUBLICATION", { reason: "MARKUP_PRECISION" });
  }
  const { sets, values } = patchSet({ ...b, markupValue: b.markupValue === undefined ? undefined : normalizeDecimal(b.markupValue) },
                                    { active: "active", markupType: "markup_type", markupValue: "markup_value" });
  const row = await withTransaction(async client => {
    const before = await rowJson(client, "agency_hotel_sales", id);
    const r = (await client.query(`UPDATE agency_hotel_sales SET ${sets} WHERE id = $1 RETURNING id, agency_id, rate_plan_id, markup_type, markup_value, active`, [id, ...values])).rows[0];
    await audit(client, req.auth!.sub, owner.owner_agency_id, "publication.updated", "publication", id,
      { targetAgencyId: r.agency_id, before, after: await rowJson(client, "agency_hotel_sales", id) });
    return r;
  });
  res.json(row);
}));

// Active sub-agencies eligible for publication selectors. Master agencies only see
// sub-agencies already associated with hotels they own through publications.
adminRouter.get("/api/admin/publication-agencies", ...managers, h(async (req, res) => {
  const platformWide = isPlatformWide(req.auth!.role);
  const result = await pool.query(
    `SELECT a.id, a.name FROM agencies a
      WHERE a.type = 'sub' AND a.active
        AND ($1::boolean OR EXISTS (
          SELECT 1 FROM agency_hotel_sales s
          JOIN hotels h ON h.id = s.hotel_id
          WHERE s.agency_id = a.id AND h.owner_agency_id = $2
        ))
      ORDER BY a.name, a.id`,
    [platformWide, req.auth!.agencyId]
  );
  res.json({ items: result.rows });
}));

// Read-only lists for management selectors; never expose password hashes.
adminRouter.get("/api/admin/agencies", authenticate, roles("system_admin"), h(async (_req, res) => {
  const result = await pool.query("SELECT id, name, type, active FROM agencies ORDER BY name, id");
  res.json({ items: result.rows });
}));

adminRouter.get("/api/admin/users", authenticate, roles("system_admin"), h(async (_req, res) => {
  const result = await pool.query("SELECT id, email, role, agency_id, active FROM users ORDER BY email, id");
  res.json({ items: result.rows });
}));

// ---------------------------------------------------------------- agencies and users (system administrator)
adminRouter.post("/api/admin/agencies", authenticate, roles("system_admin"), h(async (req, res) => {
  const { name, type } = req.body || {};
  if (!text(name, 200) || !["master", "sub"].includes(type)) throw httpError(400, "INVALID_AGENCY");
  const id = randomUUID();
  await withTransaction(async client => {
    await client.query("INSERT INTO agencies(id,name,type) VALUES ($1,$2,$3)", [id, name.trim(), type]);
    await audit(client, req.auth!.sub, id, "agency.created", "agency", id, { targetAgencyId: id, after: await rowJson(client, "agencies", id) });
  });
  res.status(201).json({ id, name: name.trim(), type });
}));

adminRouter.patch("/api/admin/agencies/:id", authenticate, roles("system_admin"), h(async (req, res) => {
  const id = uuidParam(req), b = req.body || {};
  if (typeof b.active !== "boolean") throw httpError(400, "ACTIVE_REQUIRED");
  const row = await withTransaction(async client => {
    const before = await rowJson(client, "agencies", id);
    const r = (await client.query("UPDATE agencies SET active = $2 WHERE id = $1 RETURNING id, name, type, active", [id, b.active])).rows[0];
    if (!r) throw httpError(404, "NOT_FOUND");
    await audit(client, req.auth!.sub, id, b.active ? "agency.activated" : "agency.deactivated", "agency", id,
      { targetAgencyId: id, before, after: await rowJson(client, "agencies", id) });
    return r;
  });
  res.json(row);
}));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
adminRouter.post("/api/admin/users", authenticate, roles("system_admin"), h(async (req, res) => {
  const { email, password, role, agencyId } = req.body || {};
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim()) || typeof password !== "string" || password.length < 12
      || !["system_admin", "back_office", "master_agency", "sub_agency"].includes(role)) throw httpError(400, "INVALID_USER");
  const platform = role === "system_admin" || role === "back_office";
  if (platform && agencyId != null) throw httpError(400, "PLATFORM_ROLE_HAS_NO_AGENCY");
  if (!platform && typeof agencyId !== "string") throw httpError(400, "AGENCY_REQUIRED");
  if (!platform) {
    const agency = (await pool.query("SELECT type FROM agencies WHERE id::text = $1", [agencyId])).rows[0];
    if (!agency) throw httpError(400, "AGENCY_NOT_FOUND");
    if (agency.type !== (role === "master_agency" ? "master" : "sub")) throw httpError(400, "ROLE_AGENCY_TYPE_MISMATCH");
  }
  const id = randomUUID();
  await withTransaction(async client => {
    const dup = await client.query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [email.trim()]);
    if (dup.rowCount) throw httpError(409, "EMAIL_ALREADY_EXISTS");
    await client.query("INSERT INTO users(id, email, password_hash, role, agency_id) VALUES ($1,$2,$3,$4,$5)",
      [id, email.trim().toLowerCase(), hashPassword(password), role, platform ? null : agencyId]);
    await audit(client, req.auth!.sub, platform ? null : agencyId, "user.created", "user", id,
      { targetAgencyId: platform ? null : agencyId, after: await rowJson(client, "users", id) });
  });
  res.status(201).json({ id, email: email.trim().toLowerCase(), role, agencyId: platform ? null : agencyId });
}));

adminRouter.patch("/api/admin/users/:id", authenticate, roles("system_admin"), h(async (req, res) => {
  const id = uuidParam(req), b = req.body || {};
  if (typeof b.active !== "boolean") throw httpError(400, "ACTIVE_REQUIRED");
  const row = await withTransaction(async client => {
    const before = await rowJson(client, "users", id);
    const r = (await client.query(
      "UPDATE users SET active = $2, token_version = token_version + 1 WHERE id = $1 RETURNING id, email, role, agency_id, active", [id, b.active])).rows[0];
    if (!r) throw httpError(404, "NOT_FOUND");
    await audit(client, req.auth!.sub, r.agency_id, b.active ? "user.activated" : "user.deactivated", "user", id,
      { targetAgencyId: r.agency_id, before, after: await rowJson(client, "users", id) });
    return r;
  });
  res.json(row);
}));
