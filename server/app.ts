import express, { NextFunction, Request, Response } from "express";
import type { PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { pool, withTransaction } from "./db";
import { issueSession, SessionClaims, verifyPassword, verifySession } from "./security";
import { Candidate, chooseWinners, fromCents, nightlySellCents, priceCandidate, toCents } from "./pricing";
import { FieldErrors, nightsBetween, UUID_RE, validateGuest, validateOccupancy, validateStay } from "./validation";
import { signQuote, verifyQuote } from "./quotes";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const sessionSecret = process.env.SESSION_SECRET || "";
type Role = SessionClaims["role"];
type AuthedRequest = Request & { auth?: SessionClaims };
const httpError = (status: number, message: string, extra?: object) => Object.assign(new Error(message), { status, extra });

const roles = (...allowed: Role[]) => (req: AuthedRequest, res: Response, next: NextFunction) => {
  if (!req.auth || !allowed.includes(req.auth.role)) return res.status(403).json({ error: "FORBIDDEN" });
  next();
};
const authenticate = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const claims = verifySession(token, sessionSecret);
  if (!claims) return res.status(401).json({ error: "UNAUTHENTICATED" });
  try {
    const result = await pool.query("SELECT id, role, agency_id, active FROM users WHERE id = $1", [claims.sub]);
    const user = result.rows[0];
    if (!user || !user.active || user.role !== claims.role || user.agency_id !== claims.agencyId)
      return res.status(401).json({ error: "SESSION_REVOKED" });
    req.auth = claims;
    next();
  } catch (error) { next(error); }
};
const requireAgency = (req: AuthedRequest, res: Response, next: NextFunction) => {
  if (!req.auth || !req.auth.agencyId) return res.status(403).json({ error: "AGENCY_CONTEXT_REQUIRED" });
  next();
};
const uuidParam = (req: Request) => {
  const id = String(req.params.id || "");
  if (!UUID_RE.test(id)) throw httpError(404, "BOOKING_NOT_FOUND");
  return id;
};
/** Platform-wide roles: system administrator and Back Office (not bound to any agency tenant). */
const isPlatformWide = (role: Role) => role === "system_admin" || role === "back_office";

const audit = async (client: any, actorId: string, agencyId: string | null, action: string, entityType: string, entityId: string) => {
  await client.query(
    "INSERT INTO audit_logs(actor_id, agency_id, action, entity_type, entity_id) VALUES ($1,$2,$3,$4,$5)",
    [actorId, agencyId, action, entityType, entityId]
  );
};

app.get("/health", (_req, res) => res.json({ ok: true, service: "bed4book-api" }));

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password) return res.status(400).json({ error: "EMAIL_AND_PASSWORD_REQUIRED" });
    const result = await pool.query(
      "SELECT id, email, password_hash, role, agency_id, active FROM users WHERE lower(email) = $1 LIMIT 1",
      [email]
    );
    const user = result.rows[0];
    if (!user || !user.active || !verifyPassword(password, user.password_hash))
      return res.status(401).json({ error: "INVALID_CREDENTIALS" });
    const token = issueSession({ sub: user.id, role: user.role, agencyId: user.agency_id }, sessionSecret);
    res.json({ token, tokenType: "Bearer", expiresIn: 28800, user: { id: user.id, email: user.email, role: user.role, agencyId: user.agency_id } });
  } catch (error) { next(error); }
});

app.get("/api/me", authenticate, (req: AuthedRequest, res) => {
  res.json({ userId: req.auth!.sub, role: req.auth!.role, agencyId: req.auth!.agencyId });
});

// Platform administrators create agencies and user accounts. Passwords are provisioned out-of-band.
app.post("/api/admin/agencies", authenticate, roles("system_admin"), async (req: AuthedRequest, res, next) => {
  try {
    const { name, type } = req.body || {};
    if (typeof name !== "string" || !name.trim() || !["master", "sub"].includes(type))
      return res.status(400).json({ error: "INVALID_AGENCY" });
    const id = randomUUID();
    await withTransaction(async client => {
      await client.query("INSERT INTO agencies(id,name,type) VALUES ($1,$2,$3)", [id, name.trim(), type]);
      await audit(client, req.auth!.sub, null, "agency.created", "agency", id);
    });
    res.status(201).json({ id, name: name.trim(), type });
  } catch (error) { next(error); }
});

