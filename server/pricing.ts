// Pure pricing and winner-selection rules (no I/O). Money is handled as integers in the currency's minor
// units (EUR/USD: cents, JPY: yen, KWD: fils = 1/1000). Decimal strings are parsed exactly, never through floats.

export type MarkupType = "percent" | "fixed";
export interface Markup { type: MarkupType; value: string | number }

/** Exact decimal → integer in 10^-digits units, rounded half-up. Accepts "100", "100.5", 100.5 (non-negative). */
export function parseMinor(amount: string | number, digits: number): number {
  const text = typeof amount === "number" ? amount.toFixed(Math.max(digits + 3, 6)) : String(amount).trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error(`Invalid amount: ${String(amount)}`);
  const frac = (m[2] || "").padEnd(digits + 1, "0");
  const base = Number(m[1]) * 10 ** digits + Number(frac.slice(0, digits) || "0");
  return Number(frac[digits]) >= 5 ? base + 1 : base;
}
export const formatMinor = (minor: number, digits: number): string =>
  digits === 0 ? String(minor) : `${Math.trunc(minor / 10 ** digits)}.${String(minor % 10 ** digits).padStart(digits, "0")}`;

/** Canonical text for a stored decimal: at least `minDigits` decimals (so "10" is stored as "10.00", matching
 *  the pre-005 numeric(14,2) form), at most `maxDigits`. */
export function normalizeDecimal(value: string | number, minDigits = 2, maxDigits = 3): string {
  const minor = parseMinor(value, maxDigits);
  let text = formatMinor(minor, maxDigits);
  while (maxDigits > minDigits && text.endsWith("0")) { text = text.slice(0, -1); maxDigits--; }
  return text;
}

/** Backward-compatible 2-decimal helpers. */
export const toCents = (amount: string | number): number => parseMinor(amount, 2);
export const fromCents = (cents: number): string => formatMinor(cents, 2);

/** Sell price per room per night in minor units. percent: net × (1 + value/100); fixed: net + value
 *  (value in the contract currency). Half-up rounding to the currency's minor unit. */
export function nightlySellMinor(netMinor: number, markup: Markup, digits = 2): number {
  if (markup.type === "percent") {
    const milliPercent = parseMinor(markup.value, 3); // 12.5 % → 12500
    return Math.round((netMinor * (100000 + milliPercent)) / 100000);
  }
  if (markup.type === "fixed") return netMinor + parseMinor(markup.value, digits);
  throw new Error(`Unknown markup type: ${String(markup.type)}`);
}
/** Kept for existing callers: 2-decimal currencies. */
export const nightlySellCents = (netCents: number, markup: Markup): number => nightlySellMinor(netCents, markup, 2);

export interface Occupancy { adults: number; children: number; childAges: number[] }

export interface CandidateNight { date: string; netPrice: string | number }
export interface Candidate {
  ratePlanId: string;
  hotelId: string;
  roomId: string;
  board: string;
  cancellationPolicy: unknown;
  paymentTerms: unknown;
  /** rate_plans.sales_conditions: supplier sales conditions; offers with different conditions are different products. */
  salesConditions?: unknown;
  currency: string;
  /** ISO 4217 minor units of `currency` (default 2). */
  minorUnits?: number;
  markup: Markup;
  nights: CandidateNight[];
}

