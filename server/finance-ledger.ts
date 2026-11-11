/**
 * BED4BOOK financial journal primitives.
 * All amounts are integer minor currency units; no floating point postings.
 * No persistence or payment execution occurs in this module.
 */
export type JournalSide = "debit" | "credit";
export interface JournalEntry {
  accountId: string;
  side: JournalSide;
  amountMinor: bigint;
}
export interface Journal {
  currency: string;
  reference: string;
  entries: readonly JournalEntry[];
}
const CURRENCY = /^[A-Z]{3}$/;
export function validateJournal(journal: Journal): void {
  if (!CURRENCY.test(journal.currency)) throw new Error("INVALID_CURRENCY");
  if (!journal.reference.trim()) throw new Error("REFERENCE_REQUIRED");
  if (journal.entries.length < 2) throw new Error("JOURNAL_REQUIRES_TWO_ENTRIES");
  let debit = 0n, credit = 0n;
  for (const entry of journal.entries) {
    if (!entry.accountId.trim()) throw new Error("ACCOUNT_REQUIRED");
    if (entry.side !== "debit" && entry.side !== "credit") throw new Error("INVALID_SIDE");
    if (typeof entry.amountMinor !== "bigint" || entry.amountMinor <= 0n) throw new Error("INVALID_AMOUNT");
    if (entry.side === "debit") debit += entry.amountMinor;
    else credit += entry.amountMinor;
  }
  if (debit !== credit) throw new Error("UNBALANCED_JOURNAL");
}
export function accountBalanceMinor(journals: readonly Journal[], accountId: string, currency: string): bigint {
  if (!accountId.trim() || !CURRENCY.test(currency)) throw new Error("INVALID_ACCOUNT_OR_CURRENCY");
  let balance = 0n;
  for (const journal of journals) {
    validateJournal(journal);
    if (journal.currency !== currency) continue;
    for (const entry of journal.entries) {
      if (entry.accountId === accountId) balance += entry.side === "debit" ? entry.amountMinor : -entry.amountMinor;
    }
  }
  return balance;
}
