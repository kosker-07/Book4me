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
  assert.throws(() => platformFeeMinor(10000, "1.2345"));
  assert.throws(() => platformFeeMinor(10000, "101"));
  assert.equal(platformFeeMinor(10000, 5), 500);
  assert.equal(platformFeeMinor(10000, "5.000"), 500);
  assert.equal(platformFeeMinor(10000, "8"), 800);
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
  assert.equal(platformFeeMinor(12345, 0), 0);
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

test("marketplace: multi-night DMC distribution reconciles every component to buyer total", () => {
  const netNights = [10000, 10500, 12000, 9900];
  const nights = netNights.map(net => priceMarketplaceChain(net, "7.5", "12.25"));
  const sum = (key: "netMinor" | "platformMarginMinor" | "buyerCostMinor" | "buyerMarkupMinor" | "saleMinor") =>
    nights.reduce((total, night) => total + night[key], 0);
  assert.equal(sum("netMinor") + sum("platformMarginMinor"), sum("buyerCostMinor"));
  assert.equal(sum("buyerCostMinor") + sum("buyerMarkupMinor"), sum("saleMinor"));
  assert.ok(nights.every(n => n.platformMarginMinor >= 0 && n.buyerMarkupMinor >= 0));
  assert.deepEqual(nights.map(n => n.saleMinor), netNights.map(n => priceMarketplaceChain(n, "7.5", "12.25").saleMinor));
});

test("marketplace: a buyer's zero markup cannot erase platform margin", () => {
  const chain = priceMarketplaceChain(24999, "8", "0");
  assert.ok(chain.platformMarginMinor > 0);
  assert.equal(chain.buyerMarkupMinor, 0);
  assert.equal(chain.saleMinor, chain.buyerCostMinor);
  assert.equal(chain.buyerCostMinor, chain.netMinor + chain.platformMarginMinor);
});

test("marketplace: nightly minor-unit rounding reconciles for a long mixed-price stay", () => {
  // A total-stay percentage calculation can drift from the required nightly snapshots.
  const nets = Array.from({ length: 31 }, (_, i) => 101 + (i * 37) % 997);
  const nights = nets.map(net => priceMarketplaceChain(net, "0.5", "2.75"));
  const total = (field: "netMinor" | "platformMarginMinor" | "buyerCostMinor" | "buyerMarkupMinor" | "saleMinor") =>
    nights.reduce((acc, night) => acc + night[field], 0);
  assert.equal(total("netMinor"), nets.reduce((a, b) => a + b, 0));
  assert.equal(total("buyerCostMinor"), total("netMinor") + total("platformMarginMinor"));
  assert.equal(total("saleMinor"), total("buyerCostMinor") + total("buyerMarkupMinor"));
  for (const night of nights) {
    assert.ok(Number.isSafeInteger(night.saleMinor));
    assert.equal(night.saleMinor, night.netMinor + night.platformMarginMinor + night.buyerMarkupMinor);
  }
});

test("marketplace: buyer markup never changes the operator's platform margin", () => {
  for (const net of [1, 99, 101, 9999, 1000000]) {
    const zero = priceMarketplaceChain(net, "7.25", "0");
    const high = priceMarketplaceChain(net, "7.25", "50");
    assert.equal(high.platformMarginMinor, zero.platformMarginMinor);
    assert.equal(high.buyerCostMinor, zero.buyerCostMinor);
    assert.ok(high.saleMinor >= zero.saleMinor);
  }
});
