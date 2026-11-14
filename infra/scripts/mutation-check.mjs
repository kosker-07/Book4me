#!/usr/bin/env node
// Mutation check M1–M24: each mutation temporarily injects a known defect, runs `npm run test:server` and
// verifies that the expected tests turn red. The source file is restored after every mutation (also on
// Ctrl-C / crash) and `git diff --quiet` proves it is byte-identical to the committed version.
//
// Safety: tests TRUNCATE every table. This script therefore never uses an existing database: it creates a
// fresh, empty database on a LOCAL server (socket, localhost or 127.0.0.1 only), applies the migrations,
// runs everything there and drops it at the end.
//
//   ADMIN_URL=postgres://user@localhost:5432/postgres node infra/scripts/mutation-check.mjs [--only M1,M7] [--dry-run]
//
// --dry-run applies and restores every mutation without running tests (checks that each patch still
// matches the code exactly once). --unit-only needs no database: it runs only the unit test files and checks
// the mutations that a unit test must catch (M2, M3, M8, M10, M19); the others are reported as not verifiable. Exit code 0 only when every mutation was caught and all files restored.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const M = [
  { id: "M1", what: "İptal/ret stok iadesini kaldır", expect: ["11", "12"], edits: [["server/booking-transition.ts",
    "if (RELEASING.has(opts.to) && CONSUMES_INVENTORY.has(from)) await releaseInventory(client, opts.bookingId);", ""]] },
  { id: "M2", what: "En yüksek fiyatı kazandır", expect: ["13"], unit: ["winner: lowest normalized total"], edits: [["server/pricing.ts",
    "if (!cur || o.eurCents < cur.eurCents!", "if (!cur || o.eurCents > cur.eurCents!"]] },
  { id: "M3", what: "Kur yoksa 1 kabul et", expect: ["15b"], unit: ["winner: an offer without an exchange rate"], edits: [["server/pricing.ts",
    "const rate = c.currency === \"EUR\" ? 1 : eurPerUnit.get(c.currency);", "const rate = c.currency === \"EUR\" ? 1 : (eurPerUnit.get(c.currency) ?? 1);"]] },
  { id: "M4", what: "Ana acente iptal engelini kaldır", expect: ["08"], edits: [["server/app.ts",
    "if (nextStatus === \"cancelled\" && !isPlatformWide(req.auth!.role)) return res.status(403).json({ error: \"CANCEL_NOT_ALLOWED\" });", ""]] },
  { id: "M5", what: "Back Office'i platform rolünden çıkar", expect: ["09", "11", "12"], edits: [["server/http.ts",
    "role === \"system_admin\" || role === \"back_office\";", "role === \"system_admin\";"]] },
  { id: "M6", what: "Aramaya envanter UPDATE'i ekle", expect: ["01"], edits: [["server/app.ts",
    "    res.json({ results });", "    await pool.query(\"UPDATE inventory_daily SET reserved = reserved + 1 WHERE reserved < allotment\");\n    res.json({ results });"]] },
  { id: "M7", what: "Stok güncellemesi başarısızsa başka fiyat planına geç", expect: ["14"], edits: [
    ["server/app.ts", "    if (updated.rowCount !== 1) throw httpError(409, \"ALLOTMENT_UNAVAILABLE\");",
     "    if (updated.rowCount !== 1) {\n      const alt = await client.query(`UPDATE inventory_daily SET reserved = reserved + $3 WHERE id = (SELECT id FROM inventory_daily WHERE rate_plan_id <> $1 AND stay_date = $2::date AND allotment - reserved >= $3 ORDER BY price LIMIT 1) RETURNING id, price::text AS price`, [ratePlanId, date, rooms]);\n      if (alt.rowCount !== 1) throw httpError(409, \"ALLOTMENT_UNAVAILABLE\");\n      updated.rows[0] = alt.rows[0];\n    }"],
    ["server/app.ts", "  if (totalMinor !== expectedTotalMinor) throw httpError(409, \"PRICE_CHANGED\");", ""]] },
  { id: "M8", what: "Sorguya FOR UPDATE ekle", expect: ["static"], unit: ["no explicit row locks"], edits: [["server/app.ts",
    "      WHERE s.agency_id = $1 AND s.rate_plan_id = $2 AND s.active`,", "      WHERE s.agency_id = $1 AND s.rate_plan_id = $2 AND s.active FOR UPDATE OF s`,"]] },
  { id: "M9", what: "Alt acenteye onaylı rezervasyon iptali aç", expect: ["11b"], edits: [["server/app.ts",
    "bookingId, to: \"cancelled\", from: [\"draft\", \"awaiting_credit_approval\", \"pending\"], scopeSql: \"b.agency_id = $4\"",
    "bookingId, to: \"cancelled\", from: [\"draft\", \"awaiting_credit_approval\", \"pending\", \"approved\"], scopeSql: \"b.agency_id = $4\""]] },
  { id: "M10", what: "Telefon doğrulamasını kaldır", expect: ["17"], unit: ["validation: guest fields"], edits: [["server/validation.ts",
    "  if (typeof g.phone !== \"string\" || !PHONE_RE.test(g.phone.trim())) errors[\"guest.phone\"] = \"REQUIRED_VALID_PHONE\";", ""],
    ["server/validation.ts", "phone: g.phone.trim(),", "phone: String(g.phone ?? \"\").trim(),"]] },
  { id: "M11", what: "Draft sırasında stok düş", expect: ["B1", "B2"], edits: [["server/app.ts",
    "      if (!asDraft && !awaitingApproval) await reserveNights(", "      if (!awaitingApproval) await reserveNights("]] },
  { id: "M25", what: "Kredi onayı beklerken stok düş", expect: ["C1"], edits: [["server/app.ts",
    "      if (!asDraft && !awaitingApproval) await reserveNights(", "      if (!asDraft) await reserveNights("]] },
  { id: "M12", what: "Draft iptalinde stok iadesi yap", expect: ["B2"], edits: [["server/booking-transition.ts",
    "export const CONSUMES_INVENTORY = new Set([\"pending\", \"approved\"]);", "export const CONSUMES_INVENTORY = new Set([\"draft\", \"pending\", \"approved\"]);"]] },
  { id: "M13", what: "Onaysız rezervasyona voucher üret", expect: ["A2", "A3"], edits: [["server/app.ts",
    "  if (b.status !== \"approved\") throw httpError(409, \"VOUCHER_REQUIRES_APPROVED_BOOKING\", { status: b.status });", ""]] },
  { id: "M14", what: "Ana acenteye başka otel yönetimi aç", expect: ["C1"], edits: [["server/admin-routes.ts",
    "  if (!isPlatformWide(req.auth!.role) && row.owner_agency_id !== req.auth!.agencyId) throw httpError(404, \"NOT_FOUND\");", ""]] },
  { id: "M15", what: "Giriş kilidini kaldır", expect: ["D1"], edits: [["server/app.ts",
    "    if (loginThrottled({", "    if (false && loginThrottled({"]] },
  { id: "M16", what: "token_version kontrolünü kaldır", expect: ["D2"], edits: [["server/http.ts",
    "      || (user.agency_id && !user.agency_active) || user.token_version !== (claims.ver ?? 0)) {",
    "      || (user.agency_id && !user.agency_active)) {"]] },
  { id: "M17", what: "Yayın hedefi alt acente şartını kaldır", expect: ["C2"], edits: [["server/admin-routes.ts",
    "  if (!target || target.type !== \"sub\" || !target.active) throw httpError(400, \"TARGET_MUST_BE_ACTIVE_SUB_AGENCY\");",
    "  if (!target) throw httpError(400, \"TARGET_MUST_BE_ACTIVE_SUB_AGENCY\");"]] },
  { id: "M18", what: "Voucher otel adını konumla değiştir", expect: ["A2"], edits: [["server/app.ts",
    "bookingNo: b.booking_no, status: b.status, hotelName: b.hotel_name,", "bookingNo: b.booking_no, status: b.status, hotelName: b.hotel_location,"]] },
  { id: "M32", what: "transient AI provider error is never retried (mail lost)", expect: ["IN11:"], edits: [["server/ai/jobs.ts",
    "  if(isTransientAiError(error)&&attempts<MAX_AI_JOB_ATTEMPTS){", "  if(false&&attempts<MAX_AI_JOB_ATTEMPTS){"]] },
  { id: "M31", what: "quote token readable", expect: ["quotes:"], unit: ["quotes: encrypted q3"], edits: [["server/quotes.ts",
    '  return `q3.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;',
    '  return `q2.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.plain`;']] },
  // ---- nationality-based contract pricing
  { id: "M19", what: "Uyruk hariç tutma kuralını yok say", expect: ["N04"], unit: ["eligibility: exclusion first"], edits: [["server/eligibility.ts",
    "  const excluded = rules.filter(r => r.type === \"exclude\" && appliesTo(r, nationality));", "  const excluded: NationalityRule[] = [];"]] },
  { id: "M20", what: "Uygun olmayan kontrat aramada yarışsın (başka pazarın fiyatına düşüş)", expect: ["N05"], edits: [["server/app.ts",
    "        return e.eligible;   // ineligible contracts never compete and are never shown", "        return true;"]] },
  { id: "M21", what: "Rezervasyonda uyruk uygunluğunu yeniden kontrol etme", expect: ["N09", "N16"], edits: [["server/app.ts",
    "  if (!e.eligible) throw httpError(409, \"NATIONALITY_NOT_ELIGIBLE\", { nationalities: e.matches.filter(m => !m.eligible).map(m => m.nationality) });", ""]] },
  { id: "M22", what: "Proforma güncel kurla yeniden çevirsin", expect: ["N17"], edits: [["server/app.ts",
    "            payment_currency, payment_amount::text AS payment_amount, payment_eur_per_unit::text AS payment_eur_per_unit",
    "            payment_currency, round(total * coalesce((SELECT f.eur_per_unit FROM fx_rates f WHERE f.currency = contract_currency), 1) / payment_eur_per_unit, 2)::text AS payment_amount, payment_eur_per_unit::text AS payment_eur_per_unit"]] },
  { id: "M23", what: "Rezervasyonda kontrat para birimi kur değişimini kontrol etme", expect: ["N12"], edits: [["server/app.ts",
    "  if (!contract || contract.historyId !== fxRateId) throw httpError(409, \"PRICE_CHANGED\", { reason: \"FX_RATE_CHANGED\" });", ""]] },
  { id: "M40", what: "Remove DMC subagency ownership predicate", expect: ["J16 tenant foreign/missing identical: GET /api/dmc/subagencies/:id"], edits: [["server/dmc-routes.ts",
    "WHERE id=$1 AND type='sub' AND parent_agency_id=$2", "WHERE id=$1 AND type='sub'"]] },
  { id: "M24", what: "Rezervasyonda ödeme para birimi kur değişimini kontrol etme", expect: ["N12"], edits: [["server/app.ts",
    "  if (!payment || payment.historyId !== paymentFxRateId) throw httpError(409, \"PRICE_CHANGED\", { reason: \"FX_RATE_CHANGED\" });", ""]] }
];

