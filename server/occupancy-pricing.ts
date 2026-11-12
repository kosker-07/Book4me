// Occupancy prices from contracts (e.g. Excel price lists). Every value is the TOTAL room price per night for that
// occupancy — checked against real price lists: "2 ADL + 1 CHD" equals the double price when the child stays free.
// A requested room occupancy must match one key exactly (adults, number of children, each child's age in range);
// otherwise the rate plan is not sold for that occupancy. We never fall back to the double price.
export interface ParsedOccupancy { adults: number; children: number; ranges: [number, number][] }
export type OccupancyPrices = Record<string, number>;

const ADULT_KEYS: Record<string, number> = { sgl: 1, pax1: 1, dbl: 2, pax2: 2, dbl_exb: 3, pax3: 3, pax4: 4, pax5: 5 };

/** "child_2_adl_1_chd_2_11_99" → 2 adults + 1 child aged 2–11.99; several child ranges may follow the count. */
export function parseOccupancyKey(key: string): ParsedOccupancy | null {
  if (key in ADULT_KEYS) return { adults: ADULT_KEYS[key]!, children: 0, ranges: [] };
  const m = /^child_(\d)_?adl?_(\d)_chd((?:_\d{1,2}_\d{1,2}_\d{2})+)$/.exec(key);
  if (!m) return null;
  const adults = Number(m[1]), children = Number(m[2]);
  const ranges: [number, number][] = [...m[3]!.matchAll(/_(\d{1,2})_(\d{1,2})_(\d{2})/g)].map(r => [Number(r[1]), Number(r[2]) + Number(r[3]) / 100]);
  if (adults < 1 || children < 1 || (ranges.length !== 1 && ranges.length !== children) || ranges.some(([a, b]) => a > b)) return null;
  return { adults, children, ranges };
}

/** Each child must take its own range (one shared range when only one is given); ages are whole years. */
function agesFit(ages: number[], ranges: [number, number][]): boolean {
  if (ranges.length === 1) return ages.every(a => a >= ranges[0]![0] && a <= ranges[0]![1]);
  const left = [...ranges].sort((x, y) => x[1] - y[1] || x[0] - y[0]);
  for (const age of [...ages].sort((a, b) => a - b)) {
    const i = left.findIndex(([lo, hi]) => age >= lo && age <= hi);
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}

/** Room price for one room's occupancy, or null when the contract does not price it. */
export function priceForOccupancy(table: OccupancyPrices | null | undefined, adults: number, childAges: number[]): number | null {
  if (!table) return null;
  const valid = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  if (!childAges.length) {
    for (const [k, v] of Object.entries(table)) { const p = parseOccupancyKey(k); if (p && p.children === 0 && p.adults === adults && valid(v) !== null) return v; }
    if (adults === 2 && valid(table.pp_dbl) !== null) return Math.round(table.pp_dbl! * 2 * 100) / 100;
    return null;
  }
  for (const [k, v] of Object.entries(table)) {
    const p = parseOccupancyKey(k);
    if (p && p.adults === adults && p.children === childAges.length && valid(v) !== null && agesFit(childAges, p.ranges)) return v;
  }
  return null;
}
