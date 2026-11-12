// Excel contract import. Step 1 (preview): upload the workbook as raw bytes, nothing is written except the stored
// preview. Step 2 (confirm): with mandatory cancellation and payment terms, hotels/rooms/rate plans/contracts and
// nightly inventory are created or updated in one transaction. The loader is the platform's own code (no AI).
// Access: master_agency for its own DMC; system_admin/back_office on behalf of a DMC (ownerAgencyId).
// Another DMC's import answers exactly like a missing one (404).
import express, { Router } from "express";
import { createHash } from "node:crypto";
import { pool, withTransaction } from "./db";
import { audit, AuthedRequest, httpError, isPlatformWide, uuidParam } from "./http";
import { h, managers } from "./admin-routes";
import { validateRatePlanTerms } from "./validation";
import { readGridPreview } from "./contract-import/grid-reader";
import { HotelPlan, MAX_ROWS_PER_IMPORT, planHotel, rowCount } from "./contract-import/plan";
import { UUID_RE } from "./validation";

export const contractImportRouter = Router();
const MAX_BYTES = 10 * 1024 * 1024;
const raw = express.raw({ type: () => true, limit: MAX_BYTES + 1 });

async function ownerFor(req: AuthedRequest, requested: unknown): Promise<string> {
  if (!isPlatformWide(req.auth!.role)) return req.auth!.agencyId!;
  if (typeof requested !== "string" || !UUID_RE.test(requested)) throw httpError(400, "OWNER_AGENCY_REQUIRED");
  const dmc = (await pool.query("SELECT 1 FROM agencies WHERE id = $1 AND type = 'master'", [requested])).rowCount;
  if (!dmc) throw httpError(400, "OWNER_AGENCY_REQUIRED");
  return requested;
}

const scope = (req: AuthedRequest) => isPlatformWide(req.auth!.role)
  ? { sql: "true", params: [] as unknown[] } : { sql: "owner_agency_id = $2", params: [req.auth!.agencyId] };

function summarize(plans: HotelPlan[]) {
  return plans.map((p, index) => ({
    index, name: p.name, region: p.region, concept: p.concept, currency: p.currency, validFrom: p.validFrom, validTo: p.validTo,
    rooms: p.rooms.map(r => ({ name: r.name, nights: r.dates.length, firstNight: r.dates[0], lastNight: r.dates[r.dates.length - 1],
      minPrice: Math.min(...r.prices.map(Number)).toFixed(2), maxPrice: Math.max(...r.prices.map(Number)).toFixed(2) })),
    errors: p.errors, warnings: p.warnings
  }));
}

