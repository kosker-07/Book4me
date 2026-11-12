// Finance ledger, read side. Postings happen in the database (migration 050) when a booking is approved or reversed.
// Platform roles read the operator book or any DMC's book. A DMC reads its own book in full and, from the operator
// book, only its own lines — never the counterpart DMC or BED4BOOK's margin. Sub-agencies have no access.
import { Router } from "express";
import { pool } from "./db";
import { AuthedRequest, httpError, isPlatformWide } from "./http";
import { h, managers } from "./admin-routes";
import { isCalendarDate, UUID_RE } from "./validation";

export const financeRouter = Router();

interface Scope { book: string | null; onlyParty: string | null }
async function scopeOf(req: AuthedRequest): Promise<Scope> {
  const q = typeof req.query.book === "string" ? req.query.book : "";
  if (isPlatformWide(req.auth!.role)) {
    if (!q || q === "operator") return { book: null, onlyParty: null };
    if (!UUID_RE.test(q) || !(await pool.query("SELECT 1 FROM agencies WHERE id = $1 AND type = 'master'", [q])).rowCount) throw httpError(404, "NOT_FOUND");
    return { book: q, onlyParty: null };
  }
  const own = req.auth!.agencyId!;
  if (!q || q === "own") return { book: own, onlyParty: null };
  if (q === "operator") return { book: null, onlyParty: own };
  throw httpError(404, "NOT_FOUND");   // another DMC's book answers like a missing one
}
function dates(req: AuthedRequest) {
  const from = typeof req.query.from === "string" && req.query.from ? req.query.from : null;
  const to = typeof req.query.to === "string" && req.query.to ? req.query.to : null;
  if ((from && !isCalendarDate(from)) || (to && !isCalendarDate(to)) || (from && to && to < from)) throw httpError(400, "INVALID_DATE_RANGE");
  return { from, to };
}
const PARTY = `CASE WHEN l.party_kind = 'platform_revenue' THEN 'BED4BOOK revenue' ELSE pa.name END`;

financeRouter.get("/api/finance/ledger", ...managers, h(async (req, res) => {
  const s = await scopeOf(req), d = dates(req);
  const rows = (await pool.query(
    `SELECT e.id AS entry_id, e.kind, e.reverses_id, e.description, e.currency, e.posted_at, b.booking_no,
            l.party_kind, l.party_agency_id, ${PARTY} AS party_name, round(l.debit, cur.minor_units)::text AS debit, round(l.credit, cur.minor_units)::text AS credit
       FROM ledger_entries e JOIN ledger_lines l ON l.entry_id = e.id JOIN currencies cur ON cur.code = e.currency
       LEFT JOIN agencies pa ON pa.id = l.party_agency_id LEFT JOIN bookings b ON b.id = e.booking_id
      WHERE e.book_owner_id IS NOT DISTINCT FROM $1 AND ($2::uuid IS NULL OR l.party_agency_id = $2)
        AND ($3::date IS NULL OR e.posted_at >= $3::date) AND ($4::date IS NULL OR e.posted_at < $4::date + 1)
      ORDER BY e.posted_at, e.id, l.id LIMIT 5000`, [s.book, s.onlyParty, d.from, d.to])).rows;
  const entries: any[] = [];
  for (const r of rows) {
    let e = entries[entries.length - 1];
    if (!e || e.id !== r.entry_id) entries.push(e = { id: r.entry_id, kind: r.kind, reversesId: r.reverses_id, description: r.description,
      currency: String(r.currency).trim(), postedAt: r.posted_at, bookingNo: r.booking_no, lines: [] });
    e.lines.push({ partyKind: r.party_kind, partyId: r.party_agency_id, party: r.party_name, debit: r.debit, credit: r.credit });
  }
  res.json({ book: s.book ?? "operator", entries });
}));

financeRouter.get("/api/finance/balances", ...managers, h(async (req, res) => {
  const s = await scopeOf(req);
  const rows = (await pool.query(
    `SELECT l.party_kind, l.party_agency_id, ${PARTY} AS party_name, e.currency,
            round(sum(l.debit), cur.minor_units)::text AS debit, round(sum(l.credit), cur.minor_units)::text AS credit,
            round(sum(l.debit) - sum(l.credit), cur.minor_units)::text AS balance
       FROM ledger_entries e JOIN ledger_lines l ON l.entry_id = e.id JOIN currencies cur ON cur.code = e.currency LEFT JOIN agencies pa ON pa.id = l.party_agency_id
      WHERE e.book_owner_id IS NOT DISTINCT FROM $1 AND ($2::uuid IS NULL OR l.party_agency_id = $2)
      GROUP BY l.party_kind, l.party_agency_id, pa.name, e.currency, cur.minor_units ORDER BY party_name, e.currency`, [s.book, s.onlyParty])).rows;
  res.json({ book: s.book ?? "operator", items: rows.map(r => ({ ...r, currency: String(r.currency).trim() })) });
}));
