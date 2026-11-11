import assert from "node:assert/strict";
import test from "node:test";
import { accountBalanceMinor, validateJournal, Journal } from "../../server/finance-ledger";

const journal: Journal = {
  currency: "EUR", reference: "booking-123",
  entries: [
    { accountId: "dmc-receivable", side: "debit", amountMinor: 12500n },
    { accountId: "booking-revenue", side: "credit", amountMinor: 12500n }
  ]
};
test("balanced journal and account balances in minor units", () => {
  assert.doesNotThrow(() => validateJournal(journal));
  assert.equal(accountBalanceMinor([journal], "dmc-receivable", "EUR"), 12500n);
  assert.equal(accountBalanceMinor([journal], "booking-revenue", "EUR"), -12500n);
  assert.equal(accountBalanceMinor([journal], "dmc-receivable", "USD"), 0n);
});
test("rejects unbalanced and invalid entries", () => {
  assert.throws(() => validateJournal({ ...journal, entries: [
    journal.entries[0]!, { ...journal.entries[1]!, amountMinor: 12499n }
  ] }), /UNBALANCED_JOURNAL/);
  assert.throws(() => validateJournal({ ...journal, currency: "EURO" }), /INVALID_CURRENCY/);
  assert.throws(() => validateJournal({ ...journal, entries: [
    { ...journal.entries[0]!, amountMinor: 0n }, journal.entries[1]!
  ] }), /INVALID_AMOUNT/);
});
test("multiple balanced journals net to zero for settled receivables", () => {
  const settlement: Journal = { currency: "EUR", reference: "payment-123", entries: [
    { accountId: "bank", side: "debit", amountMinor: 12500n },
    { accountId: "dmc-receivable", side: "credit", amountMinor: 12500n }
  ] };
  assert.equal(accountBalanceMinor([journal, settlement], "dmc-receivable", "EUR"), 0n);
});
