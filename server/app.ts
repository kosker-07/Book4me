import express, { NextFunction, Request, Response } from "express";
import { pool, withTransaction } from "./db";
import { issueSession, SessionClaims, verifyPassword, verifySession } from "./security";
import { randomUUID } from "node:crypto";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const sessionSecret = process.env.SESSION_SECRET || "";
type Role = SessionClaims["role"];
type AuthedRequest = Request & { auth?: SessionClaims };
const roles = (...allowed: Role[]) => (req: AuthedRequest, res: Response, next: NextFunction) => {
  if (!req.auth || !allowed.includes(req.auth.role)) return res.status(403).json({ error: "FORBIDDEN" });
  next();
};
const authenticate = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const claims = verifySession(token, sessionSecret);
  if (!claims) return res.status(401).json({ error: "UNAUTHENTICATED" });
  try {
    const result = await pool.query(
      "SELECT id, role, agency_id, active FROM users WHERE id = $1",
      [claims.sub]
    );
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

// A sub-agency sees only hotels explicitly published to that agency and active inventory.
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

// Booking creation is transactional. There is no explicit inventory lock or hold: each night is decremented
// with a single atomic conditional UPDATE, and the whole transaction rolls back if any night lacks allotment.
app.post("/api/agency/bookings", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  const agencyId = req.auth!.agencyId!;
  const idempotencyKey = String(req.header("Idempotency-Key") || "");
  if (!idempotencyKey || idempotencyKey.length > 128) return res.status(400).json({ error: "IDEMPOTENCY_KEY_REQUIRED" });
  const { ratePlanId, checkIn, checkOut, rooms, guest } = req.body || {};
  if (!ratePlanId || !/^\d{4}-\d{2}-\d{2}$/.test(checkIn || "") || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut || "") ||
      !Number.isInteger(rooms) || rooms < 1 || !guest?.firstName || !guest?.lastName)
    return res.status(400).json({ error: "INVALID_BOOKING_REQUEST" });
  try {
    const booking = await withTransaction(async client => {
      const prior = await client.query("SELECT response FROM idempotency_keys WHERE agency_id=$1 AND key=$2 FOR UPDATE", [agencyId, idempotencyKey]);
      if (prior.rowCount) return prior.rows[0].response;
      const sale = await client.query(
        `SELECT s.sell_currency, s.sell_price, rp.id AS rate_plan_id, h.id AS hotel_id
         FROM agency_hotel_sales s JOIN rate_plans rp ON rp.id=s.rate_plan_id
         JOIN rooms r ON r.id=rp.room_id JOIN hotels h ON h.id=r.hotel_id
         WHERE s.agency_id=$1 AND s.rate_plan_id=$2 AND s.active=true AND h.status='active' LIMIT 1`,
        [agencyId, ratePlanId]
      );
      if (!sale.rowCount) throw Object.assign(new Error("PRODUCT_NOT_PUBLISHED"), { status: 404 });
      const nights = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000);
      if (nights < 1 || nights > 60) throw Object.assign(new Error("INVALID_STAY_DATES"), { status: 400 });
      const dates: string[] = [];
      for (let i=0;i<nights;i++) dates.push(new Date(Date.parse(checkIn) + i*86400000).toISOString().slice(0,10));
      // Dates are processed in ascending order so concurrent transactions touch rows in the same order.
      for (const date of dates) {
        const updated = await client.query(
          "UPDATE inventory_daily SET reserved = reserved + $3 WHERE rate_plan_id = $1 AND stay_date = $2::date AND allotment - reserved >= $3",
          [ratePlanId, date, rooms]
        );
        if (updated.rowCount !== 1) throw Object.assign(new Error("ALLOTMENT_UNAVAILABLE"), { status: 409 });
      }
      const bookingId = randomUUID(), bookingNo = `B4B-${Date.now().toString(36).toUpperCase()}`;
      const total = Number(sale.rows[0].sell_price) * rooms * nights;
      await client.query(
        `INSERT INTO bookings(id, booking_no, agency_id, hotel_id, rate_plan_id, check_in, check_out, room_count, total, currency, status, guest_first_name, guest_last_name, guest_email)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13)`,
        [bookingId, bookingNo, agencyId, sale.rows[0].hotel_id, ratePlanId, checkIn, checkOut, rooms, total, sale.rows[0].sell_currency, guest.firstName, guest.lastName, guest.email || null]
      );
      await client.query("INSERT INTO booking_status_history(booking_id,from_status,to_status,actor_id,note) VALUES ($1,NULL,'pending',$2,'Created by sub-agency')", [bookingId, req.auth!.sub]);
      await audit(client, req.auth!.sub, agencyId, "booking.created", "booking", bookingId);
      const response = { id: bookingId, bookingNo, status: "pending", total, currency: sale.rows[0].sell_currency };
      await client.query("INSERT INTO idempotency_keys(agency_id,key,response) VALUES ($1,$2,$3::jsonb)", [agencyId, idempotencyKey, JSON.stringify(response)]);
      return response;
    }, agencyId);
    res.status(201).json(booking);
  } catch (error) { next(error); }
});

