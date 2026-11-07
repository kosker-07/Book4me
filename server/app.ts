import express, { NextFunction, Request, Response } from "express";
import type { PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { pool, withTransaction } from "./db";
import { hashPassword, issueSession, verifyPassword } from "./security";
import { Candidate, chooseWinners, fromCents, Markup, nightlySellCents, priceCandidate, toCents } from "./pricing";
import { FieldErrors, nightsBetween, validateGuest, validateOccupancy, validateStay } from "./validation";
import { signQuote, verifyQuote } from "./quotes";
import { audit, authenticate, AuthedRequest, httpError, isPlatformWide, requireAgency, roles, sessionSecret, uuidParam } from "./http";
import { adminRouter } from "./admin-routes";
import { renderVoucher } from "./voucher";
import { LOGIN_WINDOW_MINUTES, loginThrottled, parseTrustProxy } from "./login-guard";
import { newOtpChallenge, verifyOtpDigest, sendEmailOtp, OTP_MAX_ATTEMPTS, OTP_RESEND_MS, OTP_SESSION_TTL_SECONDS } from "./email-otp";

const app = express();
app.disable("x-powered-by");
// Reverse-proxy trust is explicit (B4B-02): by default X-Forwarded-For is ignored and req.ip is the TCP peer.
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY, process.env.NODE_ENV));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "bed4book-api" }));
app.get("/ready", async (_req, res) => {
  try { await pool.query("SELECT 1"); res.json({ ok: true, database: "up" }); }
  catch { res.status(503).json({ ok: false, database: "down" }); }
});

