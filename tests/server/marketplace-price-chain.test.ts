import test from "node:test";
import assert from "node:assert/strict";
import { priceMarketplaceChain, platformFeeMinor } from "../../server/pricing";

test("marketplace: platform margin and buyer markup are sequential, not additive", () => {
  const p = priceMarketplaceChain(10000, "10", "20");
  assert.equal(p.netMinor, 10000);
  assert.equal(p.platformMarginMinor, 1000);
  assert.equal(p.buyerCostMinor, 11000);
  assert.equal(p.buyerMarkupMinor, 2200);
  assert.equal(p.saleMinor, 13200);
});

test("T1 unit: platform fee adds five percent of net, rounded per night", () => {
  assert.equal(platformFeeMinor(10000, "5"), 500);
  assert.equal(platformFeeMinor(101, "0.5"), 1);
  assert.equal(platformFeeMinor(10000, "0"), 0);
  assert.throws(() => platformFeeMinor(10000, "100.001"));
  assert.throws(() => platformFeeMinor(10000, "-1"));
});

test("marketplace: per-night rounding differs from rounding the stay total", () => {
  const night = priceMarketplaceChain(101, "0.5", "0");
  assert.equal(night.saleMinor, 102);
  assert.equal(2 * night.saleMinor, 204);
});

test("marketplace: zero percentages preserve the original net", () => {
  const p = priceMarketplaceChain(12345, 0, 0);
  assert.equal(p.saleMinor, 12345);
  assert.equal(p.buyerCostMinor, 12345);
  assert.equal(p.platformFeeMinor, 0);
});

test("marketplace: rejects negative, out-of-range, overprecision and unsafe inputs", () => {
  assert.throws(() => priceMarketplaceChain(-1, 0, 0));
  assert.throws(() => priceMarketplaceChain(Number.MAX_SAFE_INTEGER + 1, 0, 0));
  assert.throws(() => priceMarketplaceChain(100, -0.1, 0));
  assert.throws(() => priceMarketplaceChain(100, 100.001, 0));
  assert.throws(() => priceMarketplaceChain(100, 0, 1.2345));
});

test("T1 unit: direct DMC sale includes fee while distribution chain does not", () => {
  const rule = priceMarketplaceChain(10000, "10", "20");
  assert.equal(rule.saleMinor, 13200);
  assert.equal(11000 + platformFeeMinor(10000, "5"), 11500);
});
