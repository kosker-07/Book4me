import express, { NextFunction, Request, Response } from "express";
import path from "node:path";
import type { PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { pool, withTransaction } from "./db";
import { bootstrapAdmin } from "./bootstrap-admin";
import { BROWSER_SESSION_MAX_SECONDS, hashPassword, issueSession, verifyPassword } from "./security";
import { Candidate, chooseWinners, convertMinor, formatMinor, Markup, nightlySellMinor, normalizeDecimal, parseMinor, priceCandidate, priceMarketplaceChain } from "./pricing";
import { ContractEligibility, evaluateContract, NationalityRule, rulesByContract } from "./eligibility";
import { comparisonRates, FxRate, loadFreshRates } from "./fx";
import { FieldErrors, nightsBetween, validateGuest, validateNationalities, validateOccupancy, validateOtherGuests, validateStay } from "./validation";
import { signQuote, verifyQuote } from "./quotes";
import { audit, authenticate, AuthedRequest, clearSessionCookie, httpError, isPlatformWide, requireAgency, resolveSession, roles, sessionSecret, setSessionCookie, uuidParam } from "./http";
import { adminRouter } from "./admin-routes";
import { contractRouter } from "./contract-routes";
import { distributionRouter } from "./distribution-routes";
import { renderVoucher } from "./voucher";
import { renderProforma } from "./proforma";
import { LOGIN_WINDOW_MINUTES, loginThrottled, parseTrustProxy } from "./login-guard";
import { requestContext } from "./context";

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
app.use(requestContext);
app.use(express.json({ limit: "1mb" }));

// Temporary same-origin admin sign-in page; assets are copied into dist-server/server/assets.
app.get("/giris", (_req, res) => {
  res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; img-src 'none'");
  res.type("html").sendFile(path.join(__dirname, "assets", "giris.html"));
});

// Read-only preview of the offline browser demo (dist/index.html, built by tools/build.js). It runs entirely in the
// browser with its own sample data and demo accounts; it does not call this API or touch the database.
app.get("/demo", (_req, res) => {
  res.type("html").sendFile(path.resolve(process.cwd(), "dist", "index.html"));
});

// BED4BOOK v2: isolated same-origin static frontend, with no inline script/style permissions.
app.use("/app", (_req, res, next) => {
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'");
  next();
}, express.static(path.resolve(process.cwd(), "web")));

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
    await audit(pool, user.id, user.agency_id, "auth.login", "user", user.id);
    const token = issueSession({ sub: user.id, role: user.role, agencyId: user.agency_id, ver: user.token_version }, sessionSecret());
    setSessionCookie(req, res, issueSession({ sub: user.id, role: user.role, agencyId: user.agency_id, ver: user.token_version,
      max: Math.floor(Date.now() / 1000) + BROWSER_SESSION_MAX_SECONDS }, sessionSecret()));
    res.json({ token, tokenType: "Bearer", expiresIn: 28800, user: { id: user.id, email: user.email, role: user.role, agencyId: user.agency_id } });
  } catch (error) { next(error); }
});

// Logout revokes every session of the user (token_version is bumped).
app.post("/api/auth/logout", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    await pool.query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [req.auth!.sub]);
    await audit(pool, req.auth!.sub, req.auth!.agencyId, "auth.logout", "user", req.auth!.sub);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// Change password for the currently authenticated user. Invalidates all existing sessions.
app.post("/api/auth/change-password", authenticate, async (req: AuthedRequest, res, next) => {
  try {
    const currentPassword = req.body?.currentPassword;
    const newPassword = req.body?.newPassword;
    if (typeof currentPassword !== "string" || typeof newPassword !== "string")
      return res.status(400).json({ error: "CURRENT_AND_NEW_PASSWORD_REQUIRED" });
    if (newPassword.length < 12) return res.status(400).json({ error: "PASSWORD_TOO_SHORT" });
    // No explicit row lock (product rule): the UPDATE only applies if the hash is still the one just verified, so a
    // concurrent password change makes this request fail instead of silently overwriting it.
    const user = (await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.auth!.sub])).rows[0];
    if (!user || !verifyPassword(currentPassword, user.password_hash))
      return res.status(401).json({ error: "INVALID_CURRENT_PASSWORD" });
    const updated = await pool.query(
      "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 AND password_hash = $3",
      [hashPassword(newPassword), req.auth!.sub, user.password_hash]);
    if (!updated.rowCount) return res.status(401).json({ error: "INVALID_CURRENT_PASSWORD" });
    res.json({ ok: true, sessionsRevoked: true });
  } catch (error) { next(error); }
});

app.get("/api/auth/session", async (req, res, next) => {
  try {
    const session = await resolveSession(req, res);
    if ("error" in session) return res.json({ authenticated: false });
    res.json({ authenticated: true, userId: session.claims.sub, role: session.claims.role, agencyId: session.claims.agencyId });
  } catch (error) { next(error); }
});

app.get("/api/me", authenticate, (req: AuthedRequest, res) => {
  res.json({ userId: req.auth!.sub, role: req.auth!.role, agencyId: req.auth!.agencyId });
});

app.use(adminRouter);
app.use(contractRouter);
app.use(distributionRouter);

