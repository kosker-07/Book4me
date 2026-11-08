import test from "node:test";
import assert from "node:assert/strict";
import { validateRatePlanTerms } from "../../server/validation";

const cancellationPolicy = {
  freeUntilDays: 7, penaltyType: "nights", penaltyValue: 1,
  noShowPenaltyType: "percent", noShowPenaltyValue: 100
};
const paymentTerms = { dueDaysBeforeCheckIn: 14 };

test("rate plan terms: valid cancellation and payment conditions", () => {
  const errors: Record<string, string> = {};
  assert.equal(validateRatePlanTerms(cancellationPolicy, paymentTerms, errors), true);
  assert.deepEqual(errors, {});
});

test("rate plan terms: missing or empty conditions rejected with field errors", () => {
  for (const [c, p] of [[undefined, undefined], [{}, {}], [null, null]]) {
    const errors: Record<string, string> = {};
    assert.equal(validateRatePlanTerms(c, p, errors), false);
    assert.ok(Object.keys(errors).length > 0);
  }
});

test("rate plan terms: enforce ranges and integer penalty values", () => {
  for (const [key, value] of [["freeUntilDays", 366], ["penaltyValue", 31], ["noShowPenaltyValue", 101], ["penaltyType", "other"]]) {
    const errors: Record<string, string> = {};
    assert.equal(validateRatePlanTerms({ ...cancellationPolicy, [key]: value }, paymentTerms, errors), false);
    assert.ok(errors["cancellationPolicy." + key]);
  }
  const errors: Record<string, string> = {};
  assert.equal(validateRatePlanTerms(cancellationPolicy, { dueDaysBeforeCheckIn: -1 }, errors), false);
  assert.equal(errors["paymentTerms.dueDaysBeforeCheckIn"], "INTEGER_0_TO_365");
});
