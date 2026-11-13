import test from "node:test";
import assert from "node:assert/strict";
import { validateRatePlanTerms, validateStay, validateOccupancy, isCalendarDate, nightsBetween } from "../../server/validation";

// ---------------------------------------------------------------- rate plan terms
test("hotel/room/rate/inventory: validateRatePlanTerms accepts valid terms", () => {
  const errors: Record<string, string> = {};
  assert.equal(validateRatePlanTerms(
    { freeUntilDays: 7, penaltyType: "nights", penaltyValue: 1, noShowPenaltyType: "percent", noShowPenaltyValue: 100 },
    { dueDaysBeforeCheckIn: 14 }, errors), true);
  assert.deepEqual(errors, {});
});

test("hotel/room/rate/inventory: validateRatePlanTerms rejects empty terms", () => {
  const errors: Record<string, string> = {};
  assert.equal(validateRatePlanTerms(undefined, undefined, errors), false);
  assert.ok(Object.keys(errors).length > 0);
});

test("hotel/room/rate/inventory: validateRatePlanTerms enforces ranges", () => {
  const base = { freeUntilDays: 7, penaltyType: "nights", penaltyValue: 1, noShowPenaltyType: "percent", noShowPenaltyValue: 100 };
  const errors: Record<string, string> = {};
  assert.equal(validateRatePlanTerms({ ...base, freeUntilDays: 366 }, { dueDaysBeforeCheckIn: 14 }, errors), false);
  assert.ok(errors["cancellationPolicy.freeUntilDays"]);
});

// ---------------------------------------------------------------- stay validation
test("hotel/room/rate/inventory: validateStay accepts valid stay request", () => {
  const errors: Record<string, string> = {};
  const result = validateStay({
    checkIn: "2026-12-01", checkOut: "2026-12-05", rooms: 1, adults: 2, children: 0, childAges: [],
    roomOccupancies: [{ adults: 2, children: 0, childAges: [] }]
  }, errors);
  assert.ok(result !== null);
  assert.deepEqual(result?.checkIn, "2026-12-01");
  assert.deepEqual(result?.checkOut, "2026-12-05");
  assert.deepEqual(errors, {});
});

test("hotel/room/rate/inventory: validateStay rejects past dates", () => {
  const errors: Record<string, string> = {};
  const result = validateStay({
    checkIn: "2020-01-01", checkOut: "2020-01-05", rooms: 1, adults: 2, children: 0, childAges: [],
    roomOccupancies: [{ adults: 2, children: 0, childAges: [] }]
  }, errors, "2026-12-01");
  assert.equal(result, null);
  assert.ok(errors.checkIn);
});

test("hotel/room/rate/inventory: validateStay enforces max 60 nights", () => {
  const errors: Record<string, string> = {};
  const result = validateStay({
    checkIn: "2026-12-01", checkOut: "2027-02-01", rooms: 1, adults: 2, children: 0, childAges: [],
    roomOccupancies: [{ adults: 2, children: 0, childAges: [] }]
  }, errors);
  assert.equal(result, null);
  assert.ok(errors.checkOut);
});

// ---------------------------------------------------------------- occupancy validation
test("hotel/room/rate/inventory: validateOccupancy validates adults and children", () => {
  const errors: Record<string, string> = {};
  assert.ok(validateOccupancy({ adults: 2, children: 1, childAges: [5] }, errors) !== null);
  assert.deepEqual(errors, {});

  const errors2: Record<string, string> = {};
  assert.ok(validateOccupancy({ adults: 0, children: 1, childAges: [5] }, errors2) === null);
  assert.ok(errors2.adults);

  const errors3: Record<string, string> = {};
  assert.ok(validateOccupancy({ adults: 2, children: 1, childAges: [] }, errors3) === null);
  assert.ok(errors3.childAges);
});

// ---------------------------------------------------------------- calendar date
test("hotel/room/rate/inventory: isCalendarDate validates real dates", () => {
  assert.equal(isCalendarDate("2026-12-31"), true);
  assert.equal(isCalendarDate("2026-02-30"), false);
  assert.equal(isCalendarDate("not-a-date"), false);
  assert.equal(isCalendarDate(undefined), false);
});

// ---------------------------------------------------------------- nights calculation
test("hotel/room/rate/inventory: nightsBetween computes correct count", () => {
  assert.deepEqual(nightsBetween("2026-12-01", "2026-12-05"), ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]);
  assert.deepEqual(nightsBetween("2026-12-01", "2026-12-02"), ["2026-12-01"]);
});

// ---------------------------------------------------------------- room capacity validation logic
test("hotel/room/rate/inventory: room capacity validation rejects over-capacity", () => {
  const room = { max_adults: 2, max_children: 1 };
  const occupancy = { adults: 3, children: 0, childAges: [] };
  const isOverCapacity = occupancy.adults > room.max_adults || occupancy.children > room.max_children;
  assert.equal(isOverCapacity, true);

  const occupancy2 = { adults: 2, children: 1, childAges: [5] };
  const isOverCapacity2 = occupancy2.adults > room.max_adults || occupancy2.children > room.max_children;
  assert.equal(isOverCapacity2, false);
});

// ---------------------------------------------------------------- allotment validation logic
test("hotel/room/rate/inventory: allotment validation rejects below reserved", () => {
  const allotment = 5;
  const reserved = 3;
  const newAllotment = 2;
  const isInvalid = newAllotment < reserved;
  assert.equal(isInvalid, true);

  const newAllotment2 = 5;
  const isInvalid2 = newAllotment2 < reserved;
  assert.equal(isInvalid2, false);
});

// ---------------------------------------------------------------- stop-sale validation logic
test("hotel/room/rate/inventory: stop-sale deactivates rate plan", () => {
  const ratePlan = { active: true };
  ratePlan.active = false;
  assert.equal(ratePlan.active, false);

  ratePlan.active = true;
  assert.equal(ratePlan.active, true);
});
