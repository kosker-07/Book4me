import test from "node:test";
import assert from "node:assert/strict";
import { priceMarketplaceChain } from "../../server/pricing";

test("marketplace: platform margin and buyer markup are sequential, not additive", () => {
  const p = priceMarketplaceChain(10000, "10", "20", "5");
  assert.equal(p.netMinor, 10000);
  assert.equal(p.platformMarginMinor, 1000);
  assert.equal(p.buyerCostMinor, 11000);
  assert.equal(p.buyerMarkupMinor, 2200);
  assert.equal(p.saleMinor, 13200);
});

test("marketplace: platform fee is accounting-only and never increases sale price", () => {
  const withoutFee = priceMarketplaceChain(10000, "10", "20", "0");
  const withFee = priceMarketplaceChain(10000, "10", "20", "7.5");
  assert.equal(withFee.saleMinor, withoutFee.saleMinor);
  assert.equal(withFee.buyerCostMinor, withoutFee.buyerCostMinor);
  assert.equal(withFee.platformFeeMinor, 750);
});

test("marketplace: per-night rounding differs from rounding the stay total", () => {
  const night = priceMarketplaceChain(101, "0.5", "0", "0");
  assert.equal(night.saleMinor, 102);
  assert.equal(2 * night.saleMinor, 204);
});

test("marketplace: zero percentages preserve the original net", () => {
  const p = priceMarketplaceChain(12345, 0, 0, 0);
  assert.equal(p.saleMinor, 12345);
  assert.equal(p.buyerCostMinor, 12345);
  assert.equal(p.platformFeeMinor, 0);
});

test("marketplace: rejects negative, out-of-range, overprecision and unsafe inputs", () => {
  assert.throws(() => priceMarketplaceChain(-1, 0, 0, 0));
  assert.throws(() => priceMarketplaceChain(Number.MAX_SAFE_INTEGER + 1, 0, 0, 0));
  assert.throws(() => priceMarketplaceChain(100, -0.1, 0, 0));
  assert.throws(() => priceMarketplaceChain(100, 100.001, 0, 0));
  assert.throws(() => priceMarketplaceChain(100, 0, 1.2345, 0));
});