M.push({ id: "M36", what: "Browser idle expiry not enforced", expect: ["SI4"], edits: [["server/security.ts",
  "const exp = claims.max === undefined ? nowSec + TOKEN_TTL_SECONDS : Math.min(nowSec + IDLE_TTL_SECONDS, claims.max);",
  "const exp = claims.max === undefined ? nowSec + TOKEN_TTL_SECONDS : claims.max;"]] });

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run"), unitOnly = args.includes("--unit-only");
const onlyArg = args[args.indexOf("--only") + 1];
const selected = args.includes("--only") ? M.filter(m => onlyArg.split(",").includes(m.id)) : M;
const files = [...new Set(M.flatMap(m => m.edits.map(e => e[0])))];

// ---- refuse to start on a dirty tree: restoring must yield the committed bytes
for (const f of files) {
  if (spawnSync("git", ["diff", "--quiet", "HEAD", "--", f]).status !== 0) { console.error(`${f} has uncommitted changes; commit or stash first.`); process.exit(2); }
}
const originals = new Map(files.map(f => [f, readFileSync(f, "utf8")]));
const restoreAll = () => { for (const [f, src] of originals) writeFileSync(f, src); };
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restoreAll(); process.exit(130); });
process.on("exit", restoreAll);

function apply(m) {
  const touched = new Map();
  for (const [f, find, repl] of m.edits) {
    const src = touched.get(f) ?? originals.get(f);
    const n = src.split(find).length - 1;
    if (n !== 1) throw new Error(`${m.id}: patch for ${f} matches ${n} times (expected exactly 1) — update the mutation`);
    touched.set(f, src.replace(find, () => repl));
  }
  for (const [f, src] of touched) writeFileSync(f, src);
  return [...touched.keys()];
}
function restore(touched) {
  for (const f of touched) writeFileSync(f, originals.get(f));
  for (const f of touched) if (spawnSync("git", ["diff", "--quiet", "HEAD", "--", f]).status !== 0) throw new Error(`${f} was not restored`);
}

