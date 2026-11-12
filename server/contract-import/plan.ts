// Turns a parsed Excel grid hotel into per-room nightly inventory rows. Pure: no database.
// inventory_daily holds one price per room per night, so the room price for two adults is used
// (dbl, else pp_dbl x 2). Other occupancy prices are kept on the rate plan for later use.
import type { GridHotel, GridPeriod } from "./grid-reader";

export const MAX_NIGHTS_PER_RANGE = 731;
export const MAX_ROWS_PER_IMPORT = 300_000;

export interface PlanIssue { room: string; from: string; to: string; code: string }
export interface RoomPlan { name: string; dates: string[]; prices: string[]; allotments: number[]; occupancyPrices: Record<string, number>[] }
export interface HotelPlan { name: string; region: string; concept: string; currency: string; rooms: RoomPlan[]; errors: PlanIssue[]; warnings: PlanIssue[]; validFrom: string | null; validTo: string | null }

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Strict calendar date: 2027-02-30 is rejected, not rolled into March. */
const parseDay = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  const t = Date.parse(s + "T00:00:00Z");
  return Number.isNaN(t) || isoDay(t) !== s ? NaN : t;
};

export function roomPrice(p: GridPeriod): number | null {
  const v = p.prices.dbl ?? (p.prices.pp_dbl !== undefined ? p.prices.pp_dbl * 2 : undefined);
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}

/** Nights of a range, both ends inclusive (contract periods name the last night). */
export function nights(from: string, to: string): string[] | null {
  const a = parseDay(from), b = parseDay(to);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a || (b - a) / DAY + 1 > MAX_NIGHTS_PER_RANGE) return null;
  const out: string[] = [];
  for (let t = a; t <= b; t += DAY) out.push(isoDay(t));
  return out;
}

export function planHotel(h: GridHotel): HotelPlan {
  const plan: HotelPlan = { name: h.name.trim(), region: h.region.trim(), concept: h.concept.trim(), currency: h.currency.trim().toUpperCase(), rooms: [], errors: [], warnings: [], validFrom: null, validTo: null };
  for (const room of h.rooms) {
    const byDate = new Map<string, { price: number; allotment: number }>();
    const occupancyPrices: Record<string, number>[] = [];
    for (const p of room.periods) {
      const price = roomPrice(p);
      if (price === null) { plan.errors.push({ room: room.name, from: p.from, to: p.to, code: "NO_ROOM_PRICE" }); continue; }
      const allotment = Number.isInteger(p.allotment) && p.allotment >= 0 ? p.allotment : 0;
      occupancyPrices.push(p.prices);
      for (const r of [{ from: p.from, to: p.to }, ...p.extra_ranges]) {
        const days = nights(r.from, r.to);
        if (!days) { plan.errors.push({ room: room.name, from: r.from, to: r.to, code: "INVALID_DATE_RANGE" }); continue; }
        let overlap = false;
        for (const d of days) { if (byDate.has(d)) overlap = true; byDate.set(d, { price, allotment }); }
        if (overlap) plan.warnings.push({ room: room.name, from: r.from, to: r.to, code: "OVERLAPPING_PERIOD_LAST_WINS" });
      }
    }
    if (!byDate.size) continue;
    const dates = [...byDate.keys()].sort();
    plan.rooms.push({ name: room.name.trim(), dates, prices: dates.map(d => byDate.get(d)!.price.toFixed(2)), allotments: dates.map(d => byDate.get(d)!.allotment), occupancyPrices });
    const first = dates[0]!, last = dates[dates.length - 1]!;
    if (!plan.validFrom || first < plan.validFrom) plan.validFrom = first;
    if (!plan.validTo || last > plan.validTo) plan.validTo = last;
  }
  if (!/^[A-Z]{3}$/.test(plan.currency)) plan.errors.push({ room: "", from: "", to: "", code: "INVALID_CURRENCY" });
  if (!plan.name) plan.errors.push({ room: "", from: "", to: "", code: "NO_HOTEL_NAME" });
  return plan;
}

export const rowCount = (plans: HotelPlan[]) => plans.reduce((n, h) => n + h.rooms.reduce((m, r) => m + r.dates.length, 0), 0);
