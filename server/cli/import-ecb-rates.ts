// Imports the ECB daily euro reference rates into fx_rates (history is recorded by the database trigger).
//   DATABASE_URL=... npm run fx:import-ecb                      fetches https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
//   DATABASE_URL=... npm run fx:import-ecb -- --file rates.xml  imports a downloaded file
// Only allow-listed, active currencies are imported. The ECB does not publish every allow-listed currency
// (e.g. AED, SAR, KWD): those are listed at the end and must be entered from the approved alternative source
// through POST /api/admin/fx-rates.
import { readFileSync } from "node:fs";
import { pool } from "../db";
import { parseEcbDailyXml } from "../fx";

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const args = process.argv.slice(2);
  const file = args.includes("--file") ? args[args.indexOf("--file") + 1] : undefined;
  const xml = file ? readFileSync(file, "utf8") : await (await fetch(ECB_URL)).text();
  const parsed = parseEcbDailyXml(xml);
  // ECB rates are published around 16:00 CET for the given date; never record a time in the future.
  const validAt = new Date(Math.min(Date.parse(`${parsed.date}T15:00:00Z`), Date.now()));
  const allowed = new Set<string>((await pool.query("SELECT code FROM currencies WHERE active AND code <> 'EUR'")).rows.map((r: any) => String(r.code).trim()));
  const imported: string[] = [], skipped: string[] = [];
  for (const r of parsed.rates) {
    if (!allowed.has(r.currency)) { skipped.push(r.currency); continue; }
    await pool.query(
      `INSERT INTO fx_rates(currency, eur_per_unit, source, valid_at) VALUES ($1, $2::numeric, $3, $4)
       ON CONFLICT (currency) DO UPDATE SET eur_per_unit = EXCLUDED.eur_per_unit, source = EXCLUDED.source, valid_at = EXCLUDED.valid_at`,
      [r.currency, r.eurPerUnit, `ECB ${parsed.date}`, validAt.toISOString()]);
    imported.push(r.currency);
  }
  const missing = [...allowed].filter(c => !imported.includes(c)).sort();
  console.log(`ECB ${parsed.date}: imported ${imported.length} (${imported.join(" ")})`);
  if (skipped.length) console.log(`not in the allow-list, skipped: ${skipped.join(" ")}`);
  if (missing.length) console.log(`allow-listed but not published by the ECB — enter via POST /api/admin/fx-rates: ${missing.join(" ")}`);
}

main().then(() => pool.end()).catch(async e => { console.error(e instanceof Error ? e.message : String(e)); await pool.end(); process.exit(1); });
