// Pure pricing and winner-selection rules (no I/O). Money is handled in integer minor units (cents).

export type MarkupType = "percent" | "fixed";
export interface Markup { type: MarkupType; value: string | number }

export const toCents = (amount: string | number): number => Math.round(Number(amount) * 100);
export const fromCents = (cents: number): string => (cents / 100).toFixed(2);

/** Sell price per room per night. percent: net × (1 + value/100); fixed: net + value. Half-up rounding to cents. */
export function nightlySellCents(netCents: number, markup: Markup): number {
  const valueCents = toCents(markup.value); // percent value in hundredths of a percent, or fixed amount in cents
  if (markup.type === "percent") return Math.round((netCents * (10000 + valueCents)) / 10000);
  if (markup.type === "fixed") return netCents + valueCents;
  throw new Error(`Unknown markup type: ${String(markup.type)}`);
}

export interface Occupancy { adults: number; children: number; childAges: number[] }

export interface CandidateNight { date: string; netPrice: string | number }
export interface Candidate {
  ratePlanId: string;
  hotelId: string;
  roomId: string;
  board: string;
  cancellationPolicy: unknown;
  paymentTerms: unknown;
  currency: string;
  markup: Markup;
  nights: CandidateNight[];
}

export interface PricedOffer extends Candidate {
  equivalenceKey: string;
  nightSellCents: number[];
  totalCents: number;
  /** Comparison value in EUR cents; null when no exchange rate exists (offer is not evaluated). */
  eurCents: number | null;
}

/** Deterministic JSON (object keys sorted) so equal policies produce equal keys. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Offers compete only when every component of this key is equal. */
export function equivalenceKey(c: Candidate, occupancy: Occupancy, checkIn: string, checkOut: string, rooms: number): string {
  return canonicalJson([
    c.hotelId, c.roomId, c.board.trim().toLowerCase(),
    c.cancellationPolicy ?? {}, c.paymentTerms ?? {},
    occupancy.adults, occupancy.children, [...occupancy.childAges].sort((a, b) => a - b),
    checkIn, checkOut, rooms
  ]);
}

export function priceCandidate(
  c: Candidate, occupancy: Occupancy, checkIn: string, checkOut: string, rooms: number,
  eurPerUnit: Map<string, number>
): PricedOffer {
  const nightSellCents = c.nights.map(n => nightlySellCents(toCents(n.netPrice), c.markup));
  const totalCents = nightSellCents.reduce((s, v) => s + v, 0) * rooms;
  const rate = c.currency === "EUR" ? 1 : eurPerUnit.get(c.currency);
  const eurCents = rate === undefined || !(rate > 0) ? null : Math.round(totalCents * rate);
  return { ...c, equivalenceKey: equivalenceKey(c, occupancy, checkIn, checkOut, rooms), nightSellCents, totalCents, eurCents };
}

/**
 * One winner per equivalence key: the lowest EUR-normalized total.
 * Ties are broken deterministically by rate plan id. Offers without an exchange rate are excluded.
 * Losing offers are discarded and never returned.
 */
export function chooseWinners(offers: PricedOffer[]): PricedOffer[] {
  const best = new Map<string, PricedOffer>();
  for (const o of offers) {
    if (o.eurCents === null) continue;
    const cur = best.get(o.equivalenceKey);
    if (!cur || o.eurCents < cur.eurCents! || (o.eurCents === cur.eurCents && o.ratePlanId < cur.ratePlanId))
      best.set(o.equivalenceKey, o);
  }
  return [...best.values()].sort((a, b) => a.eurCents! - b.eurCents! || (a.ratePlanId < b.ratePlanId ? -1 : 1));
}