// A sub-agency sees only hotels explicitly published to that agency.
app.get("/api/agency/hotels", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT h.id, h.name, h.location, h.category, h.description, h.amenities, h.images
       FROM hotels h
       JOIN effective_agency_sales($1) s ON s.hotel_id = h.id
       WHERE s.agency_id = $1 AND s.active = true AND h.status = 'active'
       ORDER BY h.name`,
      [req.auth!.agencyId]
    );
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

// ---------------------------------------------------------------------------------------------
// Search (read-only). Writes nothing: no booking, no inventory change, no hold record.
// Pricing flow: contract → guest nationalities → eligibility (exclusion first) → availability → contract net
// price → agency markup → EUR normalisation → one winner per equivalence key → signed quote.
// Losing and ineligible offers are discarded and never returned; no other market's price is ever shown.
// ---------------------------------------------------------------------------------------------
interface CandidateRow {
  rate_plan_id: string; board_name: string; currency: string; minor_units: number;
  cancellation_policy: unknown; payment_terms: unknown; sales_conditions: unknown;
  contract_id: string;
  room_id: string; room_name: string; max_adults: number; max_children: number;
  hotel_id: string; hotel_name: string; location: string; category: string | null;
  markup_type: "percent" | "fixed"; markup_value: string;
  source: string; platform_margin_percent: string; buyer_markup_percent: string; nights: { date: string; price: string }[];
}

/** Published, active, bookable rate plans with allotment for every night, whose contract is active and valid
 *  for every night of the stay and whose currency is allow-listed and active. */
async function loadCandidates(db: { query: PoolClient["query"] }, agencyId: string, checkIn: string, checkOut: string, rooms: number) {
  const nights = nightsBetween(checkIn, checkOut).length;
  const result = await db.query(
    `SELECT rp.id AS rate_plan_id, rp.board_name, rp.currency, cur.minor_units, rp.cancellation_policy, rp.payment_terms, rp.sales_conditions,
            hc.id AS contract_id,
            r.id AS room_id, r.name AS room_name, r.max_adults, r.max_children,
            h.id AS hotel_id, h.name AS hotel_name, h.location, h.category,
            s.markup_type, s.markup_value::text AS markup_value, s.source,
            CASE WHEN s.source = 'distribution_rule' THEN
              coalesce(marketplace_applicable_margin(h.owner_agency_id, buyer.parent_agency_id, h.id), 0)::text
              ELSE '0' END AS platform_margin_percent,
            CASE WHEN s.source = 'distribution_rule' THEN parent.marketplace_markup_percent::text
              ELSE '0' END AS buyer_markup_percent,
            json_agg(json_build_object('date', d.stay_date::text, 'price', d.price::text) ORDER BY d.stay_date) AS nights
       FROM effective_agency_sales($1) s
       JOIN agencies sa ON sa.id = s.agency_id AND sa.active
       JOIN agencies buyer ON buyer.id = s.agency_id
       LEFT JOIN agencies parent ON parent.id = buyer.parent_agency_id
       JOIN rate_plans rp ON rp.id = s.rate_plan_id AND rp.active
       JOIN currencies cur ON cur.code = rp.currency AND cur.active
       JOIN contract_rate_plans crp ON crp.rate_plan_id = rp.id
       JOIN hotel_contracts hc ON hc.id = crp.contract_id AND hc.status = 'active'
            AND (hc.valid_from IS NULL OR hc.valid_from <= $2::date) AND (hc.valid_to IS NULL OR hc.valid_to >= $3::date - 1)
       JOIN rooms r ON r.id = rp.room_id AND r.active
       JOIN hotels h ON h.id = r.hotel_id AND h.status = 'active'
       JOIN agencies oa ON oa.id = h.owner_agency_id AND oa.active
       JOIN inventory_daily d ON d.rate_plan_id = rp.id
            AND d.stay_date >= $2::date AND d.stay_date < $3::date AND d.allotment - d.reserved >= $4
      WHERE s.agency_id = $1 AND s.active
      GROUP BY rp.id, cur.minor_units, hc.id, r.id, h.id, s.markup_type, s.markup_value, s.source, buyer.parent_agency_id, parent.marketplace_markup_percent, h.owner_agency_id
     HAVING count(*) = $5`,
    [agencyId, checkIn, checkOut, rooms, nights]
  );
  return result.rows as CandidateRow[];
}

/** Nationality rules of the given contracts, with market-group members resolved. */
async function loadRules(db: { query: PoolClient["query"] }, contractIds: string[]): Promise<NationalityRule[]> {
  if (!contractIds.length) return [];
  const rows = (await db.query(
    `SELECT r.id, r.contract_id, r.rule_type, r.country_code, r.market_group_id, g.code AS group_code,
            coalesce(array_agg(m.country_code ORDER BY m.country_code) FILTER (WHERE m.country_code IS NOT NULL), '{}') AS members
       FROM contract_nationality_rules r
       LEFT JOIN market_groups g ON g.id = r.market_group_id
       LEFT JOIN market_group_members m ON m.group_id = r.market_group_id
      WHERE r.contract_id = ANY($1::uuid[])
      GROUP BY r.id, g.code`, [contractIds])).rows;
  return rows.map((r: any) => ({
    id: r.id, contractId: r.contract_id, type: r.rule_type, countryCode: r.country_code ? String(r.country_code).trim() : null,
    marketGroupId: r.market_group_id, marketGroupCode: r.group_code, members: (r.members as string[]).map(x => x.trim())
  }));
}

const fitsOccupancy = (row: { max_adults: number; max_children: number }, occupancies: { adults: number; children: number }[]) =>
  occupancies.every(room => room.adults <= row.max_adults && room.children <= row.max_children);

const toCandidate = (row: CandidateRow): Candidate => ({
  ratePlanId: row.rate_plan_id, hotelId: row.hotel_id, roomId: row.room_id, board: row.board_name,
  cancellationPolicy: row.cancellation_policy, paymentTerms: row.payment_terms, salesConditions: row.sales_conditions,
  currency: row.currency.trim(), minorUnits: row.minor_units,
  markup: { type: row.markup_type, value: row.markup_value },
  nights: row.nights.map(n => ({ date: n.date, netPrice: n.price }))
});

async function activeCurrency(db: { query: PoolClient["query"] }, code: string) {
  const row = (await db.query("SELECT code, minor_units FROM currencies WHERE code = $1 AND active", [code])).rows[0];
  return row ? { code: String(row.code).trim(), minorUnits: Number(row.minor_units) } : null;
}

app.post("/api/agency/searches", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  try {
    const errors: FieldErrors = {};
    const stay = validateStay(req.body, errors);
    const nat = validateNationalities(req.body?.nationalities, stay ? stay.adults + stay.children : 0, errors);
    if (nat.missing) return res.status(400).json({ error: "NATIONALITY_REQUIRED" });
    if (!stay || !nat.nationalities) return res.status(400).json({ error: "VALIDATION_FAILED", fields: errors });
    const nationalities = nat.nationalities;
    const agencyId = req.auth!.agencyId!;
    const occupancy = { adults: stay.adults, children: stay.children, childAges: stay.childAges };
    const requestedPayment = req.body?.paymentCurrency;
    if (requestedPayment !== undefined && (typeof requestedPayment !== "string" || !(await activeCurrency(pool, requestedPayment))))
      return res.status(400).json({ error: "PAYMENT_CURRENCY_NOT_SUPPORTED" });
    const [rows, fx] = await Promise.all([loadCandidates(pool, agencyId, stay.checkIn, stay.checkOut, stay.rooms), loadFreshRates(pool)]);
    const payment = requestedPayment ? await activeCurrency(pool, requestedPayment) : null;
    if (payment && !fx.get(payment.code)) return res.status(409).json({ error: "FX_RATE_UNAVAILABLE", currency: payment.code });
    const rulesFor = rulesByContract(await loadRules(pool, [...new Set(rows.map(r => r.contract_id))]));
    const byRatePlan = new Map(rows.map(r => [r.rate_plan_id, r]));
    const eligibilityOf = new Map<string, ContractEligibility>();
    const offers = rows
      .filter(r => fitsOccupancy(r, stay.roomOccupancies))
      .filter(r => {
        const e = evaluateContract(rulesFor.get(r.contract_id) ?? [], nationalities);
        eligibilityOf.set(r.rate_plan_id, e);
        return e.eligible;   // ineligible contracts never compete and are never shown
      })
      .map(r => {
        const candidate = toCandidate(r);
        if (r.source === "distribution_rule") {
          candidate.nights = r.nights.map(n => ({
            date: n.date,
            netPrice: formatMinor(priceMarketplaceChain(
              parseMinor(n.price, r.minor_units), r.platform_margin_percent,
              r.buyer_markup_percent, 0, r.minor_units).saleMinor, r.minor_units)
          }));
          candidate.markup = { type: "percent", value: "0" };
        }
        return priceCandidate(candidate, occupancy, stay.checkIn, stay.checkOut, stay.rooms, comparisonRates(fx), nationalities);
      });
    const results = chooseWinners(offers).map(w => {
      const row = byRatePlan.get(w.ratePlanId)!, digits = row.minor_units, contractFx = fx.get(w.currency)!;
      const pay = payment ?? { code: w.currency, minorUnits: digits };
      const payFx = fx.get(pay.code)!;
      const paymentAmountMinor = pay.code === w.currency ? w.totalMinor
        : convertMinor(w.totalMinor, digits, contractFx.eurPerUnit, pay.minorUnits, payFx.eurPerUnit);
      const matches = eligibilityOf.get(w.ratePlanId)!.matches;
      return {
        quoteId: signQuote({
          agencyId, ratePlanId: w.ratePlanId, contractId: row.contract_id, ...stay, nationalities,
          ruleIds: matches.map(m => m.ruleId), totalMinor: w.totalMinor, currency: w.currency, minorUnits: digits,
          fxRateId: contractFx.historyId, paymentCurrency: pay.code, paymentMinorUnits: pay.minorUnits, paymentAmountMinor,
          paymentFxRateId: payFx.historyId
        }, sessionSecret()),
        hotel: { id: row.hotel_id, name: row.hotel_name, location: row.location, category: row.category },
        room: { name: row.room_name },
        board: row.board_name,
        cancellationPolicy: row.cancellation_policy,
        paymentTerms: row.payment_terms,
        checkIn: stay.checkIn, checkOut: stay.checkOut, rooms: stay.rooms, nationalities,
        nights: w.nights.map((n, i) => ({ date: n.date, price: formatMinor(w.nightSellMinor[i]!, digits) })),
        total: formatMinor(w.totalMinor, digits),
        currency: w.currency,
        payment: { currency: pay.code, total: formatMinor(paymentAmountMinor, pay.minorUnits) },
        ...(pay.code !== w.currency ? { fx: { from: w.currency, to: pay.code, fromEurPerUnit: contractFx.eurPerUnit,
                                             toEurPerUnit: payFx.eurPerUnit, validAt: [contractFx.validAt, payFx.validAt].filter(Boolean) } } : {})
      };
    });
    res.json({ results });
  } catch (error) { next(error); }
});

// ---------------------------------------------------------------------------------------------
// Booking creation and submission. No explicit inventory lock or hold: each night is decremented with
// one atomic conditional UPDATE, in ascending date order; any failure rolls the whole transaction back.
// Only the quoted (winning) rate plan and contract are re-checked; no other offer or contract is ever tried.
// Re-validated at creation and at draft submission: publication, contract status and validity, nationality
// eligibility of every guest, availability, price, and the FX rates the quote was priced with.
// Current product behaviour: allotment is decremented when a booking becomes "pending" (on creation, or
// on submission of a draft). A draft ("Taslak") never consumes allotment.
// ---------------------------------------------------------------------------------------------
interface Sale {
  markup: Markup; currency: string; minorUnits: number; hotelId: string; maxAdults: number; maxChildren: number;
  contractId: string; contractCode: string; contractName: string; sellerLegalName: string;
  source: string; platformMarginPercent: string; buyerMarkupPercent: string; platformFeePercent: string;
}

/** The agency's active publication of exactly this rate plan, or 404. */
async function publishedSale(client: PoolClient, agencyId: string, ratePlanId: string): Promise<Sale> {
  const row = (await client.query(
    `SELECT s.markup_type, s.markup_value::text AS markup_value, rp.currency, cur.minor_units, h.id AS hotel_id, r.max_adults, r.max_children,
            hc.id AS contract_id, hc.code AS contract_code, hc.name AS contract_name, hc.seller_legal_name,
            s.source,
            CASE WHEN s.source = 'distribution_rule' THEN
              coalesce(marketplace_applicable_margin(h.owner_agency_id, buyer.parent_agency_id, h.id), 0)::text
              ELSE '0' END AS platform_margin_percent,
            CASE WHEN s.source = 'distribution_rule' THEN parent.marketplace_markup_percent::text
              ELSE '0' END AS buyer_markup_percent,
            CASE WHEN s.source = 'distribution_rule' AND buyer.type = 'master'
              THEN buyer.platform_fee_percent::text ELSE '0' END AS platform_fee_percent
       FROM effective_agency_sales($1) s
       JOIN agencies sa ON sa.id = s.agency_id AND sa.active
       JOIN agencies buyer ON buyer.id = s.agency_id
       LEFT JOIN agencies parent ON parent.id = buyer.parent_agency_id
       JOIN rate_plans rp ON rp.id = s.rate_plan_id AND rp.active
       JOIN currencies cur ON cur.code = rp.currency AND cur.active
       JOIN contract_rate_plans crp ON crp.rate_plan_id = rp.id
       JOIN hotel_contracts hc ON hc.id = crp.contract_id
       JOIN rooms r ON r.id = rp.room_id AND r.active
       JOIN hotels h ON h.id = r.hotel_id AND h.status = 'active'
       JOIN agencies oa ON oa.id = h.owner_agency_id AND oa.active
      WHERE s.agency_id = $1 AND s.rate_plan_id = $2 AND s.active`,
    [agencyId, ratePlanId])).rows[0];
  if (!row) throw httpError(404, "PRODUCT_NOT_PUBLISHED");
  return {
    markup: { type: row.markup_type, value: row.markup_value }, currency: String(row.currency).trim(), minorUnits: Number(row.minor_units),
    hotelId: row.hotel_id, maxAdults: row.max_adults, maxChildren: row.max_children,
    contractId: row.contract_id, contractCode: row.contract_code, contractName: row.contract_name, sellerLegalName: row.seller_legal_name,
    source: row.source, platformMarginPercent: row.platform_margin_percent, buyerMarkupPercent: row.buyer_markup_percent,
    platformFeePercent: row.platform_fee_percent
  };
}

/** Contract still the quoted one, active and valid for every night; every nationality still eligible. */
async function revalidateContract(client: PoolClient, sale: Sale, quotedContractId: string, checkIn: string, checkOut: string,
                                  nationalities: string[]) {
  if (sale.contractId !== quotedContractId) throw httpError(409, "CONTRACT_CHANGED");
  const ok = (await client.query(
    `SELECT 1 FROM hotel_contracts WHERE id = $1 AND status = 'active'
        AND (valid_from IS NULL OR valid_from <= $2::date) AND (valid_to IS NULL OR valid_to >= $3::date - 1)`,
    [sale.contractId, checkIn, checkOut])).rowCount === 1;
  if (!ok) throw httpError(409, "CONTRACT_NOT_AVAILABLE");
  const e = evaluateContract(await loadRules(client, [sale.contractId]), nationalities);
  if (!e.eligible) throw httpError(409, "NATIONALITY_NOT_ELIGIBLE", { nationalities: e.matches.filter(m => !m.eligible).map(m => m.nationality) });
  return e;
}

interface FrozenFx { contract: FxRate; payment: FxRate; paymentMinorUnits: number }

/** The FX rates the quote was priced with must still be the current fresh rates; otherwise PRICE_CHANGED. */
async function revalidateFx(client: PoolClient, contractCurrency: string, fxRateId: number | null,
                            paymentCurrency: string, paymentFxRateId: number | null): Promise<FrozenFx> {
  const fx = await loadFreshRates(client);
  const contract = fx.get(contractCurrency), payment = fx.get(paymentCurrency);
  if (!contract || contract.historyId !== fxRateId) throw httpError(409, "PRICE_CHANGED", { reason: "FX_RATE_CHANGED" });
  if (!payment || payment.historyId !== paymentFxRateId) throw httpError(409, "PRICE_CHANGED", { reason: "FX_RATE_CHANGED" });
  const cur = await activeCurrency(client, paymentCurrency);
  if (!cur) throw httpError(409, "PAYMENT_CURRENCY_NOT_SUPPORTED");
  return { contract, payment, paymentMinorUnits: cur.minorUnits };
}

/** Shared pricing for both booking and draft paths; publications retain their original markup. */
function saleNightMinor(netMinor: number, sale: Sale): number {
  return sale.source === "distribution_rule"
    ? priceMarketplaceChain(netMinor, sale.platformMarginPercent, sale.buyerMarkupPercent, 0, sale.minorUnits).saleMinor
    : nightlySellMinor(netMinor, sale.markup, sale.minorUnits);
}

/** Atomically decrements every night and writes the nightly price snapshot. Throws 409 on any failure. */
async function reserveNights(client: PoolClient, bookingId: string, ratePlanId: string, checkIn: string, checkOut: string,
                             rooms: number, sale: Sale, expectedTotalMinor: number) {
  const digits = sale.minorUnits;
  const nights: { date: string; inventoryId: string; netMinor: number; sellMinor: number }[] = [];
  for (const date of nightsBetween(checkIn, checkOut)) {
    const updated = await client.query(
      `UPDATE inventory_daily SET reserved = reserved + $3
        WHERE rate_plan_id = $1 AND stay_date = $2::date AND allotment - reserved >= $3
      RETURNING id, price::text AS price`,
      [ratePlanId, date, rooms]);
    if (updated.rowCount !== 1) throw httpError(409, "ALLOTMENT_UNAVAILABLE");
    const netMinor = parseMinor(updated.rows[0].price, digits);
    nights.push({ date, inventoryId: updated.rows[0].id, netMinor, sellMinor: saleNightMinor(netMinor, sale) });
  }
  const totalMinor = nights.reduce((s, n) => s + n.sellMinor, 0) * rooms;
  if (totalMinor !== expectedTotalMinor) throw httpError(409, "PRICE_CHANGED");
  for (const n of nights) {
    const breakdown = sale.source === "distribution_rule"
      ? priceMarketplaceChain(n.netMinor, sale.platformMarginPercent, sale.buyerMarkupPercent, sale.platformFeePercent, digits)
      : null;
    await client.query(
      `INSERT INTO booking_nights(booking_id, stay_date, inventory_id, rooms, net_price, markup_type, markup_value, sell_price, currency,
        marketplace_platform_margin_percent, marketplace_platform_margin, marketplace_buyer_cost,
        marketplace_buyer_markup_percent, marketplace_buyer_markup, marketplace_platform_fee_percent, marketplace_platform_fee)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [bookingId, n.date, n.inventoryId, rooms, formatMinor(n.netMinor, digits),
       sale.markup.type, normalizeDecimal(sale.markup.value), formatMinor(n.sellMinor, digits), sale.currency,
       breakdown?.platformMarginPercent ?? null,
       breakdown ? formatMinor(breakdown.platformMarginMinor, digits) : null,
       breakdown ? formatMinor(breakdown.buyerCostMinor, digits) : null,
       breakdown?.buyerMarkupPercent ?? null,
       breakdown ? formatMinor(breakdown.buyerMarkupMinor, digits) : null,
       breakdown?.platformFeePercent ?? null,
       breakdown ? formatMinor(breakdown.platformFeeMinor, digits) : null]);
  }
  return totalMinor;
}

