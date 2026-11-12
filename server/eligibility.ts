// Contract eligibility by guest nationality (pure, no I/O).
//
// Precedence decides ELIGIBILITY ONLY, never price. For one contract and one nationality:
//   1. explicit exclusion (exact country or a market group containing it)  → not eligible (always wins)
//   2. exact country inclusion                                              → eligible
//   3. market-group inclusion                                               → eligible
//   4. no inclusion rules at all ("general market" contract)                → eligible
//   5. otherwise                                                            → not eligible
// A contract is eligible for a booking only if EVERY guest nationality is eligible (mixed-nationality rule).
// Among eligible contracts the lowest price wins (pricing.ts); a more specific contract never overrides a cheaper one.

export type RuleType = "include" | "exclude";
export interface NationalityRule {
  id: string;
  contractId: string;
  type: RuleType;
  countryCode: string | null;
  marketGroupId: string | null;
  marketGroupCode: string | null;
  /** Member country codes of the market group (empty for exact-country rules). */
  members: string[];
}

export type MatchReason = "EXCLUDED" | "EXACT" | "GROUP" | "GENERAL" | "NOT_INCLUDED";
export interface NationalityMatch {
  nationality: string;
  eligible: boolean;
  reason: MatchReason;
  ruleId: string | null;
  /** Country code or market group code that matched. */
  target: string | null;
}

const appliesTo = (r: NationalityRule, nat: string) => r.countryCode === nat || r.members.includes(nat);
const target = (r: NationalityRule) => r.countryCode ?? r.marketGroupCode ?? r.marketGroupId;
/** Deterministic choice when several rules match: lowest rule id. */
const first = (rs: NationalityRule[]) => [...rs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];

export function evaluateNationality(rules: readonly NationalityRule[], nationality: string): NationalityMatch {
  const excluded = rules.filter(r => r.type === "exclude" && appliesTo(r, nationality));
  if (excluded.length) { const r = first(excluded)!; return { nationality, eligible: false, reason: "EXCLUDED", ruleId: r.id, target: target(r) }; }
  const includes = rules.filter(r => r.type === "include");
  const exact = includes.filter(r => r.countryCode === nationality);
  if (exact.length) { const r = first(exact)!; return { nationality, eligible: true, reason: "EXACT", ruleId: r.id, target: target(r) }; }
  const group = includes.filter(r => r.marketGroupId !== null && r.members.includes(nationality));
  if (group.length) { const r = first(group)!; return { nationality, eligible: true, reason: "GROUP", ruleId: r.id, target: target(r) }; }
  if (!includes.length) return { nationality, eligible: true, reason: "GENERAL", ruleId: null, target: null };
  return { nationality, eligible: false, reason: "NOT_INCLUDED", ruleId: null, target: null };
}

export interface ContractEligibility { eligible: boolean; matches: NationalityMatch[] }

/** Every nationality must be eligible. Duplicate nationalities are evaluated once per guest (same result). */
export function evaluateContract(rules: readonly NationalityRule[], nationalities: readonly string[]): ContractEligibility {
  const matches = nationalities.map(n => evaluateNationality(rules, n));
  return { eligible: matches.length > 0 && matches.every(m => m.eligible), matches };
}

/** Groups rules by contract id. */
export function rulesByContract(rules: readonly NationalityRule[]): Map<string, NationalityRule[]> {
  const m = new Map<string, NationalityRule[]>();
  for (const r of rules) { const l = m.get(r.contractId) ?? []; l.push(r); m.set(r.contractId, l); }
  return m;
}
