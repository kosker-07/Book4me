// Platform mail addresses. They are used for platform business only and never for any DMC communication.
export const PLATFORM_DOMAIN = "bed4book.com";
export const PLATFORM_FUNCTIONS = ["noreply", "support", "reservations", "accounting", "contracts", "security"] as const;
export type PlatformFunction = typeof PLATFORM_FUNCTIONS[number];

const DISPLAY: Record<PlatformFunction, string> = {
  noreply: "BED4BOOK",
  support: "BED4BOOK Support",
  reservations: "BED4BOOK Reservations",
  accounting: "BED4BOOK Accounting",
  contracts: "BED4BOOK Contracts",
  security: "BED4BOOK Security"
};

export interface Sender { address: string; name: string; replyTo: string | null }

export function platformSender(fn: PlatformFunction): Sender {
  const address = `${fn}@${PLATFORM_DOMAIN}`;
  return { address: fn === "noreply" ? (process.env.MAIL_FROM_ADDRESS || address) : address, name: DISPLAY[fn], replyTo: fn === "noreply" ? `support@${PLATFORM_DOMAIN}` : address };
}

/** Maps a received-to address to a platform function; anything else (including look-alike domains) is not ours. */
export function functionForAddress(to: string): PlatformFunction | null {
  const m = /^([a-z0-9._-]+)@([a-z0-9.-]+)$/i.exec(to.trim());
  if (!m) return null;
  const local = (m[1] ?? "").toLowerCase(), domain = (m[2] ?? "").toLowerCase();
  if (domain !== PLATFORM_DOMAIN && domain !== `in.${PLATFORM_DOMAIN}`) return null;
  return (PLATFORM_FUNCTIONS as readonly string[]).includes(local) ? local as PlatformFunction : null;
}