app.get("/api/backoffice/bookings", authenticate, roles("system_admin", "master_agency", "back_office"), async (req: AuthedRequest, res, next) => {
  try {
    const params: unknown[] = [];
    let where = "";
    if (req.auth!.role !== "system_admin") { params.push(req.auth!.agencyId); where = "WHERE h.owner_agency_id=$1"; }
    const result = await pool.query(
      `SELECT b.id,b.booking_no,b.status,b.check_in,b.check_out,b.total,b.currency,b.created_at,h.name AS hotel_name,a.name AS agency_name
       FROM bookings b JOIN hotels h ON h.id=b.hotel_id JOIN agencies a ON a.id=b.agency_id ${where}
       ORDER BY b.created_at DESC LIMIT 500`, params
    );
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

app.patch("/api/backoffice/bookings/:id/status", authenticate, roles("system_admin", "master_agency", "back_office"), async (req: AuthedRequest, res, next) => {
  try {
    const bookingId = String(req.params.id || "");
    const nextStatus = req.body?.status;
    if (!["approved", "rejected", "cancelled"].includes(nextStatus)) return res.status(400).json({ error: "INVALID_STATUS" });
    const result = await withTransaction(async client => {
      const booking = await client.query(
        `SELECT b.* FROM bookings b JOIN hotels h ON h.id=b.hotel_id
         WHERE b.id=$1 AND ($2::text='system_admin' OR h.owner_agency_id=$3) FOR UPDATE OF b`,
        [bookingId, req.auth!.role, req.auth!.agencyId]
      );
      if (!booking.rowCount) throw Object.assign(new Error("BOOKING_NOT_FOUND"), { status: 404 });
      const oldStatus = booking.rows[0].status;
      if (oldStatus !== "pending") throw Object.assign(new Error("INVALID_STATUS_TRANSITION"), { status: 409 });
      await client.query("UPDATE bookings SET status=$2,updated_at=now() WHERE id=$1", [bookingId, nextStatus]);
      await client.query("INSERT INTO booking_status_history(booking_id,from_status,to_status,actor_id,note) VALUES ($1,$2,$3,$4,$5)",
        [bookingId, oldStatus, nextStatus, req.auth!.sub, String(req.body?.note || "")]);
      await audit(client, req.auth!.sub, req.auth!.agencyId, `booking.${nextStatus}`, "booking", bookingId);
      return { id: bookingId, status: nextStatus };
    }, req.auth!.agencyId);
    res.json(result);
  } catch (error) { next(error); }
});

app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("BED4BOOK API error", error);
  res.status(status).json({ error: status >= 500 ? "INTERNAL_SERVER_ERROR" : error.message });
});

const port = Number(process.env.PORT || 3000);
if (require.main === module) {
  if (!process.env.DATABASE_URL || sessionSecret.length < 32) throw new Error("DATABASE_URL and SESSION_SECRET (32+ chars) are required.");
  app.listen(port, () => console.log(`BED4BOOK API listening on :${port}`));
}
export default app;