/** The current price of the quoted nights without touching inventory (used for drafts). */
async function currentTotalMinor(client: PoolClient, ratePlanId: string, checkIn: string, checkOut: string, rooms: number, sale: Sale) {
  const rows = (await client.query(
    "SELECT price::text AS price FROM inventory_daily WHERE rate_plan_id = $1 AND stay_date >= $2::date AND stay_date < $3::date ORDER BY stay_date",
    [ratePlanId, checkIn, checkOut])).rows;
  if (rows.length !== nightsBetween(checkIn, checkOut).length) throw httpError(409, "ALLOTMENT_UNAVAILABLE");
  return rows.reduce((s: number, r: any) => s + saleNightMinor(parseMinor(r.price, sale.minorUnits), sale), 0) * rooms;
}

async function writeSnapshot(client: PoolClient, bookingId: string, sale: Sale, ratePlanId: string, nationalities: string[],
                             eligibility: ContractEligibility, totalMinor: number, fx: FrozenFx, paymentAmountMinor: number) {
  await client.query(
    `INSERT INTO booking_price_snapshots(booking_id, contract_id, contract_code, contract_name, seller_legal_name, rate_plan_id, nationalities,
        eligibility, contract_currency, contract_minor_units, total, eur_per_unit, fx_rate_history_id, fx_source, fx_valid_at,
        payment_currency, payment_minor_units, payment_eur_per_unit, payment_fx_rate_history_id, payment_amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7::char(2)[],$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [bookingId, sale.contractId, sale.contractCode, sale.contractName, sale.sellerLegalName, ratePlanId, nationalities,
     JSON.stringify(eligibility.matches), sale.currency, sale.minorUnits, formatMinor(totalMinor, sale.minorUnits),
     fx.contract.eurPerUnit, fx.contract.historyId, fx.contract.source, fx.contract.validAt || null,
     fx.payment.currency, fx.paymentMinorUnits, fx.payment.eurPerUnit, fx.payment.historyId,
     formatMinor(paymentAmountMinor, fx.paymentMinorUnits)]);
}

app.post("/api/agency/bookings", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  const agencyId = req.auth!.agencyId!;
  const idempotencyKey = String(req.header("Idempotency-Key") || "");
  if (!idempotencyKey || idempotencyKey.length > 128) return res.status(400).json({ error: "IDEMPOTENCY_KEY_REQUIRED" });

  // All nine lead-guest fields are mandatory. Occupancy lives in the guest object; dates and rooms come from the
  // signed quote. Every other guest is listed in otherGuests with a name and passport nationality.
  const errors: FieldErrors = {};
  const guest = validateGuest(req.body, errors);
  const occupancy = validateOccupancy(req.body?.guest, errors, "guest.");
  const otherGuests = occupancy ? validateOtherGuests(req.body?.otherGuests, occupancy, errors) : null;
  if (!req.body?.quoteId) errors.quoteId = "REQUIRED";
  if (req.body?.draft !== undefined && typeof req.body.draft !== "boolean") errors.draft = "BOOLEAN";
  if (!guest || !occupancy || !otherGuests || Object.keys(errors).length) return res.status(400).json({ error: "VALIDATION_FAILED", fields: errors });
  const { adults, children, childAges } = occupancy;
  const asDraft = req.body.draft === true;

  const checked = verifyQuote(req.body.quoteId, sessionSecret());
  if (!checked.ok) return res.status(checked.error === "QUOTE_EXPIRED" ? 409 : 400).json({ error: checked.error });
  const q = checked.quote;
  if (q.agencyId !== agencyId) return res.status(404).json({ error: "PRODUCT_NOT_PUBLISHED" });
  const sameAges = [...childAges].sort((a, b) => a - b).join(",") === [...q.childAges].sort((a, b) => a - b).join(",");
  const quoteRooms = q.roomOccupancies;
  const quoteAdults = quoteRooms.reduce((sum, room) => sum + room.adults, 0);
  const quoteChildren = quoteRooms.reduce((sum, room) => sum + room.children, 0);
  const quoteAges = quoteRooms.flatMap(room => room.childAges).sort((a, b) => a - b);
  if (adults !== q.adults || children !== q.children || !sameAges ||
      quoteRooms.length !== q.rooms || quoteAdults !== adults || quoteChildren !== children ||
      quoteAges.join(",") !== [...childAges].sort((a, b) => a - b).join(","))
    return res.status(409).json({ error: "QUOTE_OCCUPANCY_MISMATCH" });
  // Family nationality is the single nationality captured and signed at search time.
  const nationalities = [guest.nationality];
  if (nationalities.join(",") !== [...q.nationalities].sort().join(","))
    return res.status(409).json({ error: "QUOTE_NATIONALITY_MISMATCH" });

  const requestHash = createHash("sha256").update(JSON.stringify({ quoteId: req.body.quoteId, guest: req.body.guest, otherGuests: req.body.otherGuests ?? null, operationNote: req.body.operationNote, draft: asDraft })).digest("hex");
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
          // Replay only if the stored booking matches this request (rate plan, dates, rooms, lead guest name,
          // contact and nationality); otherwise the key is being reused for different content. A match binds the
          // fingerprint so later requests with this key take the normal path.
          const legacyId = row.response && typeof row.response === "object" ? row.response.id : undefined;
          const same = typeof legacyId === "string" && (await client.query(
            `SELECT 1 FROM bookings WHERE id::text = $1 AND agency_id = $2 AND rate_plan_id = $3 AND check_in = $4::date
                AND check_out = $5::date AND room_count = $6 AND lower(guest_first_name) = lower($7) AND lower(guest_last_name) = lower($8)
                AND (guest_email IS NULL OR lower(guest_email) = lower($9)) AND (guest_phone IS NULL OR guest_phone = $10)
                AND (guest_nationality IS NULL OR guest_nationality = $11) AND (operation_note IS NULL OR operation_note = $12)`,
            [legacyId, agencyId, q.ratePlanId, q.checkIn, q.checkOut, q.rooms, guest.firstName, guest.lastName,
             guest.email, guest.phone, guest.nationality, guest.operationNote])).rowCount === 1;
          if (!same) throw httpError(422, "IDEMPOTENCY_KEY_REUSED");
          await client.query("UPDATE idempotency_keys SET request_hash=$3 WHERE agency_id=$1 AND key=$2 AND request_hash IS NULL",
            [agencyId, idempotencyKey, requestHash]);
          return { status: 201, body: row.response };
        }
        if (row.request_hash !== requestHash) throw httpError(422, "IDEMPOTENCY_KEY_REUSED");
        return { status: 201, body: row.response };
      }

      const sale = await publishedSale(client, agencyId, q.ratePlanId); // re-check only the quoted winner
      if (sale.currency !== q.currency || sale.minorUnits !== q.minorUnits) throw httpError(409, "PRICE_CHANGED");
      if (!q.roomOccupancies.every(room => room.adults <= sale.maxAdults && room.children <= sale.maxChildren)) throw httpError(409, "OCCUPANCY_EXCEEDS_CAPACITY");
      const eligibility = await revalidateContract(client, sale, q.contractId, q.checkIn, q.checkOut, nationalities);
      const fx = await revalidateFx(client, q.currency, q.fxRateId, q.paymentCurrency, q.paymentFxRateId);
      if (fx.paymentMinorUnits !== q.paymentMinorUnits) throw httpError(409, "PRICE_CHANGED");

      const bookingId = randomUUID();
      const seq = (await client.query("SELECT nextval('booking_no_seq') AS n")).rows[0].n;
      const bookingNo = `B4B-${String(seq).padStart(8, "0")}`;
      const status = asDraft ? "draft" : "pending";
      const quotedTotal = formatMinor(q.totalMinor, q.minorUnits);
      await client.query(
        `INSERT INTO bookings(id, booking_no, agency_id, hotel_id, rate_plan_id, check_in, check_out, room_count, total, quoted_total, currency, status,
                              submitted_at, guest_first_name, guest_last_name, guest_email, guest_phone, guest_nationality, adults, children, child_ages, operation_note, room_occupancies)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11, CASE WHEN $11 = 'pending' THEN now() END, $12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb)`,
        [bookingId, bookingNo, agencyId, sale.hotelId, q.ratePlanId, q.checkIn, q.checkOut, q.rooms, quotedTotal, q.currency, status,
         guest.firstName, guest.lastName, guest.email, guest.phone, guest.nationality, adults, children, childAges, guest.operationNote, JSON.stringify(q.roomOccupancies)]);
      if (!asDraft) await reserveNights(client, bookingId, q.ratePlanId, q.checkIn, q.checkOut, q.rooms, sale, q.totalMinor);
      else if ((await currentTotalMinor(client, q.ratePlanId, q.checkIn, q.checkOut, q.rooms, sale)) !== q.totalMinor) throw httpError(409, "PRICE_CHANGED");
      const guests = [{ firstName: guest.firstName, lastName: guest.lastName, type: "adult", age: null as number | null, nationality: guest.nationality, isLead: true },
                      ...otherGuests.map(g => ({ ...g, nationality: guest.nationality, isLead: false }))];
      for (const [i, g] of guests.entries())
        await client.query(
          `INSERT INTO booking_guests(booking_id, guest_index, first_name, last_name, guest_type, age, nationality, is_lead) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [bookingId, i, g.firstName, g.lastName, g.type, g.age, g.nationality, g.isLead]);
      await writeSnapshot(client, bookingId, sale, q.ratePlanId, nationalities, eligibility, q.totalMinor, fx, q.paymentAmountMinor);
      await client.query("INSERT INTO booking_status_history(booking_id,from_status,to_status,actor_id,note) VALUES ($1,NULL,$2,$3,'Created by sub-agency')",
        [bookingId, status, req.auth!.sub]);
      await audit(client, req.auth!.sub, agencyId, asDraft ? "booking.draft_created" : "booking.created", "booking", bookingId, {
        targetAgencyId: agencyId,
        after: { contract: sale.contractCode, nationalities, eligibility: eligibility.matches, total: quotedTotal, currency: q.currency,
                 fxRateId: q.fxRateId, paymentCurrency: q.paymentCurrency, paymentAmount: formatMinor(q.paymentAmountMinor, q.paymentMinorUnits),
                 paymentFxRateId: q.paymentFxRateId } });
      const response = { id: bookingId, bookingNo, status, total: quotedTotal, currency: q.currency,
                         payment: { currency: q.paymentCurrency, total: formatMinor(q.paymentAmountMinor, q.paymentMinorUnits) } };
      await client.query("UPDATE idempotency_keys SET response=$3::jsonb WHERE agency_id=$1 AND key=$2", [agencyId, idempotencyKey, JSON.stringify(response)]);
      return { status: 201, body: response };
    }, agencyId);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
});