// Master agency and platform admin can create hotel records. Tenant ownership is server-derived.
app.post("/api/admin/hotels", authenticate, roles("system_admin", "master_agency"), async (req: AuthedRequest, res, next) => {
  try {
    const { name, location, category, description, amenities, images, operationalNotes } = req.body || {};
    if (typeof name !== "string" || !name.trim() || typeof location !== "string" || !location.trim())
      return res.status(400).json({ error: "HOTEL_NAME_AND_LOCATION_REQUIRED" });
    const ownerAgencyId = req.auth!.role === "system_admin" ? req.body.ownerAgencyId : req.auth!.agencyId;
    if (!ownerAgencyId) return res.status(400).json({ error: "OWNER_AGENCY_REQUIRED" });
    const id = randomUUID();
    await withTransaction(async client => {
      await client.query(
        `INSERT INTO hotels(id, owner_agency_id, name, location, category, description, amenities, images, operational_notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
        [id, ownerAgencyId, name.trim(), location.trim(), category || null, description || "", JSON.stringify(amenities || []), JSON.stringify(images || []), operationalNotes || ""]
      );
      await audit(client, req.auth!.sub, ownerAgencyId, "hotel.created", "hotel", id);
    }, ownerAgencyId);
    res.status(201).json({ id, ownerAgencyId, name: name.trim(), status: "draft" });
  } catch (error) { next(error); }
});

// A sub-agency sees only hotels explicitly published to that agency.
app.get("/api/agency/hotels", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT h.id, h.name, h.location, h.category, h.description, h.amenities, h.images
       FROM hotels h
       JOIN agency_hotel_sales s ON s.hotel_id = h.id
       WHERE s.agency_id = $1 AND s.active = true AND h.status = 'active'
       ORDER BY h.name`,
      [req.auth!.agencyId]
    );
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

// ---------------------------------------------------------------------------------------------
// Search (read-only). Writes nothing: no booking, no inventory change, no hold record.
// Returns exactly one winner per equivalence key; losing offers are discarded and never returned.
// ---------------------------------------------------------------------------------------------
interface CandidateRow {
  rate_plan_id: string; board_name: string; currency: string; cancellation_policy: unknown; payment_terms: unknown;
  room_id: string; room_name: string; max_adults: number; max_children: number;
  hotel_id: string; hotel_name: string; location: string; category: string | null;
  markup_type: "percent" | "fixed"; markup_value: string; nights: { date: string; price: string }[];
}

/** Published, active, bookable rate plans for an agency with allotment for every night. Optionally one rate plan only. */
async function loadCandidates(db: { query: PoolClient["query"] }, agencyId: string, checkIn: string, checkOut: string, rooms: number, onlyRatePlanId?: string) {
  const nights = nightsBetween(checkIn, checkOut).length;
  const result = await db.query(
    `SELECT rp.id AS rate_plan_id, rp.board_name, rp.currency, rp.cancellation_policy, rp.payment_terms,
            r.id AS room_id, r.name AS room_name, r.max_adults, r.max_children,
            h.id AS hotel_id, h.name AS hotel_name, h.location, h.category,
            s.markup_type, s.markup_value::text AS markup_value,
            json_agg(json_build_object('date', d.stay_date::text, 'price', d.price::text) ORDER BY d.stay_date) AS nights
       FROM agency_hotel_sales s
       JOIN agencies sa ON sa.id = s.agency_id AND sa.active
       JOIN rate_plans rp ON rp.id = s.rate_plan_id AND rp.active
       JOIN rooms r ON r.id = rp.room_id AND r.active
       JOIN hotels h ON h.id = r.hotel_id AND h.status = 'active'
       JOIN inventory_daily d ON d.rate_plan_id = rp.id
            AND d.stay_date >= $2::date AND d.stay_date < $3::date AND d.allotment - d.reserved >= $4
      WHERE s.agency_id = $1 AND s.active AND ($6::uuid IS NULL OR rp.id = $6::uuid)
      GROUP BY rp.id, r.id, h.id, s.markup_type, s.markup_value
     HAVING count(*) = $5`,
    [agencyId, checkIn, checkOut, rooms, nights, onlyRatePlanId ?? null]
  );
  return result.rows as CandidateRow[];
}

const fitsOccupancy = (row: CandidateRow, rooms: number, adults: number, children: number) =>
  adults <= row.max_adults * rooms && children <= row.max_children * rooms;

const toCandidate = (row: CandidateRow): Candidate => ({
  ratePlanId: row.rate_plan_id, hotelId: row.hotel_id, roomId: row.room_id, board: row.board_name,
  cancellationPolicy: row.cancellation_policy, paymentTerms: row.payment_terms, currency: row.currency.trim(),
  markup: { type: row.markup_type, value: row.markup_value },
  nights: row.nights.map(n => ({ date: n.date, netPrice: n.price }))
});

async function loadFxRates(db: { query: PoolClient["query"] }) {
  const rows = (await db.query("SELECT currency, eur_per_unit::float8 AS rate FROM fx_rates")).rows;
  return new Map<string, number>(rows.map((r: any) => [String(r.currency).trim(), Number(r.rate)]));
}

app.post("/api/agency/searches", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  try {
    const errors: FieldErrors = {};
    const stay = validateStay(req.body, errors);
    if (!stay) return res.status(400).json({ error: "VALIDATION_FAILED", fields: errors });
    const agencyId = req.auth!.agencyId!;
    const occupancy = { adults: stay.adults, children: stay.children, childAges: stay.childAges };
    const [rows, fx] = await Promise.all([
      loadCandidates(pool, agencyId, stay.checkIn, stay.checkOut, stay.rooms),
      loadFxRates(pool)
    ]);
    const byRatePlan = new Map(rows.map(r => [r.rate_plan_id, r]));
    const offers = rows
      .filter(r => fitsOccupancy(r, stay.rooms, stay.adults, stay.children))
      .map(r => priceCandidate(toCandidate(r), occupancy, stay.checkIn, stay.checkOut, stay.rooms, fx));
    const results = chooseWinners(offers).map(w => {
      const row = byRatePlan.get(w.ratePlanId)!;
      return {
        quoteId: signQuote({ agencyId, ratePlanId: w.ratePlanId, ...stay, totalCents: w.totalCents, currency: w.currency }, sessionSecret),
        hotel: { id: row.hotel_id, name: row.hotel_name, location: row.location, category: row.category },
        room: { name: row.room_name },
        board: row.board_name,
        cancellationPolicy: row.cancellation_policy,
        paymentTerms: row.payment_terms,
        checkIn: stay.checkIn, checkOut: stay.checkOut, rooms: stay.rooms,
        nights: w.nights.map((n, i) => ({ date: n.date, price: fromCents(w.nightSellCents[i]!) })),
        total: fromCents(w.totalCents),
        currency: w.currency
      };
    });
    res.json({ results });
  } catch (error) { next(error); }
});

// ---------------------------------------------------------------------------------------------
// Booking creation. No explicit inventory lock or hold: each night is decremented with one atomic
// conditional UPDATE, in ascending date order; any failure rolls the whole transaction back.
// Only the quoted (winning) rate plan is re-checked; no other offer is ever tried.
// Current product behaviour: allotment is decremented when the booking request is created (pending).
// ---------------------------------------------------------------------------------------------
app.post("/api/agency/bookings", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  const agencyId = req.auth!.agencyId!;
  const idempotencyKey = String(req.header("Idempotency-Key") || "");
  if (!idempotencyKey || idempotencyKey.length > 128) return res.status(400).json({ error: "IDEMPOTENCY_KEY_REQUIRED" });

  // All nine guest fields are mandatory. Occupancy lives in the guest object; dates and rooms come from the signed quote.
  const errors: FieldErrors = {};
  const guest = validateGuest(req.body, errors);
  const occupancy = validateOccupancy(req.body?.guest, errors, "guest.");
  if (!req.body?.quoteId) errors.quoteId = "REQUIRED";
  if (!guest || !occupancy || Object.keys(errors).length) return res.status(400).json({ error: "VALIDATION_FAILED", fields: errors });
  const { adults, children, childAges } = occupancy;

  const checked = verifyQuote(req.body.quoteId, sessionSecret);
  if (!checked.ok) return res.status(checked.error === "QUOTE_EXPIRED" ? 409 : 400).json({ error: checked.error });
  const q = checked.quote;
  if (q.agencyId !== agencyId) return res.status(404).json({ error: "PRODUCT_NOT_PUBLISHED" });
  const sameAges = [...childAges].sort((a, b) => a - b).join(",") === [...q.childAges].sort((a, b) => a - b).join(",");
  if (adults !== q.adults || children !== q.children || !sameAges)
    return res.status(409).json({ error: "QUOTE_OCCUPANCY_MISMATCH" });

  const requestHash = createHash("sha256").update(JSON.stringify({ quoteId: req.body.quoteId, guest: req.body.guest, operationNote: req.body.operationNote })).digest("hex");
  try {
    const result = await withTransaction(async client => {
      // Claim the idempotency key first. A concurrent request with the same key waits on the unique
      // index and then replays the committed response instead of creating a second booking.
      const claim = await client.query(
        "INSERT INTO idempotency_keys(agency_id, key, response, request_hash) VALUES ($1,$2,'{}'::jsonb,$3) ON CONFLICT DO NOTHING",
        [agencyId, idempotencyKey, requestHash]
      );
      if (claim.rowCount === 0) {
        const prior = await client.query("SELECT response, request_hash FROM idempotency_keys WHERE agency_id=$1 AND key=$2", [agencyId, idempotencyKey]);
        const row = prior.rows[0];
        if (row.request_hash && row.request_hash !== requestHash) throw httpError(422, "IDEMPOTENCY_KEY_REUSED");
        return { status: 201, body: row.response };
      }

      // Re-check only the quoted winner; never fall back to another rate plan.
      const sale = (await client.query(
        `SELECT s.markup_type, s.markup_value::text AS markup_value, rp.currency, h.id AS hotel_id, r.max_adults, r.max_children
           FROM agency_hotel_sales s
           JOIN agencies sa ON sa.id = s.agency_id AND sa.active
           JOIN rate_plans rp ON rp.id = s.rate_plan_id AND rp.active
           JOIN rooms r ON r.id = rp.room_id AND r.active
           JOIN hotels h ON h.id = r.hotel_id AND h.status = 'active'
          WHERE s.agency_id = $1 AND s.rate_plan_id = $2 AND s.active`,
        [agencyId, q.ratePlanId]
      )).rows[0];
      if (!sale) throw httpError(404, "PRODUCT_NOT_PUBLISHED");
      if (adults > sale.max_adults * q.rooms || children > sale.max_children * q.rooms) throw httpError(409, "OCCUPANCY_EXCEEDS_CAPACITY");

      const markup = { type: sale.markup_type, value: sale.markup_value };
      const nights: { date: string; inventoryId: string; netCents: number; sellCents: number }[] = [];
      for (const date of nightsBetween(q.checkIn, q.checkOut)) {
        const updated = await client.query(
          `UPDATE inventory_daily SET reserved = reserved + $3
            WHERE rate_plan_id = $1 AND stay_date = $2::date AND allotment - reserved >= $3
          RETURNING id, price::text AS price`,
          [q.ratePlanId, date, q.rooms]
        );
        if (updated.rowCount !== 1) throw httpError(409, "ALLOTMENT_UNAVAILABLE");
        const netCents = toCents(updated.rows[0].price);
        nights.push({ date, inventoryId: updated.rows[0].id, netCents, sellCents: nightlySellCents(netCents, markup) });
      }
      const totalCents = nights.reduce((s, n) => s + n.sellCents, 0) * q.rooms;
      if (totalCents !== q.totalCents || String(sale.currency).trim() !== q.currency) throw httpError(409, "PRICE_CHANGED");

      const bookingId = randomUUID();
      const seq = (await client.query("SELECT nextval('booking_no_seq') AS n")).rows[0].n;
      const bookingNo = `B4B-${String(seq).padStart(8, "0")}`;
      const total = fromCents(totalCents);
      await client.query(
        `INSERT INTO bookings(id, booking_no, agency_id, hotel_id, rate_plan_id, check_in, check_out, room_count, total, currency, status,
                              guest_first_name, guest_last_name, guest_email, guest_phone, guest_nationality, adults, children, child_ages, operation_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [bookingId, bookingNo, agencyId, sale.hotel_id, q.ratePlanId, q.checkIn, q.checkOut, q.rooms, total, q.currency,
         guest.firstName, guest.lastName, guest.email, guest.phone, guest.nationality, adults, children, childAges, guest.operationNote]
      );
      for (const n of nights)
        await client.query(
          `INSERT INTO booking_nights(booking_id, stay_date, inventory_id, rooms, net_price, markup_type, markup_value, sell_price, currency)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [bookingId, n.date, n.inventoryId, q.rooms, fromCents(n.netCents), markup.type, markup.value, fromCents(n.sellCents), q.currency]
        );
      await client.query("INSERT INTO booking_status_history(booking_id,from_status,to_status,actor_id,note) VALUES ($1,NULL,'pending',$2,'Created by sub-agency')", [bookingId, req.auth!.sub]);
      await audit(client, req.auth!.sub, agencyId, "booking.created", "booking", bookingId);
      const response = { id: bookingId, bookingNo, status: "pending", total, currency: q.currency };
      await client.query("UPDATE idempotency_keys SET response=$3::jsonb WHERE agency_id=$1 AND key=$2", [agencyId, idempotencyKey, JSON.stringify(response)]);
      return { status: 201, body: response };
    }, agencyId);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
});

// ---------------------------------------------------------------------------------------------
// Booking state changes. No SELECT ... FOR UPDATE: each transition is one conditional UPDATE that
// succeeds only from the expected status, so a booking can be released at most once.
// ---------------------------------------------------------------------------------------------
const RELEASING = new Set(["rejected", "cancelled"]);

/** Returns allotment of a booking that consumed inventory (pending/approved). Uses the nightly snapshot;
 *  bookings created before migration 002 have no snapshot and are released from their date range. */
async function releaseInventory(client: PoolClient, bookingId: string) {
  await client.query(
    `UPDATE inventory_daily d SET reserved = d.reserved - n.rooms
       FROM booking_nights n WHERE n.booking_id = $1 AND d.id = n.inventory_id`, [bookingId]);
  await client.query(
    `UPDATE inventory_daily d SET reserved = d.reserved - b.room_count
       FROM bookings b
      WHERE b.id = $1 AND d.rate_plan_id = b.rate_plan_id AND d.stay_date >= b.check_in AND d.stay_date < b.check_out
        AND NOT EXISTS (SELECT 1 FROM booking_nights n WHERE n.booking_id = b.id)`, [bookingId]);
}

/** Tries each allowed source status with a conditional UPDATE. `scope` limits which bookings the actor may touch. */
async function transition(client: PoolClient, opts: {
  bookingId: string; to: string; from: string[]; scopeSql: string; scopeParams: unknown[]; actorId: string; note: string;
}) {
  for (const from of opts.from) {
    const updated = await client.query(
      `UPDATE bookings b SET status = $2, updated_at = now()
        WHERE b.id = $1 AND b.status = $3 AND ${opts.scopeSql}
      RETURNING b.agency_id`,
      [opts.bookingId, opts.to, from, ...opts.scopeParams]
    );
    if (updated.rowCount === 1) {
      if (RELEASING.has(opts.to)) await releaseInventory(client, opts.bookingId);
      await client.query("INSERT INTO booking_status_history(booking_id,from_status,to_status,actor_id,note) VALUES ($1,$2,$3,$4,$5)",
        [opts.bookingId, from, opts.to, opts.actorId, opts.note]);
      await audit(client, opts.actorId, updated.rows[0].agency_id, `booking.${opts.to}`, "booking", opts.bookingId);
      return from;
    }
  }
  return null;
}

// Sub-agency: own bookings only.
app.get("/api/agency/bookings", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  try {
    const result = await pool.query(
      `SELECT b.id, b.booking_no, b.status, b.check_in::text, b.check_out::text, b.room_count, b.total, b.currency, b.created_at, h.name AS hotel_name
         FROM bookings b JOIN hotels h ON h.id = b.hotel_id
        WHERE b.agency_id = $1 ORDER BY b.created_at DESC LIMIT 500`, [req.auth!.agencyId]);
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

async function bookingDetail(bookingId: string, scopeSql: string, scopeParams: unknown[]) {
  const b = (await pool.query(
    `SELECT b.id, b.booking_no, b.status, b.agency_id, b.hotel_id, b.rate_plan_id, b.check_in::text, b.check_out::text, b.room_count,
            b.total, b.currency, b.guest_first_name, b.guest_last_name, b.guest_email, b.guest_phone, b.guest_nationality,
            b.adults, b.children, b.child_ages, b.operation_note, b.created_at, b.updated_at, h.name AS hotel_name
       FROM bookings b JOIN hotels h ON h.id = b.hotel_id
      WHERE b.id = $1 AND ${scopeSql}`, [bookingId, ...scopeParams])).rows[0];
  if (!b) return null;
  const nights = (await pool.query(
    "SELECT stay_date::text AS date, rooms, sell_price, currency FROM booking_nights WHERE booking_id=$1 ORDER BY stay_date", [bookingId])).rows;
  const history = (await pool.query(
    "SELECT from_status, to_status, actor_id, note, created_at FROM booking_status_history WHERE booking_id=$1 ORDER BY id", [bookingId])).rows;
  return { ...b, nights, history };
}

app.get("/api/agency/bookings/:id", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  try {
    const detail = await bookingDetail(uuidParam(req), "b.agency_id = $2", [req.auth!.agencyId]);
    if (!detail) return res.status(404).json({ error: "BOOKING_NOT_FOUND" });
    res.json(detail);
  } catch (error) { next(error); }
});

// Sub-agency may cancel only its own booking, and only while it is pending.
app.post("/api/agency/bookings/:id/cancel", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  try {
    const bookingId = uuidParam(req);
    const result = await withTransaction(async client => {
      const from = await transition(client, {
        bookingId, to: "cancelled", from: ["pending"], scopeSql: "b.agency_id = $4", scopeParams: [req.auth!.agencyId],
        actorId: req.auth!.sub, note: String(req.body?.note || "Cancelled by sub-agency")
      });
      if (from) return { id: bookingId, status: "cancelled" };
      const own = await client.query("SELECT status FROM bookings WHERE id=$1 AND agency_id=$2", [bookingId, req.auth!.agencyId]);
      if (!own.rowCount) throw httpError(404, "BOOKING_NOT_FOUND");
      throw httpError(409, "CANCEL_NOT_ALLOWED", { status: own.rows[0].status });
    }, req.auth!.agencyId);
    res.json(result);
  } catch (error) { next(error); }
});

// Back Office and system administrator: platform-wide. Master agency: bookings of its own hotels only.
const backofficeScope = (req: AuthedRequest) => isPlatformWide(req.auth!.role)
  ? { sql: "true", params: [] as unknown[] }
  : { sql: "EXISTS (SELECT 1 FROM hotels hs WHERE hs.id = b.hotel_id AND hs.owner_agency_id = $X)", params: [req.auth!.agencyId] as unknown[] };
const withParamIndex = (sql: string, index: number) => sql.replace("$X", `$${index}`);

app.get("/api/backoffice/bookings", authenticate, roles("system_admin", "back_office", "master_agency"), async (req: AuthedRequest, res, next) => {
  try {
    const scope = backofficeScope(req);
    const result = await pool.query(
      `SELECT b.id, b.booking_no, b.status, b.check_in::text, b.check_out::text, b.total, b.currency, b.created_at,
              h.name AS hotel_name, a.name AS agency_name
         FROM bookings b JOIN hotels h ON h.id = b.hotel_id JOIN agencies a ON a.id = b.agency_id
        WHERE ${withParamIndex(scope.sql, 1)}
        ORDER BY b.created_at DESC LIMIT 500`, scope.params);
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

app.get("/api/backoffice/bookings/:id", authenticate, roles("system_admin", "back_office", "master_agency"), async (req: AuthedRequest, res, next) => {
  try {
    const scope = backofficeScope(req);
    const detail = await bookingDetail(uuidParam(req), withParamIndex(scope.sql, 2), scope.params);
    if (!detail) return res.status(404).json({ error: "BOOKING_NOT_FOUND" });
    res.json(detail);
  } catch (error) { next(error); }
});

app.get("/api/backoffice/hotels", authenticate, roles("system_admin", "back_office", "master_agency"), async (req: AuthedRequest, res, next) => {
  try {
    const platform = isPlatformWide(req.auth!.role);
    const result = await pool.query(
      `SELECT h.id, h.name, h.location, h.category, h.status, h.owner_agency_id, a.name AS owner_agency_name
         FROM hotels h JOIN agencies a ON a.id = h.owner_agency_id
        WHERE $1::boolean OR h.owner_agency_id = $2
        ORDER BY h.name LIMIT 1000`, [platform, req.auth!.agencyId]);
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

// Status changes. approve/reject: Back Office, system admin, master agency (own hotels).
// cancel: Back Office and system admin only (pending or approved). Master agency has no cancel right.
app.patch("/api/backoffice/bookings/:id/status", authenticate, roles("system_admin", "back_office", "master_agency"), async (req: AuthedRequest, res, next) => {
  try {
    const bookingId = uuidParam(req);
    const nextStatus = req.body?.status;
    if (!["approved", "rejected", "cancelled"].includes(nextStatus)) return res.status(400).json({ error: "INVALID_STATUS" });
    if (nextStatus === "cancelled" && !isPlatformWide(req.auth!.role)) return res.status(403).json({ error: "CANCEL_NOT_ALLOWED" });
    const scope = backofficeScope(req);
    const result = await withTransaction(async client => {
      const from = await transition(client, {
        bookingId, to: nextStatus, from: nextStatus === "cancelled" ? ["pending", "approved"] : ["pending"],
        scopeSql: withParamIndex(scope.sql, 4), scopeParams: scope.params,
        actorId: req.auth!.sub, note: String(req.body?.note || "")
      });
      if (from) return { id: bookingId, status: nextStatus, previousStatus: from };
      const visible = await client.query(`SELECT b.status FROM bookings b WHERE b.id = $1 AND ${withParamIndex(scope.sql, 2)}`, [bookingId, ...scope.params]);
      if (!visible.rowCount) throw httpError(404, "BOOKING_NOT_FOUND");
      throw httpError(409, "INVALID_STATUS_TRANSITION", { status: visible.rows[0].status });
    });
    res.json(result);
  } catch (error) { next(error); }
});

// ---------------------------------------------------------------------------------------------
app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  if (error?.type === "entity.parse.failed") return res.status(400).json({ error: "INVALID_JSON" });
  const pgClient: Record<string, number> = { "22P02": 400, "22007": 400, "22008": 400, "23503": 400, "23505": 409, "23514": 409 };
  const status = Number(error?.status) || pgClient[error?.code] || 500;
  if (status >= 500) console.error("BED4BOOK API error", error);
  const message = error?.status ? error.message : status >= 500 ? "INTERNAL_SERVER_ERROR" : "INVALID_REQUEST";
  res.status(status).json({ error: message, ...(error?.extra || {}) });
});

const port = Number(process.env.PORT || 3000);
if (require.main === module) {
  if (!process.env.DATABASE_URL || sessionSecret.length < 32) throw new Error("DATABASE_URL and SESSION_SECRET (32+ chars) are required.");
  app.listen(port, () => console.log(`BED4BOOK API listening on :${port}`));
}
export default app;
