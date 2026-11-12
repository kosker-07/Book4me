// Decides how the owner hears about an item: instantly, in the digest, as a count only, or never.
// The owner's own rules (first match wins, "never" included) come before the built-in defaults.
export type Channel = "instant" | "digest" | "count_only" | "never";
export interface NotifyItem { kind: "email" | "approval" | "alert"; function?: string | null; risk?: "low" | "medium" | "high"; amountEur?: number; fromDomain?: string | null }
export interface NotifyRule { match_kind: "function" | "from_domain" | "risk" | "amount_over"; match_value: string; channel: Channel; active: boolean }

const matches = (r: NotifyRule, i: NotifyItem) =>
  r.match_kind === "function" ? !!i.function && i.function === r.match_value
  : r.match_kind === "from_domain" ? !!i.fromDomain && i.fromDomain.toLowerCase() === r.match_value.toLowerCase()
  : r.match_kind === "risk" ? i.risk === r.match_value
  : i.amountEur !== undefined && i.amountEur > Number(r.match_value);

export function classifyImportance(item: NotifyItem, rules: NotifyRule[]): Channel {
  for (const r of rules) if (r.active && matches(r, item)) return r.channel;
  if (item.kind === "alert") return "instant";
  if (item.function === "security") return "instant";
  if (item.kind === "approval") return item.risk === "high" ? "instant" : item.risk === "medium" ? "digest" : "count_only";
  if (item.function === "accounting" || item.function === "contracts") return "digest";
  return "count_only";
}
