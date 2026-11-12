import type { Db } from "../store";
import type { AgentTool } from "../runtime";
import type { PlatformAgentId } from "./registry";
import { platformTools } from "../tools/platform";

/** Explicit allowlist: never expose mutation tools to the owner assistant. */
const READ = ["getBooking","listBookings","getAgencySummary","getInboxEmail","listOpenApprovals","getDailyStats"] as const;
const TOOL_MAP: Record<PlatformAgentId, readonly string[]> = {
  "owner-assistant": READ,
  reservations: [...READ,"changeBookingStatus","flagBooking","draftReply"],
  accounting: [...READ,"requestRefund","draftReply"],
  contracts: [...READ,"draftReply"],
  support: [...READ,"flagBooking","draftReply"],
  pricing: ["getBooking","listBookings","getAgencySummary","getDailyStats"],
  operations: [...READ,"flagBooking","changeBookingStatus"],
  integrations: ["getDailyStats","listOpenApprovals"],
};
export function toolsForAgent(id: PlatformAgentId, db: Db): AgentTool[] {
  const names = TOOL_MAP[id];
  if (!names) throw new Error("UNKNOWN_AGENT");
  return platformTools(db).filter(tool => names.includes(tool.name));
}