// Submitting a draft: draft -> pending. Re-checks contract, eligibility of every guest nationality, the FX rates
// frozen in the draft's snapshot and the quoted price, then decrements allotment atomically; on any failure the
// booking stays a draft and nothing changes.
app.post("/api/agency/bookings/:id/submit", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  try {
    const bookingId = uuidParam(req, "BOOKING_NOT_FOUND"), agencyId = req.auth!.agencyId!;
    const result = await withTransaction(async client => {
      const b = (await client.query(
        `UPDATE bookings SET status = 'pending', submitted_at = now(), updated_at = now()
          WHERE id = $1 AND agency_id = $2 AND status = 'draft'
        RETURNING rate_plan_id, check_in::text AS check_in, check_out::text AS check_out, room_count, quoted_total::text AS quoted_total, currency, adults, children, room_occupancies`,
        [bookingId, agencyId])).rows[0];
      if (!b) {
        const own = await client.query("SELECT status FROM bookings WHERE id=$1 AND agency_id=$2", [bookingId, agencyId]);
        if (!own.rowCount) throw httpError(404, "BOOKING_NOT_FOUND");
        throw httpError(409, "ONLY_DRAFT_CAN_BE_SUBMITTED", { status: own.rows[0].status });
      }
      const snap = (await client.query(
        `SELECT contract_id, nationalities, fx_rate_history_id, payment_currency, payment_fx_rate_history_id
           FROM booking_price_snapshots WHERE booking_id = $1`, [bookingId])).rows[0];
      if (!snap) throw httpError(409, "DRAFT_REQUIRES_NEW_QUOTE"); // draft created before nationality pricing existed
      const sale = await publishedSale(client, agencyId, b.rate_plan_id);
      if (sale.currency !== String(b.currency).trim()) throw httpError(409, "PRICE_CHANGED");
      if (Array.isArray(b.room_occupancies) && b.room_occupancies.length === b.room_count) {
        if (!b.room_occupancies.every((room: { adults: number; children: number }) => room.adults <= sale.maxAdults && room.children <= sale.maxChildren))
          throw httpError(409, "OCCUPANCY_EXCEEDS_CAPACITY");
      } else if (b.adults > sale.maxAdults * b.room_count || b.children > sale.maxChildren * b.room_count) {
        // Legacy drafts have no per-room distribution; preserve the historical aggregate check.
        throw httpError(409, "OCCUPANCY_EXCEEDS_CAPACITY");
      }
      await revalidateContract(client, sale, snap.contract_id, b.check_in, b.check_out, (snap.nationalities as string[]).map(x => x.trim()));
      await revalidateFx(client, sale.currency, snap.fx_rate_history_id === null ? null : Number(snap.fx_rate_history_id),
                         String(snap.payment_currency).trim(), snap.payment_fx_rate_history_id === null ? null : Number(snap.payment_fx_rate_history_id));
      await reserveNights(client, bookingId, b.rate_plan_id, b.check_in, b.check_out, b.room_count, sale, parseMinor(b.quoted_total, sale.minorUnits));
      await client.query("INSERT INTO booking_status_history(booking_id,from_status,to_status,actor_id,note) VALUES ($1,'draft','pending',$2,'Submitted by sub-agency')",
        [bookingId, req.auth!.sub]);
      await audit(client, req.auth!.sub, agencyId, "booking.submitted", "booking", bookingId,
        { targetAgencyId: agencyId, before: { status: "draft" }, after: { status: "pending" } });
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
      await audit(client, opts.actorId, updated.rows[0].agency_id, `booking.${opts.to}`, "booking", opts.bookingId,
        { targetAgencyId: updated.rows[0].agency_id, before: { status: from }, after: { status: opts.to } });
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
            b.adults, b.children, b.child_ages, b.room_occupancies, b.operation_note, b.created_at, b.updated_at,
            h.name AS hotel_name, h.location AS hotel_location, r.name AS room_name, rp.board_name, rp.cancellation_policy, rp.payment_terms,
            h.owner_agency_id AS hotel_owner_agency_id, a.parent_agency_id AS agency_parent_id
       FROM bookings b JOIN hotels h ON h.id = b.hotel_id JOIN agencies a ON a.id = b.agency_id
       JOIN rate_plans rp ON rp.id = b.rate_plan_id JOIN rooms r ON r.id = rp.room_id
      WHERE b.id = $1 AND ${scopeSql}`, [bookingId, ...scopeParams])).rows[0];
  if (!b) return null;
  const nights = (await pool.query(
    "SELECT stay_date::text AS date, rooms, sell_price, currency FROM booking_nights WHERE booking_id=$1 ORDER BY stay_date", [bookingId])).rows;
  const history = (await pool.query(
    "SELECT from_status, to_status, actor_id, note, created_at FROM booking_status_history WHERE booking_id=$1 ORDER BY id", [bookingId])).rows;
  const guests = (await pool.query(
    `SELECT guest_index AS index, first_name, last_name, guest_type AS type, age, nationality, is_lead
       FROM booking_guests WHERE booking_id = $1 ORDER BY guest_index`, [bookingId])).rows;
  const snapshot = (await pool.query(
    `SELECT contract_code, contract_name, seller_legal_name, nationalities, eligibility, contract_currency, total::text AS total,
            eur_per_unit::text AS eur_per_unit, fx_source, fx_valid_at, payment_currency, payment_amount::text AS payment_amount,
            payment_eur_per_unit::text AS payment_eur_per_unit, rounding, created_at
       FROM booking_price_snapshots WHERE booking_id = $1`, [bookingId])).rows[0] ?? null;
  return { ...b, nights, history, guests, priceSnapshot: snapshot };
}

// Agency-facing booking detail. The seller's legal name never leaves the platform. On a marketplace sale (the
// hotel belongs to another DMC than the viewer's) the contract code and name are the seller's own labels and are
// withheld too, so nothing identifies the seller DMC. Hierarchy columns are internal and never returned.
async function visibleBooking(detail: any, req: AuthedRequest) {
  const { hotel_owner_agency_id: owner, agency_parent_id: parent, ...rest } = detail;
  const role = req.auth!.role;
  if (role !== "master_agency" && role !== "sub_agency") return rest;
  const { agency_id, priceSnapshot, ...safe } = rest;
  const viewerDmc = role === "master_agency" ? req.auth!.agencyId : parent;
  let snapshot: any = null;
  if (priceSnapshot) {
    const { seller_legal_name, ...kept } = priceSnapshot;
    snapshot = kept;
    if (owner !== viewerDmc) { delete snapshot.contract_code; delete snapshot.contract_name; }
  }
  if (role === "master_agency")
    return { ...safe, priceSnapshot: snapshot, agency_name: parent === req.auth!.agencyId ? detail.agency_name : "BED4BOOK" };
  return { ...safe, priceSnapshot: snapshot };
}

app.get("/api/agency/bookings/:id", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  try {
    const detail = await bookingDetail(uuidParam(req, "BOOKING_NOT_FOUND"), "b.agency_id = $2", [req.auth!.agencyId]);
    if (!detail) return res.status(404).json({ error: "BOOKING_NOT_FOUND" });
    res.json(await visibleBooking(detail, req));
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
              h.name AS hotel_name, CASE WHEN $1::boolean OR a.parent_agency_id = $2 THEN a.name ELSE 'BED4BOOK' END AS agency_name
         FROM bookings b JOIN hotels h ON h.id = b.hotel_id JOIN agencies a ON a.id = b.agency_id
        WHERE ${withParamIndex(scope.sql, 3)}
        ORDER BY b.created_at DESC LIMIT 500`, [isPlatformWide(req.auth!.role), req.auth!.agencyId, ...scope.params]);
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

app.get("/api/backoffice/bookings/:id", ...backoffice, async (req: AuthedRequest, res, next) => {
  try {
    const scope = backofficeScope(req);
    const detail = await bookingDetail(uuidParam(req, "BOOKING_NOT_FOUND"), withParamIndex(scope.sql, 2), scope.params);
    if (!detail) return res.status(404).json({ error: "BOOKING_NOT_FOUND" });
    res.json(await visibleBooking(detail, req));
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
    roomName: b.room_name, board: b.board_name, rooms: b.room_count, roomOccupancies: b.room_occupancies,
    cancellationPolicy: b.cancellation_policy, paymentTerms: b.payment_terms,
    guestName: `${b.guest_first_name} ${b.guest_last_name}`, adults: b.adults, children: b.children, childAges: b.child_ages,
    nationality: b.guest_nationality, operationNote: b.operation_note, agencyName: (await visibleBooking(b, req)).agency_name, issuedAt: new Date()
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
// Proforma (not a tax invoice): for pending and approved bookings only, generated from the immutable price
// snapshot. The first request issues version 1 with a per-year sequential number (PF-YYYY-000001); later
// requests return the stored document unchanged. Back Office / system admin may reissue a new version (new
// number, linked to the previous one). Same access scope as vouchers.
// ---------------------------------------------------------------------------------------------
const PROFORMA_STATUSES = new Set(["pending", "approved"]);

async function issueProforma(bookingId: string, actorId: string, scopeSql: string, scopeParams: unknown[], reason: string | null, role?: string, agencyId?: string | null) {
  const b = await bookingDetail(bookingId, scopeSql, scopeParams);
  if (!b) throw httpError(404, "BOOKING_NOT_FOUND");
  // A cancelled or rejected booking gets no proforma, not even a previously issued one (its history stays
  // listed for Back Office via /proformas).
  if (!PROFORMA_STATUSES.has(b.status)) throw httpError(409, "PROFORMA_REQUIRES_PENDING_OR_APPROVED_BOOKING", { status: b.status });
  const latest = (await pool.query("SELECT id, number, version, pdf, sha256 FROM proformas WHERE booking_id = $1 ORDER BY version DESC LIMIT 1", [bookingId])).rows[0];
  if (latest && reason === null) return { pdf: latest.pdf as Buffer, sha256: latest.sha256 as string, number: latest.number as string, created: false };
  const snap = (await pool.query(
    `SELECT contract_code, seller_legal_name, contract_currency, total::text AS total, eur_per_unit::text AS eur_per_unit, fx_source, fx_valid_at,
            payment_currency, payment_amount::text AS payment_amount, payment_eur_per_unit::text AS payment_eur_per_unit
       FROM booking_price_snapshots WHERE booking_id = $1`, [bookingId])).rows[0];
  if (!snap) throw httpError(409, "PROFORMA_REQUIRES_PRICE_SNAPSHOT");
  const contractCurrency = String(snap.contract_currency).trim(), paymentCurrency = String(snap.payment_currency).trim();
  try {
    return await withTransaction(async client => {
      const settings = (await client.query("SELECT legal_name,address,tax_office,tax_number,phone,email FROM platform_settings WHERE id=1")).rows[0] || {};
      const platformSeller = settings.legal_name || "BED4BOOK";
      const year = new Date().getUTCFullYear();
      // Atomic per-year counter: one conditional upsert, no explicit lock; concurrent issues get distinct numbers.
      const seq = (await client.query(
        `INSERT INTO proforma_counters(year, last_seq) VALUES ($1, 1)
         ON CONFLICT (year) DO UPDATE SET last_seq = proforma_counters.last_seq + 1 RETURNING last_seq`, [year])).rows[0].last_seq as number;
      const number = `PF-${year}-${String(seq).padStart(6, "0")}`, version = latest ? latest.version + 1 : 1, issuedAt = new Date();
      const pdf = await renderProforma({
        number, version, supersedesNumber: latest?.number ?? null, issuedAt, sellerLegalName: platformSeller,
        sellerAddress: settings.address, sellerTaxOffice: settings.tax_office, sellerTaxNumber: settings.tax_number,
        sellerPhone: settings.phone, sellerEmail: settings.email,
        bookingNo: b.booking_no, bookingStatus: b.status, agencyName: role === "master_agency" && (await pool.query("SELECT parent_agency_id FROM agencies WHERE id=$1", [b.agency_id])).rows[0]?.parent_agency_id !== agencyId ? "BED4BOOK" : b.agency_name, hotelName: b.hotel_name, hotelLocation: b.hotel_location,
        checkIn: b.check_in, checkOut: b.check_out, nights: nightsBetween(b.check_in, b.check_out).length,
        roomName: b.room_name, board: b.board_name, rooms: b.room_count, roomOccupancies: b.room_occupancies,
        cancellationPolicy: b.cancellation_policy, paymentTerms: b.payment_terms,
        guests: b.guests.map((g: any) => ({ name: `${g.first_name} ${g.last_name}`, type: g.type, age: g.age, nationality: String(g.nationality).trim() })),
        contractCode: snap.contract_code, contractCurrency, contractAmount: snap.total, paymentCurrency, paymentAmount: snap.payment_amount,
        fx: paymentCurrency === contractCurrency ? null : { contractEurPerUnit: snap.eur_per_unit, paymentEurPerUnit: snap.payment_eur_per_unit,
                                                            source: snap.fx_source, validAt: snap.fx_valid_at ? new Date(snap.fx_valid_at).toISOString() : null }
      });
      const sha256 = createHash("sha256").update(pdf).digest("hex");
      const id = randomUUID();
      await client.query(
        `INSERT INTO proformas(id, booking_id, number, year, seq, version, supersedes, reason, booking_status, payment_currency, payment_amount,
                               contract_currency, contract_amount, seller_legal_name, issued_by, issued_at, pdf, sha256, seller_settings)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)`,
        [id, bookingId, number, year, seq, version, latest?.id ?? null, reason ?? "", b.status, paymentCurrency, snap.payment_amount,
         contractCurrency, snap.total, platformSeller, actorId, issuedAt.toISOString(), pdf, sha256, JSON.stringify({legal_name:platformSeller,address:settings.address??null,tax_office:settings.tax_office??null,tax_number:settings.tax_number??null,phone:settings.phone??null,email:settings.email??null})]);
      await audit(client, actorId, b.agency_id, version === 1 ? "proforma.issued" : "proforma.reissued", "booking", bookingId,
        { targetAgencyId: b.agency_id, after: { number, version, supersedes: latest?.number ?? null, reason, paymentCurrency, paymentAmount: snap.payment_amount, sha256 } });
      return { pdf, sha256, number, created: true };
    });
  } catch (error: any) {
    // Two first requests for the same booking at once: the loser of the (booking_id, version) race returns the winner's document.
    if (error?.code === "23505" && reason === null) {
      const row = (await pool.query("SELECT number, pdf, sha256 FROM proformas WHERE booking_id = $1 ORDER BY version DESC LIMIT 1", [bookingId])).rows[0];
      if (row) return { pdf: row.pdf as Buffer, sha256: row.sha256 as string, number: row.number as string, created: false };
    }
    throw error;
  }
}

function sendProforma(res: Response, p: { pdf: Buffer; sha256: string; number: string; created: boolean }) {
  res.status(p.created ? 201 : 200);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="BED4BOOK-${p.number}.pdf"`);
  res.setHeader("X-Proforma-Number", p.number);
  res.setHeader("X-Proforma-SHA256", p.sha256);
  res.send(p.pdf);
}

app.get("/api/agency/bookings/:id/proforma", authenticate, roles("sub_agency"), requireAgency, async (req: AuthedRequest, res, next) => {
  try { sendProforma(res, await issueProforma(uuidParam(req, "BOOKING_NOT_FOUND"), req.auth!.sub, "b.agency_id = $2", [req.auth!.agencyId], null)); }
  catch (error) { next(error); }
});

app.get("/api/backoffice/bookings/:id/proforma", ...backoffice, async (req: AuthedRequest, res, next) => {
  try { const scope = backofficeScope(req); sendProforma(res, await issueProforma(uuidParam(req, "BOOKING_NOT_FOUND"), req.auth!.sub, withParamIndex(scope.sql, 2), scope.params, null, req.auth!.role, req.auth!.agencyId)); }
  catch (error) { next(error); }
});

app.post("/api/backoffice/bookings/:id/proforma/reissue", authenticate, roles("system_admin", "back_office"), async (req: AuthedRequest, res, next) => {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason || reason.length > 500) return res.status(400).json({ error: "REASON_REQUIRED" });
    sendProforma(res, await issueProforma(uuidParam(req, "BOOKING_NOT_FOUND"), req.auth!.sub, "true", [], reason));
  } catch (error) { next(error); }
});

app.get("/api/backoffice/bookings/:id/proformas", ...backoffice, async (req: AuthedRequest, res, next) => {
  try {
    const scope = backofficeScope(req), bookingId = uuidParam(req, "BOOKING_NOT_FOUND");
    if (!(await bookingDetail(bookingId, withParamIndex(scope.sql, 2), scope.params))) return res.status(404).json({ error: "BOOKING_NOT_FOUND" });
    const items = (await pool.query(
      `SELECT number, version, reason, booking_status, payment_currency, payment_amount::text AS payment_amount, contract_currency,
              contract_amount::text AS contract_amount, seller_legal_name, issued_by, issued_at, sha256
         FROM proformas WHERE booking_id = $1 ORDER BY version`, [bookingId])).rows;
    res.json({ items: req.auth!.role === "master_agency" ? items.map(({ seller_legal_name, ...safe }: any) => safe) : items });
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
  if (!process.env.DATABASE_URL || sessionSecret().length < 32) throw new Error("DATABASE_URL and SESSION_SECRET (32+ chars) are required.");
  // A failed admin bootstrap must never keep the API down: log the reason (never the password) and start anyway.
  bootstrapAdmin().catch((error: any) => {
    console.error(`Yönetici başlangıç adımı başarısız: ${error?.message || "bilinmeyen hata"}`);
  }).finally(() => {
    app.listen(port, () => console.log(`BED4BOOK API listening on :${port}`));
  });
}
export default app;