contractImportRouter.post("/api/contracts/import/preview", ...managers, raw, h(async (req, res) => {
  const owner = await ownerFor(req, req.query.ownerAgencyId);
  const file = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!file.length) throw httpError(400, "FILE_REQUIRED");
  if (file.length > MAX_BYTES) throw httpError(413, "FILE_TOO_LARGE");
  let grid;
  try { grid = readGridPreview(file); }
  catch (e) { const code = String((e as Error).message); throw httpError(422, code === "FILE_TOO_LARGE" ? code : "INVALID_XLSX"); }
  const plans = grid.hotels.map(planHotel);
  if (!plans.length) throw httpError(422, "NO_HOTELS_FOUND", { skipped: grid.skipped });
  if (rowCount(plans) > MAX_ROWS_PER_IMPORT) throw httpError(413, "TOO_MANY_NIGHTS");
  const sha = createHash("sha256").update(file).digest("hex");
  const done = (await pool.query("SELECT id FROM contract_imports WHERE owner_agency_id = $1 AND file_sha256 = $2 AND status = 'confirmed'", [owner, sha])).rows[0];
  if (done) throw httpError(409, "DUPLICATE_IMPORT", { importId: done.id });
  let fileName = String(req.headers["x-file-name"] ?? "");
  try { fileName = decodeURIComponent(fileName); } catch { /* keep as sent */ }
  fileName = fileName.slice(0, 200);
  const id = (await pool.query(
    "INSERT INTO contract_imports(owner_agency_id, uploaded_by, file_name, file_sha256, preview) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [owner, req.auth!.sub, fileName, sha, JSON.stringify({ plans, skipped: grid.skipped, readerWarnings: grid.warnings })])).rows[0].id;
  res.status(201).json({ importId: id, sha256: sha, hotels: summarize(plans), skipped: grid.skipped, readerWarnings: grid.warnings.slice(0, 500) });
}));

contractImportRouter.get("/api/contracts/imports", ...managers, h(async (req, res) => {
  const s = scope(req);
  const rows = (await pool.query(
    `SELECT id, owner_agency_id, file_name, status, created_at, confirmed_at, result FROM contract_imports
      WHERE ${s.sql === "true" ? "true" : "owner_agency_id = $1"} ORDER BY created_at DESC LIMIT 100`, s.sql === "true" ? [] : s.params)).rows;
  res.json({ items: rows });
}));

contractImportRouter.post("/api/contracts/import/:id/confirm", ...managers, h(async (req, res) => {
  const id = uuidParam(req, "IMPORT_NOT_FOUND"), s = scope(req), b = req.body || {};
  const imp = (await pool.query(`SELECT * FROM contract_imports WHERE id = $1 AND ${s.sql}`, [id, ...s.params])).rows[0];
  if (!imp) throw httpError(404, "IMPORT_NOT_FOUND");
  if (imp.status === "confirmed") throw httpError(409, "ALREADY_CONFIRMED");
  const errors: Record<string, string> = {};
  if (!validateRatePlanTerms(b.cancellationPolicy, b.paymentTerms, errors)) throw httpError(400, "INVALID_RATE_PLAN_TERMS", { fields: errors });
  const plans: HotelPlan[] = imp.preview.plans;
  let selected: number[] = plans.map((_, i) => i);
  if (b.hotels !== undefined) {
    if (!Array.isArray(b.hotels) || !b.hotels.length || b.hotels.some((i: unknown) => !Number.isInteger(i) || (i as number) < 0 || (i as number) >= plans.length))
      throw httpError(400, "INVALID_HOTEL_SELECTION");
    selected = [...new Set(b.hotels as number[])];
  }
  const owner = (await pool.query("SELECT name FROM agencies WHERE id = $1", [imp.owner_agency_id])).rows[0];
  const code = "XLS-" + String(imp.file_sha256).slice(0, 12).toUpperCase();
  const result = await withTransaction(async (client): Promise<{ hotels: unknown[]; skipped: unknown[] }> => {
    const lock = await client.query("UPDATE contract_imports SET status = 'confirmed', confirmed_at = now() WHERE id = $1 AND status = 'preview' RETURNING id", [id]);
    if (!lock.rowCount) throw httpError(409, "ALREADY_CONFIRMED");
    const hotels: unknown[] = [], skipped: unknown[] = [];
    for (const index of selected) {
      const p = plans[index]!;
      if (p.errors.some(e => e.code === "INVALID_CURRENCY" || e.code === "NO_HOTEL_NAME") || !p.rooms.length) { skipped.push({ index, name: p.name, reason: "NOTHING_TO_IMPORT" }); continue; }
      if (!(await client.query("SELECT 1 FROM currencies WHERE code = $1 AND active", [p.currency])).rowCount) { skipped.push({ index, name: p.name, reason: "CURRENCY_NOT_SUPPORTED" }); continue; }
      let hotel = (await client.query("SELECT id FROM hotels WHERE owner_agency_id = $1 AND lower(name) = lower($2) ORDER BY created_at LIMIT 1", [imp.owner_agency_id, p.name])).rows[0];
      const createdHotel = !hotel;
      if (!hotel) hotel = (await client.query("INSERT INTO hotels(owner_agency_id, name, location, status) VALUES ($1,$2,$3,'draft') RETURNING id", [imp.owner_agency_id, p.name, p.region || "-"])).rows[0];
      const contract = (await client.query(
        `INSERT INTO hotel_contracts(hotel_id, code, name, currency, valid_from, valid_to, seller_legal_name, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active')
         ON CONFLICT (hotel_id, code) DO UPDATE SET updated_at = now() RETURNING id`,
        [hotel.id, code, (imp.file_name || "Excel import").slice(0, 200), p.currency, p.validFrom, p.validTo, owner?.name ?? ""])).rows[0];
      let nightsWritten = 0, ratePlans = 0;
      for (const r of p.rooms) {
        let room = (await client.query("SELECT id FROM rooms WHERE hotel_id = $1 AND lower(name) = lower($2) LIMIT 1", [hotel.id, r.name])).rows[0];
        if (!room) room = (await client.query("INSERT INTO rooms(hotel_id, name) VALUES ($1,$2) RETURNING id", [hotel.id, r.name])).rows[0];
        let plan = (await client.query(
          "SELECT p.id FROM rate_plans p JOIN contract_rate_plans c ON c.rate_plan_id = p.id WHERE p.room_id = $1 AND c.contract_id = $2 LIMIT 1", [room.id, contract.id])).rows[0];
        if (!plan) {
          plan = (await client.query(
            `INSERT INTO rate_plans(room_id, board_name, currency, cancellation_policy, payment_terms, sales_conditions)
             VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb) RETURNING id`,
            [room.id, (p.concept || "Contract rate").slice(0, 200), p.currency, JSON.stringify(b.cancellationPolicy), JSON.stringify(b.paymentTerms),
             JSON.stringify({ source: "excel-import", importId: id, occupancyPrices: r.occupancyPrices })])).rows[0];
          await client.query("INSERT INTO contract_rate_plans(rate_plan_id, contract_id) VALUES ($1,$2)", [plan.id, contract.id]);
          ratePlans++;
        }
        await client.query(
          `INSERT INTO inventory_daily(rate_plan_id, stay_date, price, allotment)
           SELECT $1, d, p, a FROM unnest($2::date[], $3::numeric[], $4::int[]) AS t(d, p, a)
           ON CONFLICT (rate_plan_id, stay_date) DO UPDATE SET price = EXCLUDED.price, allotment = GREATEST(EXCLUDED.allotment, inventory_daily.reserved)`,
          [plan.id, r.dates, r.prices, r.allotments]);
        nightsWritten += r.dates.length;
      }
      hotels.push({ index, name: p.name, hotelId: hotel.id, createdHotel, contractId: contract.id, rooms: p.rooms.length, ratePlans, nights: nightsWritten });
    }
    const out = { hotels, skipped };
    await client.query("UPDATE contract_imports SET result = $2 WHERE id = $1", [id, JSON.stringify(out)]);
    await audit(client, req.auth!.sub, imp.owner_agency_id, "contract_import.confirmed", "contract_import", id, { targetAgencyId: imp.owner_agency_id, after: out });
    return out;
  }).catch((e: any) => { if (e?.code === "23505") throw httpError(409, "DUPLICATE_IMPORT"); throw e; });
  res.json({ importId: id, ...result });
}));
