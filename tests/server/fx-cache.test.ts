import test from "node:test";
import assert from "node:assert/strict";
import { invalidateFreshRatesCache, loadCachedFreshRates } from "../../server/fx";

test("J13 FX cache invalidates after rate update", async () => {
  invalidateFreshRatesCache();
  let queries = 0;
  let rate = "0.91";
  const db = { query: async () => {
    queries++;
    return { rows: [{ currency: "USD", eur_per_unit: rate, history_id: queries, source: "test", valid_at: new Date().toISOString() }] };
  } };
  const first = await loadCachedFreshRates(db as any);
  assert.equal(first.get("USD")?.eurPerUnit, "0.91");
  rate = "0.95";
  const second = await loadCachedFreshRates(db as any);
  assert.equal(queries, 1, "second search within 60s must not query FX table");
  assert.equal(second.get("USD")?.eurPerUnit, "0.91");
  // Called by POST /api/admin/fx-rates after its transaction commits.
  invalidateFreshRatesCache();
  const updated = await loadCachedFreshRates(db as any);
  assert.equal(queries, 2);
  assert.equal(updated.get("USD")?.eurPerUnit, "0.95");
  invalidateFreshRatesCache();
});