// ---------------------------------------------------------------------------------------------
// Authentication. Failed attempts are throttled per account+IP, per IP and per account (see login-guard.ts);
// every attempt is recorded, also for unknown e-mails. The response never reveals whether an account exists.
// ---------------------------------------------------------------------------------------------
const DUMMY_HASH = hashPassword("timing-equalisation-dummy-password"); // verify against it when the user does not exist

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password) return res.status(400).json({ error: "EMAIL_AND_PASSWORD_REQUIRED" });
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const recent = (await pool.query(
      `SELECT count(*) FILTER (WHERE email_lower = $1 AND ip = $2)::int AS account_and_ip,
              count(*) FILTER (WHERE ip = $2)::int AS ip,
              count(*) FILTER (WHERE email_lower = $1)::int AS account
         FROM login_attempts
        WHERE NOT success AND at > now() - make_interval(mins => $3) AND (email_lower = $1 OR ip = $2)`,
      [email, ip, LOGIN_WINDOW_MINUTES])).rows[0];
    if (loginThrottled({ accountAndIp: recent.account_and_ip, ip: recent.ip, account: recent.account }))
      return res.status(429).json({ error: "TOO_MANY_LOGIN_ATTEMPTS" });
    const user = (await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.role, u.agency_id, u.active, u.token_version, a.active AS agency_active
         FROM users u LEFT JOIN agencies a ON a.id = u.agency_id WHERE lower(u.email) = $1 LIMIT 1`, [email])).rows[0];
    const passwordOk = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    const allowed = !!user && passwordOk && user.active && (!user.agency_id || user.agency_active);
    await pool.query("INSERT INTO login_attempts(email_lower, ip, success) VALUES ($1,$2,$3)", [email, ip, allowed]);
    if (!allowed) return res.status(401).json({ error: "INVALID_CREDENTIALS" });
    // Never issue a bearer token before successful email OTP verification.
    const secret = process.env.OTP_SECRET || "";
    const challenge = newOtpChallenge(user.id, secret);
    await pool.query(
      "INSERT INTO email_otp_challenges(id,user_id,code_digest,expires_at) VALUES ($1,$2,$3,$4)",
      [challenge.id,user.id,challenge.digest,challenge.expiresAt]
    );
    try { await sendEmailOtp(user.email,challenge.code); }
    catch (err) {
      await pool.query("DELETE FROM email_otp_challenges WHERE id=$1",[challenge.id]);
      throw err;
    }
    res.json({ requiresOtp: true, challengeId: challenge.id, expiresIn: 300 });
  } catch (error) { next(error); }
});

// OTP verification uses a row lock to prevent concurrent reuse of the same challenge.
app.post("/api/auth/verify-email", async (req,res,next) => {
  try {
    const challengeId = String(req.body?.challengeId || "");
    const code = String(req.body?.code || "");
    if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\\d{6}$/.test(code))
      return res.status(400).json({error:"INVALID_OTP"});
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = (await client.query(
        `SELECT c.id,c.user_id,c.code_digest,c.expires_at,c.attempts,c.consumed_at,
                u.email,u.role,u.agency_id,u.active,u.token_version,a.active AS agency_active
           FROM email_otp_challenges c JOIN users u ON u.id=c.user_id
           LEFT JOIN agencies a ON a.id=u.agency_id WHERE c.id=$1 FOR UPDATE OF c`,
        [challengeId])).rows[0];
      if (!found || found.consumed_at || new Date(found.expires_at).getTime() <= Date.now()
          || found.attempts >= OTP_MAX_ATTEMPTS || !found.active
          || (found.agency_id && !found.agency_active)) {
        await client.query("COMMIT");
        return res.status(401).json({error:"INVALID_OTP"});
      }
      const ok = verifyOtpDigest(challengeId,code,found.code_digest,process.env.OTP_SECRET||"");
      await client.query("UPDATE email_otp_challenges SET attempts=attempts+1,consumed_at=CASE WHEN $2 THEN now() ELSE consumed_at END WHERE id=$1",[challengeId,ok]);
      if (!ok) {
        await client.query("COMMIT");
        return res.status(401).json({error:"INVALID_OTP"});
      }
      await audit(client,found.user_id,found.agency_id,"auth.email_otp_verified","user",found.user_id);
      await client.query("COMMIT");
      const token = issueSession({sub:found.user_id,role:found.role,agencyId:found.agency_id,ver:found.token_version},sessionSecret(),Date.now(),OTP_SESSION_TTL_SECONDS);
      return res.json({token,tokenType:"Bearer",expiresIn:OTP_SESSION_TTL_SECONDS,user:{id:found.user_id,email:found.email,role:found.role,agencyId:found.agency_id}});
    } catch(err) { await client.query("ROLLBACK"); throw err; }
    finally {client.release();}
  } catch(err) {next(err);}
});

// Logout revokes every session of the user (token_version is bumped).
app.post("/api/auth/logout", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    await pool.query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [req.auth!.sub]);
    await audit(pool, req.auth!.sub, req.auth!.agencyId, "auth.logout", "user", req.auth!.sub);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/api/me", authenticate, (req: AuthedRequest, res) => {
  res.json({ userId: req.auth!.sub, role: req.auth!.role, agencyId: req.auth!.agencyId });
});

app.use(adminRouter);

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
  rate_plan_id: string; board_name: string; currency: string; cancellation_policy: unknown; payment_terms: unknown; sales_conditions: unknown;
  room_id: string; room_name: string; max_adults: number; max_children: number;
  hotel_id: string; hotel_name: string; location: string; category: string | null;
  markup_type: "percent" | "fixed"; markup_value: string; nights: { date: string; price: string }[];
}

/** Published, active, bookable rate plans for an agency with allotment for every night. */
async function loadCandidates(db: { query: PoolClient["query"] }, agencyId: string, checkIn: string, checkOut: string, rooms: number) {
  const nights = nightsBetween(checkIn, checkOut).length;
  const result = await db.query(
    `SELECT rp.id AS rate_plan_id, rp.board_name, rp.currency, rp.cancellation_policy, rp.payment_terms, rp.sales_conditions,
            r.id AS room_id, r.name AS room_name, r.max_adults, r.max_children,
            h.id AS hotel_id, h.name AS hotel_name, h.location, h.category,
            s.markup_type, s.markup_value::text AS markup_value,
            json_agg(json_build_object('date', d.stay_date::text, 'price', d.price::text) ORDER BY d.stay_date) AS nights
       FROM agency_hotel_sales s
       JOIN agencies sa ON sa.id = s.agency_id AND sa.active
       JOIN rate_plans rp ON rp.id = s.rate_plan_id AND rp.active
       JOIN rooms r ON r.id = rp.room_id AND r.active
       JOIN hotels h ON h.id = r.hotel_id AND h.status = 'active'
       JOIN agencies oa ON oa.id = h.owner_agency_id AND oa.active
       JOIN inventory_daily d ON d.rate_plan_id = rp.id
            AND d.stay_date >= $2::date AND d.stay_date < $3::date AND d.allotment - d.reserved >= $4
      WHERE s.agency_id = $1 AND s.active
      GROUP BY rp.id, r.id, h.id, s.markup_type, s.markup_value
     HAVING count(*) = $5`,
    [agencyId, checkIn, checkOut, rooms, nights]
  );
  return result.rows as CandidateRow[];
}

const fitsOccupancy = (row: { max_adults: number; max_children: number }, rooms: number, adults: number, children: number) =>
  adults <= row.max_adults * rooms && children <= row.max_children * rooms;

const toCandidate = (row: CandidateRow): Candidate => ({
  ratePlanId: row.rate_plan_id, hotelId: row.hotel_id, roomId: row.room_id, board: row.board_name,
  cancellationPolicy: row.cancellation_policy, paymentTerms: row.payment_terms, salesConditions: row.sales_conditions,
  currency: row.currency.trim(),
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
        quoteId: signQuote({ agencyId, ratePlanId: w.ratePlanId, ...stay, totalCents: w.totalCents, currency: w.currency }, sessionSecret()),
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
// Booking creation and submission. No explicit inventory lock or hold: each night is decremented with
// one atomic conditional UPDATE, in ascending date order; any failure rolls the whole transaction back.
// Only the quoted (winning) rate plan is re-checked; no other offer is ever tried.
// Current product behaviour: allotment is decremented when a booking becomes "pending" (on creation, or
// on submission of a draft). A draft ("Taslak") never consumes allotment.
// ---------------------------------------------------------------------------------------------
interface Sale { markup: Markup; currency: string; hotelId: string; maxAdults: number; maxChildren: number }

/** The agency's active publication of exactly this rate plan, or 404. */
async function publishedSale(client: PoolClient, agencyId: string, ratePlanId: string): Promise<Sale> {
  const row = (await client.query(
    `SELECT s.markup_type, s.markup_value::text AS markup_value, rp.currency, h.id AS hotel_id, r.max_adults, r.max_children
       FROM agency_hotel_sales s
       JOIN agencies sa ON sa.id = s.agency_id AND sa.active
       JOIN rate_plans rp ON rp.id = s.rate_plan_id AND rp.active
       JOIN rooms r ON r.id = rp.room_id AND r.active
       JOIN hotels h ON h.id = r.hotel_id AND h.status = 'active'
       JOIN agencies oa ON oa.id = h.owner_agency_id AND oa.active
      WHERE s.agency_id = $1 AND s.rate_plan_id = $2 AND s.active`,
    [agencyId, ratePlanId])).rows[0];
  if (!row) throw httpError(404, "PRODUCT_NOT_PUBLISHED");
  return { markup: { type: row.markup_type, value: row.markup_value }, currency: String(row.currency).trim(), hotelId: row.hotel_id, maxAdults: row.max_adults, maxChildren: row.max_children };
}

/** Atomically decrements every night and writes the nightly price snapshot. Throws 409 on any failure. */
async function reserveNights(client: PoolClient, bookingId: string, ratePlanId: string, checkIn: string, checkOut: string,
                             rooms: number, sale: Sale, expectedTotalCents: number) {
  const nights: { date: string; inventoryId: string; netCents: number; sellCents: number }[] = [];
  for (const date of nightsBetween(checkIn, checkOut)) {
    const updated = await client.query(
      `UPDATE inventory_daily SET reserved = reserved + $3
        WHERE rate_plan_id = $1 AND stay_date = $2::date AND allotment - reserved >= $3
      RETURNING id, price::text AS price`,
      [ratePlanId, date, rooms]);
    if (updated.rowCount !== 1) throw httpError(409, "ALLOTMENT_UNAVAILABLE");
    const netCents = toCents(updated.rows[0].price);
    nights.push({ date, inventoryId: updated.rows[0].id, netCents, sellCents: nightlySellCents(netCents, sale.markup) });
  }
  const totalCents = nights.reduce((s, n) => s + n.sellCents, 0) * rooms;
  if (totalCents !== expectedTotalCents) throw httpError(409, "PRICE_CHANGED");
  for (const n of nights)
    await client.query(
      `INSERT INTO booking_nights(booking_id, stay_date, inventory_id, rooms, net_price, markup_type, markup_value, sell_price, currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [bookingId, n.date, n.inventoryId, rooms, fromCents(n.netCents), sale.markup.type, sale.markup.value, fromCents(n.sellCents), sale.currency]);
  return totalCents;
}

