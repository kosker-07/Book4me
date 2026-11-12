// Sales report and integration readiness.
// Sales: platform roles see every booking; a DMC sees the bookings on its own hotels (as seller) and the bookings of
// its own sub-agencies (as buyer). A buyer from another DMC is shown as "Marketplace" — identities stay hidden.
// Totals are converted to EUR with the rate frozen in each booking's price snapshot. CSV export with the same rows.
// Integrations: a registry of supplier connections (no external calls yet), system_admin only.
import { Router } from "express";
import { pool, withTransaction } from "./db";
import { audit, authenticate, AuthedRequest, httpError, isPlatformWide, roles, uuidParam } from "./http";
import { h, managers } from "./admin-routes";
import { isCalendarDate, UUID_RE } from "./validation";

export const reportRouter = Router();
const STATUSES = ["pending", "approved", "rejected", "cancelled", "draft", "awaiting_credit_approval"];
const MAX_ROWS = 5000;

interface Filters { from: string | null; to: string | null; status: string | null; hotelId: string | null }
function filters(q: Record<string, unknown>): Filters {
  const str = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
  const f = { from: str(q.from), to: str(q.to), status: str(q.status), hotelId: str(q.hotelId) };
  if ((f.from && !isCalendarDate(f.from)) || (f.to && !isCalendarDate(f.to)) || (f.from && f.to && f.to < f.from)
      || (f.status && !STATUSES.includes(f.status)) || (f.hotelId && !UUID_RE.test(f.hotelId))) throw httpError(400, "INVALID_REPORT_FILTER");
  return f;
}

async function salesRows(req: AuthedRequest, f: Filters) {
  const platform = isPlatformWide(req.auth!.role), dmc = req.auth!.agencyId ?? null;
  const rows = (await pool.query(
    `SELECT b.booking_no, b.status, b.check_in::text, b.check_out::text, b.room_count, b.created_at,
            b.total::text AS total, b.currency, h.name AS hotel_name,
            CASE WHEN $1::boolean OR a.id = $2 OR a.parent_agency_id = $2 THEN a.name ELSE 'Marketplace' END AS buyer,
            CASE WHEN $1::boolean THEN o.name WHEN h.owner_agency_id = $2 THEN 'Own hotel' ELSE 'Marketplace' END AS seller,
            CASE WHEN s.booking_id IS NULL THEN NULL ELSE round(s.total * s.eur_per_unit, 2)::text END AS total_eur
       FROM bookings b JOIN hotels h ON h.id = b.hotel_id JOIN agencies a ON a.id = b.agency_id JOIN agencies o ON o.id = h.owner_agency_id
       LEFT JOIN booking_price_snapshots s ON s.booking_id = b.id
      WHERE ($1::boolean OR h.owner_agency_id = $2 OR a.parent_agency_id = $2)
        AND ($1::boolean OR h.owner_agency_id <> $2 OR b.status <> 'awaiting_credit_approval' OR a.parent_agency_id = $2)
        AND ($3::date IS NULL OR b.check_in >= $3::date) AND ($4::date IS NULL OR b.check_in <= $4::date)
        AND ($5::text IS NULL OR b.status = $5) AND ($6::uuid IS NULL OR b.hotel_id = $6)
      ORDER BY b.check_in, b.booking_no LIMIT ${MAX_ROWS + 1}`,
    [platform, dmc, f.from, f.to, f.status, f.hotelId])).rows;
  if (rows.length > MAX_ROWS) throw httpError(413, "REPORT_TOO_LARGE");
  return rows;
}

function totals(rows: any[]) {
  const counted = rows.filter(r => r.status !== "cancelled" && r.status !== "rejected");
  const eur = counted.reduce((s, r) => s + (r.total_eur === null ? 0 : Math.round(Number(r.total_eur) * 100)), 0);
  return { bookings: rows.length, countedBookings: counted.length, totalEur: (eur / 100).toFixed(2), missingRate: counted.filter(r => r.total_eur === null).length };
}

reportRouter.get("/api/reports/sales", ...managers, h(async (req, res) => {
  const rows = await salesRows(req, filters(req.query as Record<string, unknown>));
  res.json({ items: rows, totals: totals(rows) });
}));

const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // no spreadsheet formulas from data
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
reportRouter.get("/api/reports/sales.csv", ...managers, h(async (req, res) => {
  const rows = await salesRows(req, filters(req.query as Record<string, unknown>));
  const cols = ["booking_no", "status", "check_in", "check_out", "room_count", "hotel_name", "seller", "buyer", "total", "currency", "total_eur", "created_at"];
  const body = [cols.join(","), ...rows.map(r => cols.map(c => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";
  res.setHeader("Content-Disposition", 'attachment; filename="bed4book-sales.csv"');
  res.type("text/csv; charset=utf-8").send("﻿" + body);
}));

// ---------------------------------------------------------------- integrations (system_admin only)
const adminOnly = [authenticate, roles("system_admin")] as const;
const KINDS = ["hotel_api", "channel_manager", "flight", "transfer", "payment", "other"];
const CONN_COLS = "id, kind, name, status, last_error, last_run_at, created_at, updated_at";

reportRouter.get("/api/integrations", ...adminOnly, h(async (_req, res) => {
  res.json({ items: (await pool.query(`SELECT ${CONN_COLS} FROM supplier_connections ORDER BY name, id`)).rows });
}));

reportRouter.post("/api/integrations", ...adminOnly, h(async (req, res) => {
  const b = req.body || {};
  if (Object.keys(b).some(k => k !== "kind" && k !== "name") || !KINDS.includes(b.kind) || typeof b.name !== "string" || !b.name.trim() || b.name.length > 200)
    throw httpError(400, "INVALID_INTEGRATION");
  const row = await withTransaction(async client => {
    const r = (await client.query(`INSERT INTO supplier_connections(kind, name) VALUES ($1,$2) RETURNING ${CONN_COLS}`, [b.kind, b.name.trim()])).rows[0];
    await audit(client, req.auth!.sub, null, "integration.created", "supplier_connection", r.id, { after: r });
    return r;
  });
  res.status(201).json(row);
}));

reportRouter.patch("/api/integrations/:id", ...adminOnly, h(async (req, res) => {
  const id = uuidParam(req), b = req.body || {};
  if (Object.keys(b).length !== 1 || !["disabled", "active"].includes(b.status)) throw httpError(400, "INVALID_INTEGRATION");
  const row = await withTransaction(async client => {
    const before = (await client.query(`SELECT ${CONN_COLS} FROM supplier_connections WHERE id = $1`, [id])).rows[0];
    if (!before) throw httpError(404, "NOT_FOUND");
    const r = (await client.query(`UPDATE supplier_connections SET status = $2, updated_at = now() WHERE id = $1 RETURNING ${CONN_COLS}`, [id, b.status])).rows[0];
    await audit(client, req.auth!.sub, null, "integration.updated", "supplier_connection", id, { before, after: r });
    return r;
  });
  res.json(row);
}));