// ---- throwaway database
let dbUrl = "", adminUrl = "", dbName = "";
function setupDatabase() {
  adminUrl = process.env.ADMIN_URL || "";
  if (!adminUrl) { console.error("ADMIN_URL (local maintenance database, e.g. .../postgres) is required."); process.exit(2); }
  if (process.env.NODE_ENV === "production") { console.error("Refusing to run with NODE_ENV=production."); process.exit(2); }
  const u = new URL(adminUrl);
  const host = u.hostname || u.searchParams.get("host") || "";
  if (!(host === "" || host.startsWith("/") || ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host))) {
    console.error(`Refusing non-local database host "${host}". Mutation tests only run against a local throwaway server.`); process.exit(2);
  }
  dbName = `bed4book_mutation_${process.pid}`;
  execFileSync("psql", [adminUrl, "-v", "ON_ERROR_STOP=1", "-qc", `CREATE DATABASE ${dbName}`]);
  const d = new URL(adminUrl); d.pathname = `/${dbName}`; dbUrl = d.toString();
  execFileSync("npx", ["tsx", "server/migrate.ts"], { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: ["ignore", "ignore", "inherit"] });
  process.on("exit", () => { try { execFileSync("psql", [adminUrl, "-qc", `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`]); } catch { /* best effort */ } });
}