app.post("/api/agency/bookings", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  const agencyId = req.auth!.agencyId!;
  const idempotencyKey = String(req.header("Idempotency-Key") || "");
  if (!idempotencyKey || idempotencyKey.length > 128) return res.status(400).json({ error: "IDEMPOTENCY_KEY_REQUIRED" });

  // All nine guest fields are mandatory. Occupancy lives in the guest object; dates and rooms come from the signed quote.
  const errors: FieldErrors = {};
  const guest = validateGuest(req.body, errors);
  const occupancy = validateOccupancy(req.body?.guest, errors, "guest.");
  if (!req.body?.quoteId) errors.quoteId = "REQUIRED";
  if (req.body?.draft !== undefined && typeof req.body.draft !== "boolean") errors.draft = "BOOLEAN";
  if (!guest || !occupancy || Object.keys(errors).length) return res.status(400).json({ error: "VALIDATION_FAILED", fields: errors });
  const { adults, children, childAges } = occupancy;
  const asDraft = req.body.draft === true;

  const checked = verifyQuote(req.body.quoteId, sessionSecret());
  if (!checked.ok) return res.status(checked.error === "QUOTE_EXPIRED" ? 409 : 400).json({ error: checked.error });
  const q = checked.quote;
  if (q.agencyId !== agencyId) return res.status(404).json({ error: "PRODUCT_NOT_PUBLISHED" });
  const sameAges = [...childAges].sort((a, b) => a - b).join(",") === [...q.childAges].sort((a, b) => a - b).join(",");
  if (adults !== q.adults || children !== q.children || !sameAges)
    return res.status(409).json({ error: "QUOTE_OCCUPANCY_MISMATCH" });

  const requestHash = createHash("sha256").update(JSON.stringify({ quoteId: req.body.quoteId, guest: req.body.guest, operationNote: req.body.operationNote, draft: asDraft })).digest("hex");
  try {
    const result = await withTransaction(async client => {
      // Claim the idempotency key first. A concurrent request with the same key waits on the unique
      // index and then replays the committed response instead of creating a second booking.
      const claim = await client.query(
        "INSERT INTO idempotency_keys(agency_id, key, response, request_hash) VALUES ($1,$2,'{}'::jsonb,$3) ON CONFLICT DO NOTHING",
        [agencyId, idempotencyKey, requestHash]);
      if (claim.rowCount === 0) {
        const row = (await client.query("SELECT response, request_hash FROM idempotency_keys WHERE agency_id=$1 AND key=$2", [agencyId, idempotencyKey])).rows[0];
        if (row.request_hash === null || row.request_hash === undefined) {
          // B4B-04: key stored before migration 002 (no fingerprint). Never create a second booking under it.
          // Replay only if the stored booking matches this request (same rate plan, dates, rooms, guest);
          // otherwise the key is being reused for different content. A match binds the fingerprint so later
          // requests with this key take the normal path.
          const legacyId = row.response && typeof row.response === "object" ? row.response.id : undefined;
          const same = typeof legacyId === "string" && (await client.query(
            `SELECT 1 FROM bookings WHERE id::text = $1 AND agency_id = $2 AND rate_plan_id = $3 AND check_in = $4::date
                AND check_out = $5::date AND room_count = $6 AND lower(guest_first_name) = lower($7) AND lower(guest_last_name) = lower($8)`,
            [legacyId, agencyId, q.ratePlanId, q.checkIn, q.checkOut, q.rooms, guest.firstName, guest.lastName])).rowCount === 1;
          if (!same) throw httpError(422, "IDEMPOTENCY_KEY_REUSED");
          await client.query("UPDATE idempotency_keys SET request_hash=$3 WHERE agency_id=$1 AND key=$2 AND request_hash IS NULL",
            [agencyId, idempotencyKey, requestHash]);
          return { status: 201, body: row.response };
        }
        if (row.request_hash !== requestHash) throw httpError(422, "IDEMPOTENCY_KEY_REUSED");
        return { status: 201, body: row.response };
      }

      const sale = await publishedSale(client, agencyId, q.ratePlanId); // re-check only the quoted winner
      if (sale.currency !== q.currency) throw httpError(409, "PRICE_CHANGED");
      if (adults > sale.maxAdults * q.rooms || children > sale.maxChildren * q.rooms) throw httpError(409, "OCCUPANCY_EXCEEDS_CAPACITY");

      const bookingId = randomUUID();
      const seq = (await client.query("SELECT nextval('booking_no_seq') AS n")).rows[0].n;
      const bookingNo = `B4B-${String(seq).padStart(8, "0")}`;
      const status = asDraft ? "draft" : "pending";
      const quotedTotal = fromCents(q.totalCents);
      await client.query(
        `INSERT INTO bookings(id, booking_no, agency_id, hotel_id, rate_plan_id, check_in, check_out, room_count, total, quoted_total, currency, status,
                              submitted_at, guest_first_name, guest_last_name, guest_email, guest_phone, guest_nationality, adults, children, child_ages, operation_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11, CASE WHEN $11 = 'pending' THEN now() END, $12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [bookingId, bookingNo, agencyId, sale.hotelId, q.ratePlanId, q.checkIn, q.checkOut, q.rooms, quotedTotal, q.currency, status,
         guest.firstName, guest.lastName, guest.email, guest.phone, guest.nationality, adults, children, childAges, guest.operationNote]);
      if (!asDraft) await reserveNights(client, bookingId, q.ratePlanId, q.checkIn, q.checkOut, q.rooms, sale, q.totalCents);
      await client.query("INSERT INTO booking_status_history(booking_id,from_status,to_status,actor_id,note) VALUES ($1,NULL,$2,$3,'Created by sub-agency')",
        [bookingId, status, req.auth!.sub]);
      await audit(client, req.auth!.sub, agencyId, asDraft ? "booking.draft_created" : "booking.created", "booking", bookingId);
      const response = { id: bookingId, bookingNo, status, total: quotedTotal, currency: q.currency };
      await client.query("UPDATE idempotency_keys SET response=$3::jsonb WHERE agency_id=$1 AND key=$2", [agencyId, idempotencyKey, JSON.stringify(response)]);
      return { status: 201, body: response };
    }, agencyId);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
});

// Submitting a draft: draft -> pending. Re-checks the quoted price and decrements allotment atomically;
// on failure the booking stays a draft and nothing changes.
app.post("/api/agency/bookings/:id/submit", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  try {
    const bookingId = uuidParam(req, "BOOKING_NOT_FOUND"), agencyId = req.auth!.agencyId!;
    const result = await withTransaction(async client => {
      const b = (await client.query(
        `UPDATE bookings SET status = 'pending', submitted_at = now(), updated_at = now()
          WHERE id = $1 AND agency_id = $2 AND status = 'draft'
        RETURNING rate_plan_id, check_in::text AS check_in, check_out::text AS check_out, room_count, quoted_total::text AS quoted_total, currency, adults, children`,
        [bookingId, agencyId])).rows[0];
      if (!b) {
        const own = await client.query("SELECT status FROM bookings WHERE id=$1 AND agency_id=$2", [bookingId, agencyId]);
        if (!own.rowCount) throw httpError(404, "BOOKING_NOT_FOUND");
        throw httpError(409, "ONLY_DRAFT_CAN_BE_SUBMITTED", { status: own.rows[0].status });
      }
      const sale = await publishedSale(client, agencyId, b.rate_plan_id);
      if (sale.currency !== String(b.currency).trim()) throw httpError(409, "PRICE_CHANGED");
      if (b.adults > sale.maxAdults * b.room_count || b.children > sale.maxChildren * b.room_count) throw httpError(409, "OCCUPANCY_EXCEEDS_CAPACITY");
      await reserveNights(client, bookingId, b.rate_plan_id, b.check_in, b.check_out, b.room_count, sale, toCents(b.quoted_total));
      await client.query("INSERT INTO booking_status_history(booking_id,from_status,to_status,actor_id,note) VALUES ($1,'draft','pending',$2,'Submitted by sub-agency')",
        [bookingId, req.auth!.sub]);
      await audit(client, req.auth!.sub, agencyId, "booking.submitted", "booking", bookingId);
      return { id: bookingId, status: "pending" };
    }, agencyId);
    res.json(result);
  } catch (error) { next(error); }
});

// ---------------------------------------------------------------------------------------------
// Booking state changes. No SELECT ... FOR UPDATE: each transition is one conditional UPDATE that
// succeeds only from the expected status, so a booking can be released at most once.
// ---------------------------------------------------------------------------------------------
const CONSUMES_INVENTORY = new Set(["pending", "approved"]);
const RELEASING = new Set(["rejected", "cancelled"]);

/** Returns allotment of a booking that consumed inventory. Uses the nightly snapshot; bookings created
 *  before migration 002 have no snapshot and are released from their date range. */
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

/** Tries each allowed source status with a conditional UPDATE. The scope limits which bookings the actor may touch. */
async function transition(client: PoolClient, opts: {
  bookingId: string; to: string; from: string[]; scopeSql: string; scopeParams: unknown[]; actorId: string; note: string;
}) {
  for (const from of opts.from) {
    const updated = await client.query(
      `UPDATE bookings b SET status = $2, updated_at = now()
        WHERE b.id = $1 AND b.status = $3 AND ${opts.scopeSql}
      RETURNING b.agency_id`,
      [opts.bookingId, opts.to, from, ...opts.scopeParams]);
    if (updated.rowCount === 1) {
      if (RELEASING.has(opts.to) && CONSUMES_INVENTORY.has(from)) await releaseInventory(client, opts.bookingId);
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
    `SELECT b.id, b.booking_no, b.status, b.agency_id, a.name AS agency_name, b.hotel_id, b.rate_plan_id,
            b.check_in::text, b.check_out::text, b.room_count, b.total, b.currency,
            b.guest_first_name, b.guest_last_name, b.guest_email, b.guest_phone, b.guest_nationality,
            b.adults, b.children, b.child_ages, b.operation_note, b.created_at, b.updated_at,
            h.name AS hotel_name, h.location AS hotel_location, r.name AS room_name, rp.board_name
       FROM bookings b JOIN hotels h ON h.id = b.hotel_id JOIN agencies a ON a.id = b.agency_id
       JOIN rate_plans rp ON rp.id = b.rate_plan_id JOIN rooms r ON r.id = rp.room_id
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
    const detail = await bookingDetail(uuidParam(req, "BOOKING_NOT_FOUND"), "b.agency_id = $2", [req.auth!.agencyId]);
    if (!detail) return res.status(404).json({ error: "BOOKING_NOT_FOUND" });
    res.json(detail);
  } catch (error) { next(error); }
});

// Sub-agency may cancel only its own booking, and only while it is a draft or pending.
app.post("/api/agency/bookings/:id/cancel", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  try {
    const bookingId = uuidParam(req, "BOOKING_NOT_FOUND");
    const result = await withTransaction(async client => {
      const from = await transition(client, {
        bookingId, to: "cancelled", from: ["draft", "pending"], scopeSql: "b.agency_id = $4", scopeParams: [req.auth!.agencyId],
        actorId: req.auth!.sub, note: String(req.body?.note || "Cancelled by sub-agency")
      });
      if (from) return { id: bookingId, status: "cancelled", previousStatus: from };
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
const backoffice = [authenticate, roles("system_admin", "back_office", "master_agency")] as const;

app.get("/api/backoffice/bookings", ...backoffice, async (req: AuthedRequest, res, next) => {
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

app.get("/api/backoffice/bookings/:id", ...backoffice, async (req: AuthedRequest, res, next) => {
  try {
    const scope = backofficeScope(req);
    const detail = await bookingDetail(uuidParam(req, "BOOKING_NOT_FOUND"), withParamIndex(scope.sql, 2), scope.params);
    if (!detail) return res.status(404).json({ error: "BOOKING_NOT_FOUND" });
    res.json(detail);
  } catch (error) { next(error); }
});

app.get("/api/backoffice/hotels", ...backoffice, async (req: AuthedRequest, res, next) => {
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

// Status changes. approve/reject (pending only): Back Office, system admin, master agency (own hotels).
// cancel (draft, pending or approved): Back Office and system admin only. Master agency has no cancel right.
app.patch("/api/backoffice/bookings/:id/status", ...backoffice, async (req: AuthedRequest, res, next) => {
  try {
    const bookingId = uuidParam(req, "BOOKING_NOT_FOUND");
    const nextStatus = req.body?.status;
    if (!["approved", "rejected", "cancelled"].includes(nextStatus)) return res.status(400).json({ error: "INVALID_STATUS" });
    if (nextStatus === "cancelled" && !isPlatformWide(req.auth!.role)) return res.status(403).json({ error: "CANCEL_NOT_ALLOWED" });
    const scope = backofficeScope(req);
    const result = await withTransaction(async client => {
      const from = await transition(client, {
        bookingId, to: nextStatus, from: nextStatus === "cancelled" ? ["draft", "pending", "approved"] : ["pending"],
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
// PDF voucher: only for approved bookings. Sub-agency: own bookings; Back Office / system admin:
// platform-wide; master agency: own hotels. Every generation is logged with the PDF hash.
// ---------------------------------------------------------------------------------------------
async function sendVoucher(req: AuthedRequest, res: Response, scopeSql: string, scopeParams: unknown[]) {
  const bookingId = uuidParam(req, "BOOKING_NOT_FOUND");
  const b = await bookingDetail(bookingId, scopeSql, scopeParams);
  if (!b) throw httpError(404, "BOOKING_NOT_FOUND");
  if (b.status !== "approved") throw httpError(409, "VOUCHER_REQUIRES_APPROVED_BOOKING", { status: b.status });
  const pdf = await renderVoucher({
    bookingNo: b.booking_no, status: b.status, hotelName: b.hotel_name, hotelLocation: b.hotel_location,
    checkIn: b.check_in, checkOut: b.check_out, nights: nightsBetween(b.check_in, b.check_out).length,
    roomName: b.room_name, board: b.board_name, rooms: b.room_count,
    guestName: `${b.guest_first_name} ${b.guest_last_name}`, adults: b.adults, children: b.children, childAges: b.child_ages,
    nationality: b.guest_nationality, operationNote: b.operation_note, agencyName: b.agency_name, issuedAt: new Date()
  });
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  await withTransaction(async client => {
    await client.query("INSERT INTO vouchers(booking_id, sha256, generated_by) VALUES ($1,$2,$3)", [bookingId, sha256, req.auth!.sub]);
    await audit(client, req.auth!.sub, b.agency_id, "voucher.generated", "booking", bookingId);
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="BED4BOOK-${b.booking_no}.pdf"`);
  res.setHeader("X-Voucher-SHA256", sha256);
  res.send(pdf);
}

app.get("/api/agency/bookings/:id/voucher", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  try { await sendVoucher(req, res, "b.agency_id = $2", [req.auth!.agencyId]); } catch (error) { next(error); }
});

app.get("/api/backoffice/bookings/:id/voucher", ...backoffice, async (req: AuthedRequest, res, next) => {
  try { const scope = backofficeScope(req); await sendVoucher(req, res, withParamIndex(scope.sql, 2), scope.params); }
  catch (error) { next(error); }
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
  if (!process.env.DATABASE_URL || sessionSecret().length < 32) throw new Error("DATABASE_URL and SESSION_SECRET (32+ chars) are required.");
  app.listen(port, () => console.log(`BED4BOOK API listening on :${port}`));
}
export default app;