export interface PricedOffer extends Candidate {
  equivalenceKey: string;
  /** Sell price per room per night, in the currency's minor units. */
  nightSellMinor: number[];
  /** Total for all rooms and nights, in the currency's minor units. */
  totalMinor: number;
  /** Comparison value in EUR cents; null when no (fresh) exchange rate exists — the offer is not evaluated. */
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

/** Offers compete only when every component of this key is equal. The guest nationality set is part of the key:
 *  offers priced for different nationality sets are never compared. The contract is deliberately NOT part of
 *  the key — eligible contracts compete and the lowest price wins. */
export function equivalenceKey(c: Candidate, occupancy: Occupancy, checkIn: string, checkOut: string, rooms: number,
                               nationalities: readonly string[] = []): string {
  return canonicalJson([
    c.hotelId, c.roomId, c.board.trim().toLowerCase(),
    c.cancellationPolicy ?? {}, c.paymentTerms ?? {}, c.salesConditions ?? {},
    occupancy.adults, occupancy.children, [...occupancy.childAges].sort((a, b) => a - b),
    checkIn, checkOut, rooms, [...nationalities].sort()
  ]);
}

export function priceCandidate(
  c: Candidate, occupancy: Occupancy, checkIn: string, checkOut: string, rooms: number,
  eurPerUnit: Map<string, number>, nationalities: readonly string[] = []
): PricedOffer {
  const digits = c.minorUnits ?? 2;
  const nightSellMinor = c.nights.map(n => nightlySellMinor(parseMinor(n.netPrice, digits), c.markup, digits));
  const totalMinor = nightSellMinor.reduce((s, v) => s + v, 0) * rooms;
  const rate = c.currency === "EUR" ? 1 : eurPerUnit.get(c.currency);
  const eurCents = rate === undefined || !(rate > 0) ? null : Math.round((totalMinor * rate * 100) / 10 ** digits);
  return { ...c, equivalenceKey: equivalenceKey(c, occupancy, checkIn, checkOut, rooms, nationalities), nightSellMinor, totalMinor, eurCents };
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

/** Converts an amount between currencies through EUR, exactly (BigInt):
 *  amount × (EUR per source unit) / (EUR per target unit), rounded half-up to the target's minor units.
 *  Rates are decimal strings or numbers with up to 8 decimals (fx_rates.eur_per_unit is numeric(18,8)). */
export function convertMinor(amountMinor: number, fromDigits: number, fromEurPerUnit: string | number,
                             toDigits: number, toEurPerUnit: string | number): number {
  const from = BigInt(parseMinor(fromEurPerUnit, 8)), to = BigInt(parseMinor(toEurPerUnit, 8));
  if (from <= 0n || to <= 0n) throw new Error("convertMinor: rates must be positive");
  const num = BigInt(amountMinor) * from * 10n ** BigInt(toDigits);
  const den = to * 10n ** BigInt(fromDigits);
  return Number((2n * num + den) / (2n * den));
}


/** Stage-2 marketplace pricing. All monetary operations use existing minor-unit
 * half-up helpers. Both quote and booking paths must call this same function.
 * Percentages are applied sequentially, never added together.
 */
export interface MarketplacePriceChain {
  netMinor: number;
  platformMarginPercent: string;
  platformMarginMinor: number;
  buyerCostMinor: number;
  buyerMarkupPercent: string;
  buyerMarkupMinor: number;
  saleMinor: number;
  platformFeePercent: string;
  platformFeeMinor: number;
}
export function priceMarketplaceChain(
  netMinor: number, platformMarginPercent: string | number,
  buyerMarkupPercent: string | number, platformFeePercent: string | number,
  digits = 2
): MarketplacePriceChain {
  if (!Number.isSafeInteger(netMinor) || netMinor < 0) throw new Error("Invalid net amount");
  const validated = [platformMarginPercent, buyerMarkupPercent, platformFeePercent].map(v => {
    const milli = parseMinor(v, 3);
    if (milli < 0 || milli > 100000) throw new Error("Percentage out of range");
    return { milli, text: normalizeDecimal(v, 0, 3) };
  });
  const [platform, buyer, fee] = validated;
  const platformMarginMinor = nightlySellMinor(netMinor, { type: "percent", value: platform.text }, digits) - netMinor;
  const buyerCostMinor = netMinor + platformMarginMinor;
  const buyerMarkupMinor = nightlySellMinor(buyerCostMinor, { type: "percent", value: buyer.text }, digits) - buyerCostMinor;
  const platformFeeMinor = nightlySellMinor(netMinor, { type: "percent", value: fee.text }, digits) - netMinor;
  return {
    netMinor, platformMarginPercent: platform.text, platformMarginMinor, buyerCostMinor,
    buyerMarkupPercent: buyer.text, buyerMarkupMinor, saleMinor: buyerCostMinor + buyerMarkupMinor,
    platformFeePercent: fee.text, platformFeeMinor
  };
}