/** Runs the server test suite; returns the ids of failed tests (first word of the test name) and full names. */
function runTests() {
  const cmd = unitOnly
    ? ["tsx", ["--test", "--test-concurrency=1", "--test-reporter=tap", "tests/server/rules.test.ts", "tests/server/security.test.ts"]]
    : ["npm", ["run", "test:server"]];
  const r = spawnSync(cmd[0], cmd[1], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: unitOnly ? { ...process.env, DATABASE_URL: "", CI: "", NODE_ENV: "test" }
                  : { ...process.env, DATABASE_URL: dbUrl, CI: "true", NODE_ENV: "test", TRUST_PROXY: "", NODE_OPTIONS: "--test-reporter=tap" }
  });
  const out = r.stdout + r.stderr;
  const failed = new Set(), names = [];
  for (const line of out.split("\n")) {
    const m = /^\s*not ok \d+ - (.+?)(?:\s+#.*)?$/.exec(line);
    if (!m) continue;
    const name = m[1]; names.push(name);
    if (/no explicit row locks/.test(name)) failed.add("static");
    failed.add(name.split(/\s+/)[0]);
  }
  const total = /# tests (\d+)/.exec(out)?.[1], pass = /# pass (\d+)/.exec(out)?.[1], fail = /# fail (\d+)/.exec(out)?.[1];
  return { failed, names, summary: `tests=${total} pass=${pass} fail=${fail}`, code: r.status };
}

let allOk = true;
if (!dryRun) {
  if (!unitOnly) setupDatabase();
  const base = runTests();
  console.log(`baseline: ${base.summary}`);
  if (base.code !== 0 || base.failed.size) { console.error(`baseline is not green: ${[...base.failed].join(", ")}`); process.exit(1); }
}
console.log(`| Mutation | Geçici hata | Beklenen kırmızı${unitOnly ? " (entegrasyon)" : ""} | Gerçek kırmızı${unitOnly ? " (birim)" : ""} | Sonuç |\n|---|---|---|---|---|`);
for (const m of selected) {
  let touched = [];
  try {
    touched = apply(m);
    if (dryRun) { console.log(`| ${m.id} | ${m.what} | ${m.expect.join(", ")} | (dry run) | patch applies |`); continue; }
    if (unitOnly && !m.unit) { console.log(`| ${m.id} | ${m.what} | ${m.expect.join(", ")} | — | DOĞRULANAMADI (veritabanlı test gerekli) |`); continue; }
    const r = runTests();
    const red = unitOnly ? r.names : [...r.failed];
    const caught = unitOnly ? m.unit.every(u => r.names.some(n => n.startsWith(u))) : m.expect.every(e => r.failed.has(e));
    allOk &&= caught;
    console.log(`| ${m.id} | ${m.what} | ${m.expect.join(", ")} | ${red.join(", ") || "—"} | ${caught ? "YAKALANDI" : "KAÇTI"} |`);
  } catch (e) {
    allOk = false; console.log(`| ${m.id} | ${m.what} | ${m.expect.join(", ")} | — | HATA: ${e.message} |`);
  } finally {
    restore(touched);
  }
}
if (spawnSync("git", ["diff", "--quiet", "HEAD", "--", ...files]).status !== 0) { console.error("source files differ from HEAD after the run"); allOk = false; }
else console.log(`\nall mutated files restored: git diff --quiet HEAD -- ${files.join(" ")} → clean`);
if (!dryRun) {
  const fin = runTests();
  console.log(`final run (no mutation): ${fin.summary}`);
  allOk &&= fin.code === 0 && fin.failed.size === 0;
}
process.exit(allOk ? 0 : 1);
