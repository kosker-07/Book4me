// Platform-only agent definitions. All agents start disabled in migration 033.
import type { Agent, AgentTool, Risk } from "../runtime";

export const PLATFORM_AGENTS = [
  { id: "owner-assistant", name: "Owner Assistant", functionName: "owner", mailbox: null },
  { id: "reservations", name: "Reservations Agent", functionName: "reservations", mailbox: "reservations@bed4book.com" },
  { id: "accounting", name: "Accounting Agent", functionName: "accounting", mailbox: "accounting@bed4book.com" },
  { id: "contracts", name: "Contracts Agent", functionName: "contracts", mailbox: "contracts@bed4book.com" },
  { id: "support", name: "Support Agent", functionName: "support", mailbox: "support@bed4book.com" },
  { id: "pricing", name: "Pricing & Profit Agent", functionName: "pricing", mailbox: null },
  { id: "operations", name: "Operations Agent", functionName: "operations", mailbox: null },
  { id: "integrations", name: "Integrations Agent", functionName: "integrations", mailbox: null },
] as const;

export type PlatformAgentId = typeof PLATFORM_AGENTS[number]["id"];
export const TOOL_RISKS = {
  getBooking: "low",
  listBookings: "low",
  getAgencySummary: "low",
  getInboxEmail: "low",
  listOpenApprovals: "low",
  getDailyStats: "low",
  draftReply: "medium",
  flagBooking: "medium",
  requestRefund: "high",
  changeBookingStatus: "high",
} as const satisfies Record<string, Risk>;

const commonPolicy = [
  "You work exclusively for BED4BOOK on platform-owned records (tenant_id IS NULL).",
  "Read BED4BOOK bookings with platform-wide operator scope, including sales involving DMCs. Never access DMC-private mail, mail settings, sub-agency user accounts or credentials.",
  "You cannot change money, prices, margins, cancellations, refunds, contracts, users or permissions without human approval.",
  "Never send a reply autonomously: prepare a draft for human approval.",
  "Contract Excel/PDF parsing belongs to the platform's own code; do not interfere.",
  "Follow owner notification rules. Security mailbox messages go directly to the owner.",
  "If AI is not configured, do not attempt work.",
  "If uncertain, escalate to a human. Never fabricate data or actions.",
].join("\n");

export function agentSystemPrompt(id: PlatformAgentId): string {
  const definition = PLATFORM_AGENTS.find(a => a.id === id);
  if (!definition) throw new Error("UNKNOWN_AGENT");
  return `You are ${definition.name}.\n${commonPolicy}`;
}

export function makePlatformAgent(
  id: PlatformAgentId,
  config: { enabled: boolean; model: string; dailyTokenBudget: number },
  tools: AgentTool[],
): Agent {
  if (!PLATFORM_AGENTS.some(a => a.id === id)) throw new Error("UNKNOWN_AGENT");
  if (id === "owner-assistant" && tools.some(t => t.risk !== "low")) throw new Error("OWNER_READ_ONLY");
  for (const tool of tools) {
    if (!(tool.name in TOOL_RISKS) || TOOL_RISKS[tool.name as keyof typeof TOOL_RISKS] !== tool.risk) {
      throw new Error("INVALID_TOOL_RISK");
    }
  }
  return { id, system: agentSystemPrompt(id), enabled: config.enabled, model: config.model, dailyTokenBudget: config.dailyTokenBudget, tools };
}
