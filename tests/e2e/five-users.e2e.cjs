// End-to-end test with five concurrent users in five separate browser sessions, against the REAL API
// (server/app.ts) and a REAL, throwaway PostgreSQL database, using the static web UI (web/).
//   system_admin, back_office, master_agency, sub_agency A, sub_agency B
// The catalogue is created through the management API; every user action after that goes through the UI.
//
// Required env: DATABASE_URL (throwaway DB, migrations applied), API_URL (running API), UI_URL (static web/
// served with config.js pointing at API_URL). Playwright is resolved from NODE_PATH; pg from the repo.
// Refuses to run against a non-local database. Exit code 0 only when every check passes.
const { chromium } = require("playwright");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Pool } = require(path.resolve(__dirname, "../../node_modules/pg"));

const API = process.env.API_URL, UI = process.env.UI_URL, DB = process.env.DATABASE_URL;
if (!API || !UI || !DB) { console.error("API_URL, UI_URL and DATABASE_URL are required"); process.exit(2); }
const dbHost = new URL(DB).hostname;
if (!["localhost", "127.0.0.1", "::1", ""].includes(dbHost)) { console.error(`Refusing non-local database host ${dbHost}`); process.exit(2); }

const PW = "e2e-strong-password-1";
const pool = new Pool({ connectionString: DB });
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
let pass = 0, fail = 0;
const log = [];
const ok = (cond, msg) => { cond ? pass++ : fail++; log.push(`${cond ? "✓" : "✗"} ${msg}`); console.log(`${cond ? "✓" : "✗"} ${msg}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { ok(false, `${name}: ${e.message.split("\n")[0]}`); } };
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

async function api(method, p, body, token) {
  const r = await fetch(API + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  if (r.status >= 400) throw new Error(`${method} ${p} → ${r.status} ${text}`);
  return json;
}
const tokenOf = async email => (await api("POST", "/api/auth/login", { email, password: PW })).token;
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const bodyText = page => page.evaluate(() => document.body.innerText);
async function waitText(page, re, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (re.test(await bodyText(page))) return true; await page.waitForTimeout(150); }
  return false;
}
const reserved = async rp => (await q("SELECT reserved FROM inventory_daily WHERE rate_plan_id=$1 AND stay_date >= $2 AND stay_date < $3 ORDER BY stay_date", [rp, STAY.in, STAY.out])).map(r => r.reserved);
const STAY = { in: day(1), out: day(3) }; // the UI's default search dates (tomorrow → +3 days)

(async () => {
  // ------------------------------------------------------------------ 0. catalogue and users via the API
  const created = spawnSync(process.execPath, ["--import", "tsx", "server/cli/create-admin.ts", "admin@e2e.test"], { input: PW, env: process.env, encoding: "utf8" });
  ok(created.status === 0, "ilk sistem yöneticisi CLI ile oluşturuldu" + (created.status ? `: ${created.stderr}` : ""));
  const admin = await tokenOf("admin@e2e.test");
  const M1 = (await api("POST", "/api/admin/agencies", { name: "E2E Ana Acente", type: "master" }, admin)).id;
  const SA = (await api("POST", "/api/admin/agencies", { name: "E2E Alt Acente A", type: "sub" }, admin)).id;
  const SB = (await api("POST", "/api/admin/agencies", { name: "E2E Alt Acente B", type: "sub" }, admin)).id;
  for (const [email, role, agencyId] of [["bo@e2e.test", "back_office", null], ["m1@e2e.test", "master_agency", M1], ["a@e2e.test", "sub_agency", SA], ["b@e2e.test", "sub_agency", SB]])
    await api("POST", "/api/admin/users", { email, password: PW, role, agencyId }, admin);
  const hotel = (await api("POST", "/api/admin/hotels", { name: "E2E Deniz Otel", location: "Antalya", category: "5*", ownerAgencyId: M1 }, admin)).id;
  const room = (await api("POST", `/api/admin/hotels/${hotel}/rooms`, { name: "Deluxe Deniz", maxAdults: 3, maxChildren: 2 }, admin)).id;
  const rp = (await api("POST", `/api/admin/rooms/${room}/rate-plans`, { boardName: "AI", currency: "EUR", cancellationPolicy: { freeUntilDays: 7 }, paymentTerms: { prepay: true }, salesConditions: {} }, admin)).id;
  await api("PUT", `/api/admin/rate-plans/${rp}/calendar`, { dateFrom: day(0), dateTo: day(14), price: 100, allotment: 1 }, admin);
  for (const ag of [SA, SB]) await api("POST", "/api/admin/publications", { ratePlanId: rp, agencyId: ag, markupType: "percent", markupValue: 10 }, admin);
  await api("PATCH", `/api/admin/hotels/${hotel}`, { status: "active" }, admin);
  ok(true, "katalog API ile kuruldu (1 otel, kontenjan 1, iki alt acenteye %10 markup ile yayın)");

  // ------------------------------------------------------------------ 1. five browser sessions log in concurrently
  const browser = await chromium.launch();
  const users = { admin: "admin@e2e.test", bo: "bo@e2e.test", m1: "m1@e2e.test", a: "a@e2e.test", b: "b@e2e.test" };
  const S = {};
  for (const [k, email] of Object.entries(users)) {
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(); const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) errors.push(m.text()); });
    page.on("dialog", d => d.accept());
    S[k] = { ctx, page, errors, email };
  }
  await Promise.all(Object.values(S).map(async s => {
    await s.page.goto(UI);
    await tid(s.page, "login-email").fill(s.email); await tid(s.page, "login-password").fill(PW); await tid(s.page, "login-submit").click();
  }));
  await step("giriş", async () => {
    for (const k of ["a", "b"]) { await tid(S[k].page, "search-form").waitFor({ timeout: 8000 }); }
    ok(true, "5 kullanıcı aynı anda giriş yaptı; alt acenteler arama panelinde");
    for (const k of ["admin", "bo", "m1"]) {
      await S[k].page.waitForTimeout(500);
      ok(await tid(S[k].page, "search-form").count() === 0 && await tid(S[k].page, "nav-admin").count() === 1, `${k}: arama paneli yok, yönetim menüsü var`);
    }
    ok(await tid(S.a.page, "nav-admin").count() === 0, "alt acentede yönetim menüsü yok");
  });

  // ------------------------------------------------------------------ 2. both sub-agencies search and book the last room at once
  const fillGuest = async (page, first) => {
    for (const [n, v] of Object.entries({ firstName: first, lastName: "Yılmaz", email: `${first.toLowerCase()}@example.com`, phone: "+90 532 000 11 22", nationality: "TR", operationNote: "Geç giriş" }))
      await page.locator(`[data-testid="guest-${n}"]`).fill(v);
  };
  await step("arama", async () => {
    await Promise.all(["a", "b"].map(k => tid(S[k].page, "search-submit").click()));
    for (const k of ["a", "b"]) {
      await tid(S[k].page, "result-card").first().waitFor({ timeout: 8000 });
      const card = await tid(S[k].page, "result-card").first().innerText();
      ok(/E2E Deniz Otel/.test(card) && /220,00|220\.00/.test(card), `${k}: tek sonuç, doğru satış fiyatı 220,00 € (net 100 + %10, 2 gece)`);
      ok(!/100,00|\b100\.00\b|markup|net/i.test(card), `${k}: net fiyat ve markup görünmüyor`);
    }
    ok((await q("SELECT count(*)::int c FROM bookings"))[0].c === 0 && (await reserved(rp)).every(x => x === 0), "arama hiçbir kayıt oluşturmadı, stok değişmedi");
  });
  let winner = null, loser = null;
  await step("eşzamanlı son oda", async () => {
    for (const k of ["a", "b"]) { await tid(S[k].page, "book-button").first().click(); await fillGuest(S[k].page, k === "a" ? "Ayse" : "Burak"); }
    await Promise.all(["a", "b"].map(k => tid(S[k].page, "booking-submit").click()));
    const res = {};
    for (const k of ["a", "b"]) res[k] = (await waitText(S[k].page, /Rezervasyon oluşturuldu/, 8000)) ? "ok" : ((await waitText(S[k].page, /müsait değil/, 2000)) ? "full" : "?");
    winner = ["a", "b"].find(k => res[k] === "ok"); loser = ["a", "b"].find(k => res[k] === "full");
    ok(!!winner && !!loser, `kontenjan 1, iki acente aynı anda: biri başarılı, diğeri "müsait değil" mesajı (${JSON.stringify(res)})`);
    ok((await q("SELECT count(*)::int c FROM bookings"))[0].c === 1, "veritabanında tam 1 rezervasyon (aşım yok)");
    ok(JSON.stringify(await reserved(rp)) === "[1,1]", "stok her gece tam 1 düştü");
  });

  // ------------------------------------------------------------------ 3. more allotment; the other agency books; a draft is created and submitted
  await api("PUT", `/api/admin/rate-plans/${rp}/calendar`, { dateFrom: day(0), dateTo: day(14), price: 100, allotment: 5 }, admin);
  await step("ikinci rezervasyon + taslak", async () => {
    const L = S[loser || "b"].page;
    await tid(L, "nav-search").click().catch(() => {});
    await tid(L, "search-submit").click(); await tid(L, "result-card").first().waitFor({ timeout: 8000 });
    await tid(L, "book-button").first().click(); await fillGuest(L, "Burak"); await tid(L, "booking-submit").click();
    ok(await waitText(L, /Rezervasyon oluşturuldu/), "diğer acente kontenjan artınca rezervasyon yaptı");
    const W = S[winner || "a"].page;
    await tid(W, "nav-search").click().catch(() => {});
    await tid(W, "search-submit").click(); await tid(W, "result-card").first().waitFor({ timeout: 8000 });
    await tid(W, "book-button").first().click(); await fillGuest(W, "Taslak"); await tid(W, "booking-draft").click();
    await waitText(W, /Taslak|oluşturuldu|kaydedildi/i);
    const drafts = await q("SELECT id FROM bookings WHERE status='draft'");
    ok(drafts.length === 1, "taslak kaydedildi");
    ok(JSON.stringify(await reserved(rp)) === "[2,2]", "taslak stok tüketmedi");
    await tid(W, "nav-bookings").click().catch(() => {}); await tid(W, "booking-row").first().waitFor({ timeout: 8000 });
    await W.locator('[data-testid="submit-draft"]').first().click();
    const end = Date.now() + 6000; while (Date.now() < end && (await q("SELECT count(*)::int c FROM bookings WHERE status='draft'"))[0].c) await W.waitForTimeout(150);
    ok((await q("SELECT count(*)::int c FROM bookings WHERE status='draft'"))[0].c === 0, "taslak arayüzden gönderildi (beklemede)");
    ok(JSON.stringify(await reserved(rp)) === "[3,3]", "gönderimde stok bir kez düştü");
  });

  const no = async ag => (await q("SELECT booking_no FROM bookings WHERE agency_id=$1 ORDER BY created_at", [ag])).map(r => r.booking_no);
  const aNos = await no(SA), bNos = await no(SB);

  // ------------------------------------------------------------------ 4. isolation between sub-agencies
  await step("acente izolasyonu", async () => {
    for (const [k, mine, other] of [["a", aNos, bNos], ["b", bNos, aNos]]) {
      await tid(S[k].page, "nav-bookings").click().catch(() => {}); await tid(S[k].page, "refresh-bookings").click().catch(() => {});
      await tid(S[k].page, "booking-row").first().waitFor({ timeout: 8000 }); await S[k].page.waitForTimeout(300);
      const t = await bodyText(S[k].page);
      ok(mine.every(n => t.includes(n)) && other.every(n => !t.includes(n)), `${k}: yalnız kendi rezervasyonlarını görüyor (${mine.length}), diğer acentenin hiçbirini görmüyor`);
    }
  });

  // ------------------------------------------------------------------ 5. master agency approves, has no cancel
  const rowOf = (page, bookingNo) => page.locator('[data-testid="booking-row"]', { hasText: bookingNo });
  await step("ana acente onayı", async () => {
    const P = S.m1.page; await tid(P, "refresh-bookings").click().catch(() => {}); await tid(P, "booking-row").first().waitFor({ timeout: 8000 });
    await P.waitForTimeout(300);
    ok(await tid(P, "booking-row").count() === 3, "ana acente kendi otelinin 3 rezervasyonunu görüyor");
    ok(await tid(P, "cancel-button").count() === 0, "ana acentede iptal butonu yok");
    await rowOf(P, aNos[0]).locator('[data-testid="approve-button"]').click();
    const end = Date.now() + 6000; while (Date.now() < end && (await q("SELECT status FROM bookings WHERE booking_no=$1", [aNos[0]]))[0].status !== "approved") await P.waitForTimeout(150);
    ok((await q("SELECT status FROM bookings WHERE booking_no=$1", [aNos[0]]))[0].status === "approved", `ana acente arayüzden onayladı (${aNos[0]})`);
  });

  // ------------------------------------------------------------------ 6. Back Office cancels; allotment returns exactly once
  await step("Back Office iptali", async () => {
    const P = S.bo.page; await tid(P, "refresh-bookings").click().catch(() => {}); await tid(P, "booking-row").first().waitFor({ timeout: 8000 });
    await P.waitForTimeout(300);
    ok(await tid(P, "booking-row").count() === 3, "Back Office tüm rezervasyonları görüyor");
    const before = await reserved(rp);
    await rowOf(P, bNos[0]).locator('[data-testid="cancel-button"]').click();
    const end = Date.now() + 6000; while (Date.now() < end && (await q("SELECT status FROM bookings WHERE booking_no=$1", [bNos[0]]))[0].status !== "cancelled") await P.waitForTimeout(150);
    ok((await q("SELECT status FROM bookings WHERE booking_no=$1", [bNos[0]]))[0].status === "cancelled", `Back Office arayüzden iptal etti (${bNos[0]})`);
    const after = await reserved(rp);
    ok(after.every((v, i) => v === before[i] - 1), `iptalde stok tam bir kez iade edildi (${JSON.stringify(before)} → ${JSON.stringify(after)})`);
    ok(await rowOf(P, aNos[0]).locator('[data-testid="cancel-button"]').count() === 1, "Back Office onaylı rezervasyonu iptal edebilir (buton var)");
  });

  // ------------------------------------------------------------------ 7. sub-agency A downloads the voucher; cannot cancel an approved booking
  await step("voucher", async () => {
    const P = S.a.page; await tid(P, "refresh-bookings").click(); await P.waitForTimeout(500);
    const row = rowOf(P, aNos[0]);
    ok(await row.locator('[data-testid="cancel-button"]').count() === 0, "alt acente onaylı rezervasyonu iptal edemez (buton yok)");
    const [dl] = await Promise.all([P.waitForEvent("download", { timeout: 8000 }), row.locator('[data-testid="voucher-button"]').click()]);
    const file = await dl.path(); const head = require("node:fs").readFileSync(file).subarray(0, 5).toString();
    ok(head === "%PDF-", "onaylı rezervasyon için voucher PDF indirildi");
    ok((await q("SELECT count(*)::int c FROM vouchers"))[0].c === 1, "voucher üretimi kayda geçti");
  });

  // ------------------------------------------------------------------ 8. final consistency and errors
  await step("son tutarlılık", async () => {
    const live = (await q("SELECT coalesce(sum(room_count),0)::int s FROM bookings WHERE status IN ('pending','approved')"))[0].s;
    ok((await reserved(rp)).every(v => v === live), `stok = beklemede + onaylı rezervasyon sayısı (${live})`);
    ok((await q("SELECT count(*)::int c FROM bookings"))[0].c === 3, "toplam 3 rezervasyon (fazladan kayıt yok)");
    for (const [k, s] of Object.entries(S)) ok(s.errors.length === 0, `${k}: tarayıcıda sayfa/konsol hatası yok${s.errors.length ? " — " + s.errors.slice(0, 2).join(" | ") : ""}`);
  });

  await browser.close(); await pool.end();
  console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı (%${Math.round((100 * pass) / (pass + fail))})`);
  process.exit(fail ? 1 : 0);
})().catch(async e => { console.error("E2E crashed:", e); try { await pool.end(); } catch {} process.exit(1); });
