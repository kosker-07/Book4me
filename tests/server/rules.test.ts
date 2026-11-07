// Unit tests for pure pricing, winner selection, validation and quote signing (no database).
import test from "node:test";
import assert from "node:assert/strict";
import { Candidate, chooseWinners, nightlySellCents, priceCandidate } from "../../server/pricing";
import { isCalendarDate, validateGuest, validateStay } from "../../server/validation";
import { signQuote, verifyQuote } from "../../server/quotes";

const occ = { adults: 2, children: 0, childAges: [] as number[] };
const cand = (ratePlanId: string, net: number, extra: Partial<Candidate> = {}): Candidate => ({
  ratePlanId, hotelId: "h", roomId: "r", board: "AI", cancellationPolicy: { a: 1, b: 2 }, paymentTerms: {}, currency: "EUR",
  markup: { type: "percent", value: "10" }, nights: [{ date: "2030-01-01", netPrice: net }, { date: "2030-01-02", netPrice: net }], ...extra
});
const price = (c: Candidate, fx = new Map<string, number>()) => priceCandidate(c, occ, "2030-01-01", "2030-01-03", 1, fx);

test("markup: percent and fixed, rounded half-up to cents", () => {
  assert.equal(nightlySellCents(10000, { type: "percent", value: "10" }), 11000);
  assert.equal(nightlySellCents(9999, { type: "percent", value: "12.5" }), 11249); // 112.48875 -> 112.49
  assert.equal(nightlySellCents(10000, { type: "fixed", value: "5.50" }), 10550);
  assert.throws(() => nightlySellCents(100, { type: "override" as any, value: 1 }));
});

test("winner: lowest normalized total per equivalence key; losers are dropped", () => {
  const w = chooseWinners([price(cand("rp2", 120)), price(cand("rp1", 100)), price(cand("rp3", 90, { board: "BB" }))]);
  assert.deepEqual(w.map(o => o.ratePlanId).sort(), ["rp1", "rp3"]);
});

test("winner: equal totals resolved by lowest rate plan id regardless of input order", () => {
  for (const order of [["b", "a", "c"], ["c", "b", "a"], ["a", "c", "b"]])
    assert.equal(chooseWinners(order.map(id => price(cand(id, 100))))[0]!.ratePlanId, "a");
});

test("winner: policy key order does not split equivalence; different policies do", () => {
  const w = chooseWinners([price(cand("x", 100, { cancellationPolicy: { b: 2, a: 1 } })), price(cand("y", 90))]);
  assert.deepEqual(w.map(o => o.ratePlanId), ["y"]);
  const w2 = chooseWinners([price(cand("x", 100, { cancellationPolicy: { a: 9 } })), price(cand("y", 90))]);
  assert.equal(w2.length, 2);
});

test("winner: different sales conditions are different products (B4B-03); key order does not split", () => {
  const uk = { markets: ["UK"], minStay: 2 };
  // A cheaper offer with other sales conditions must not hide the offer without them, and vice versa.
  const w = chooseWinners([price(cand("cond", 80, { salesConditions: uk })), price(cand("open", 100, { salesConditions: {} }))]);
  assert.deepEqual(w.map(o => o.ratePlanId).sort(), ["cond", "open"]);
  // Same conditions with keys in another order: still one group, lowest price wins.
  const w2 = chooseWinners([price(cand("a", 100, { salesConditions: { minStay: 2, markets: ["UK"] } })), price(cand("b", 90, { salesConditions: uk }))]);
  assert.deepEqual(w2.map(o => o.ratePlanId), ["b"]);
  // Missing and empty sales conditions are equivalent (rate plans created before the field was used).
  const w3 = chooseWinners([price(cand("legacy", 100)), price(cand("empty", 90, { salesConditions: {} }))]);
  assert.deepEqual(w3.map(o => o.ratePlanId), ["empty"]);
});

test("winner: an offer without an exchange rate is excluded, not treated as rate 1", () => {
  assert.deepEqual(chooseWinners([price(cand("usd", 1, { currency: "USD" }))]), []);
  const fx = new Map([["USD", 0.9]]);
  const w = chooseWinners([price(cand("usd", 100, { currency: "USD" }), fx), price(cand("eur", 100), fx)]);
  assert.equal(w[0]!.ratePlanId, "usd"); // 220 USD = 198 EUR < 220 EUR
});

test("validation: real calendar dates only", () => {
  assert.equal(isCalendarDate("2030-02-28"), true);
  for (const bad of ["2030-02-30", "2030-13-01", "2030-1-01", "", null]) assert.equal(isCalendarDate(bad), false, String(bad));
});

test("validation: stay rules", () => {
  const e: Record<string, string> = {};
  assert.equal(validateStay({ checkIn: "2030-01-02", checkOut: "2030-01-01", rooms: 0, adults: 0, children: 1, childAges: [] }, e, "2029-01-01"), null);
  assert.deepEqual(Object.keys(e).sort(), ["adults", "checkOut", "childAges", "rooms"]);
});

test("validation: guest fields", () => {
  const e: Record<string, string> = {};
  assert.equal(validateGuest({ guest: {}, operationNote: "" }, e), null);
  assert.deepEqual(Object.keys(e).sort(), ["guest.email", "guest.firstName", "guest.lastName", "guest.nationality", "guest.phone", "operationNote"]);
});

test("quotes: signed, tamper-evident, expiring", () => {
  const secret = "unit-test-secret-with-at-least-32-chars";
  const t = signQuote({ agencyId: "a", ratePlanId: "rp", checkIn: "x", checkOut: "y", rooms: 1, adults: 2, children: 0, childAges: [], totalCents: 100, currency: "EUR" }, secret, 0);
  assert.equal(verifyQuote(t, secret, 1000).ok, true);
  const [p, body, sig] = t.split(".");
  const forged = `${p}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), totalCents: 1 })).toString("base64url")}.${sig}`;
  assert.deepEqual(verifyQuote(forged, secret, 1000), { ok: false, error: "INVALID_QUOTE" });
  assert.deepEqual(verifyQuote(t, secret, 31 * 60 * 1000), { ok: false, error: "QUOTE_EXPIRED" });
  assert.deepEqual(verifyQuote(t, "another-secret-with-at-least-32-chars!!", 1000), { ok: false, error: "INVALID_QUOTE" });
});

test("no explicit row locks or hold states in server code and migrations", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const files = [
    ...readdirSync("server").filter(f => f.endsWith(".ts")).map(f => `server/${f}`),
    ...readdirSync("server/migrations").filter(f => f.endsWith(".sql") && f !== "001_initial.sql").map(f => `server/migrations/${f}`)
  ];
  for (const f of files) {
    const src = readFileSync(f, "utf8").replace(/\/\/.*$|--.*$/gm, ""); // ignore comments
    assert.ok(!/FOR\s+(NO\s+KEY\s+)?UPDATE|FOR\s+SHARE|pg_advisory|LOCK\s+TABLE/i.test(src), `${f} contains an explicit lock`);
    assert.ok(!/'(HOLD|HELD|LOCKED|OPTION)'/i.test(src), `${f} contains a hold/lock status`);
  }
});
