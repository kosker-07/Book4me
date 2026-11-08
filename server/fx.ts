// Exchange rates. EUR is the internal reference: fx_rates.eur_per_unit = how many EUR one unit is worth.
// Only fresh rates are used (FX_MAX_AGE_HOURS, default 24); a stale or missing rate means the offer is not
// evaluated. Each rate carries the fx_rate_history id that quotes and booking snapshots reference.
import type { PoolClient } from "pg";

export interface FxRate { currency: string; eurPerUnit: string; historyId: number | null; source: string; validAt: string }

export const fxMaxAgeHours = () => {
  const v = Number(process.env.FX_MAX_AGE_HOURS ?? 24);
  return Number.isFinite(v) && v > 0 ? v : 24;
};

/** EUR has no row: its rate is 1 by definition and it references no history row. */
export const EUR_RATE: FxRate = { currency: "EUR", eurPerUnit: "1", historyId: null, source: "reference", validAt: "" };

export async function loadFreshRates(db: { query: PoolClient["query"] }): Promise<Map<string, FxRate>> {
  const rows = (await db.query(
    `SELECT currency, eur_per_unit::text AS eur_per_unit, history_id, source, valid_at
       FROM fx_rates WHERE valid_at > now() - make_interval(hours => $1::int) AND valid_at <= now() + interval '5 minutes'`,
    [Math.ceil(fxMaxAgeHours())])).rows;
  const m = new Map<string, FxRate>([["EUR", EUR_RATE]]);
  for (const r of rows) {
    const code = String(r.currency).trim();
    m.set(code, { currency: code, eurPerUnit: r.eur_per_unit, historyId: r.history_id === null ? null : Number(r.history_id),
                  source: r.source, validAt: new Date(r.valid_at).toISOString() });
  }
  return m;
}

/** Number map used by the comparison (pricing.priceCandidate). */
export const comparisonRates = (rates: Map<string, FxRate>) =>
  new Map([...rates].filter(([c]) => c !== "EUR").map(([c, r]) => [c, Number(r.eurPerUnit)]));

// ---- ECB daily reference rates (https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml) ----------
// The ECB publishes "1 EUR = x units"; BED4BOOK stores the inverse (EUR per unit), rounded to 8 decimals.
export interface ParsedRates { date: string; rates: { currency: string; eurPerUnit: string }[] }

export function parseEcbDailyXml(xml: string): ParsedRates {
  const date = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  if (!date) throw new Error("ECB XML: no <Cube time=...> element");
  const rates: { currency: string; eurPerUnit: string }[] = [];
  const re = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/>/g;
  for (let m; (m = re.exec(xml)); ) {
    const unitsPerEur = Number(m[2]);
    if (!(unitsPerEur > 0)) throw new Error(`ECB XML: invalid rate for ${m[1]}`);
    rates.push({ currency: m[1]!, eurPerUnit: (1 / unitsPerEur).toFixed(8) });
  }
  if (!rates.length) throw new Error("ECB XML: no rates found");
  return { date, rates };
}
