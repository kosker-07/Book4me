// Basic performance smoke test (Technical Specification §8, criterion 5: "temel performans testleri").
// Seeds a THROWAWAY database (all tables are truncated) with HOTELS hotels × 2 rate plans × NIGHTS nights,
// publishes them to one sub-agency, then measures search and booking latency through the HTTP API.
//   DATABASE_URL=postgres://.../throwaway npx tsx infra/scripts/perf-smoke.ts
// Prints p50/p95/max per operation and fails (exit 1) when search p95 exceeds PERF_SEARCH_P95_MS (default 500).
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

process.env.SESSION_SECRET ||= "perf-smoke-secret-at-least-32-characters";
const HOTELS = Number(process.env.PERF_HOTELS || 200), NIGHTS = 60, SEARCHES = Number(process.env.PERF_SEARCHES || 200), CONCURRENCY = 100;
const SEARCH_LIMIT_MS = Number(process.env.PERF_SEARCH_P95_MS || 500);
const BOOK_LIMIT_MS = Number(process.env.PERF_BOOK_P95_MS || 800);

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!; };
const stats = (xs: number[]) => `n=${xs.length} p50=${pct(xs, 50).toFixed(1)}ms p95=${pct(xs, 95).toFixed(1)}ms max=${Math.max(...xs).toFixed(1)}ms`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL (throwaway database) is required.");
  const { pool } = await import("../../server/db");
  const { hashPassword } = await import("../../server/security");
  const { default: app } = await import("../../server/app");
  await pool.query(`TRUNCATE agencies, users, hotels, rooms, rate_plans, inventory_daily, agency_hotel_sales, bookings,
    booking_status_history, booking_nights, audit_logs, idempotency_keys, fx_rates, login_attempts, vouchers, market_groups, fx_rate_history, proforma_counters CASCADE`);
  const master = randomUUID(), sub = randomUUID();
  await pool.query("INSERT INTO agencies(id,name,type) VALUES ($1,'Perf Master','master'),($2,'Perf Sub','sub')", [master, sub]);
  await pool.query("INSERT INTO users(email,password_hash,role,agency_id) VALUES ('perf@test.local',$1,'sub_agency',$2)", [hashPassword("perf-password-123"), sub]);
  const t0 = Date.now();
  await pool.query(`
    WITH h AS (INSERT INTO hotels(owner_agency_id,name,location,status)
               SELECT $1, 'Hotel ' || g, 'City ' || (g % 20), 'active' FROM generate_series(1,$3) g RETURNING id),
         r AS (INSERT INTO rooms(hotel_id,name,max_adults,max_children) SELECT id, 'Double', 2, 2 FROM h RETURNING id, hotel_id),
         p AS (INSERT INTO rate_plans(room_id,board_name,currency)
               SELECT r.id, b, 'EUR' FROM r CROSS JOIN (VALUES ('AI'),('BB')) v(b) RETURNING id, room_id),
         s AS (INSERT INTO agency_hotel_sales(agency_id,hotel_id,rate_plan_id,markup_type,markup_value)
               SELECT $2, r.hotel_id, p.id, 'percent', 10 FROM p JOIN r ON r.id = p.room_id RETURNING rate_plan_id)
    INSERT INTO inventory_daily(rate_plan_id,stay_date,price,allotment)
    SELECT s.rate_plan_id, current_date + 30 + d, 80 + (random() * 100)::int, 50 FROM s CROSS JOIN generate_series(0,$4 - 1) d`,
    [master, sub, HOTELS, NIGHTS]);
  console.log(`seeded ${HOTELS} hotels, ${HOTELS * 2} rate plans, ${HOTELS * 2 * NIGHTS} inventory rows in ${Date.now() - t0}ms`);

  const server = app.listen(0), base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, token?: string, headers: Record<string, string> = {}) => fetch(base + path, {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) });
  const token = (await (await post("/api/auth/login", { email: "perf@test.local", password: "perf-password-123" })).json()).token;
  const day = (o: number) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
  const stay = (i: number) => ({ checkIn: day(31 + (i % 20)), checkOut: day(34 + (i % 20)), rooms: 1, adults: 2, children: 0, childAges: [], roomOccupancies: [{ adults: 2, children: 0, childAges: [] }], nationalities: ["TR"] });

  const searchMs: number[] = []; let results = 0;
  for (let w = 0; w < SEARCHES / CONCURRENCY; w++)
    await Promise.all(Array.from({ length: CONCURRENCY }, async (_, k) => {
      const t = performance.now();
      const r = await post("/api/agency/searches", { ...stay(w * CONCURRENCY + k), limit: 50 }, token);
      searchMs.push(performance.now() - t);
      if (r.status !== 200) throw new Error(`search failed ${r.status}`);
      results = (await r.json()).results.length;
    }));
  const first = (await (await post("/api/agency/searches", { ...stay(0), limit: 100 }, token)).json()).results;
  const guest = { firstName: "P", lastName: "Q", adults: 2, children: 0, childAges: [], email: "p@q.test", phone: "+905550000000", nationality: "TR" };
  const bookMs: number[] = [];
  for (let w = 0; w < 1; w++)
    await Promise.all(first.slice(0, 100).map(async (q: any) => {
      const t = performance.now();
      const r = await post("/api/agency/bookings", { quoteId: q.quoteId, guest, otherGuests: [{ firstName: "R", lastName: "S", type: "adult", nationality: "TR" }], operationNote: "perf" }, token, { "Idempotency-Key": randomUUID() });
      bookMs.push(performance.now() - t);
      if (r.status !== 201) throw new Error(`booking failed ${r.status}`);
    }));
  console.log(`search  (${CONCURRENCY} concurrent, ${results} winners/response): ${stats(searchMs)}`);
  console.log(`booking (${CONCURRENCY} concurrent, 3 nights):                ${stats(bookMs)}`);
  const oversold=(await pool.query("SELECT count(*)::int AS n FROM inventory_daily WHERE reserved > allotment OR reserved < 0")).rows[0].n;
  const errors=searchMs.length!==SEARCHES || bookMs.length!==100 ? 1 : 0;
  console.log(`PERF_GATE search_p95=${pct(searchMs,95).toFixed(1)}ms booking_p95=${pct(bookMs,95).toFixed(1)}ms errors=${errors} oversold=${oversold} concurrent=${CONCURRENCY}`);
  server.close(); await pool.end();
  if (pct(searchMs,95)>=SEARCH_LIMIT_MS || pct(bookMs,95)>=BOOK_LIMIT_MS || errors!==0 || oversold!==0)
    throw new Error("PERF_GATE_FAILED: search<500ms booking<800ms errors=0 oversold=0 required");
  console.log("PERF_GATE_PASS");
}
main().catch(e => { console.error(e); process.exit(1); });
