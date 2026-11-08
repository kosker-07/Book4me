import test from "node:test";
import assert from "node:assert/strict";
import { validateStay } from "../../server/validation";

const base = {
  checkIn: "2030-01-01", checkOut: "2030-01-03",
  rooms: 2, adults: 4, children: 0, childAges: [] as number[],
  roomOccupancies: [
    { adults: 2, children: 0, childAges: [] as number[] },
    { adults: 2, children: 0, childAges: [] as number[] }
  ]
};
const check = (body: any) => {
  const errors: Record<string, string> = {};
  const stay = validateStay(body, errors, "2029-01-01");
  return { stay, errors };
};

test("room occupancy: 2+2 is accepted", () => {
  const { stay, errors } = check(base);
  assert.ok(stay);
  assert.deepEqual(errors, {});
});

test("room occupancy: a room with 3 adults cannot be hidden by another room", () => {
  const { stay } = check({ ...base, roomOccupancies: [{ adults: 3, children: 0, childAges: [] }, { adults: 1, children: 0, childAges: [] }] });
  assert.ok(stay);
  // Capacity is checked against each room's limits by the search/booking handlers.
  assert.equal(stay.roomOccupancies[0].adults, 3);
});

test("room occupancy: missing distribution is rejected", () => {
  assert.equal(check({ ...base, roomOccupancies: undefined }).errors.roomOccupancies, "ONE_OCCUPANCY_PER_ROOM");
});

test("room occupancy: every room requires at least one adult", () => {
  const result = check({ ...base, roomOccupancies: [{ adults: 4, children: 0, childAges: [] }, { adults: 0, children: 0, childAges: [] }] });
  assert.equal(result.errors["roomOccupancies[1].adults"], "INTEGER_AT_LEAST_1");
});

test("room occupancy: adult totals must match", () => {
  assert.equal(check({ ...base, roomOccupancies: [{ adults: 1, children: 0, childAges: [] }, { adults: 1, children: 0, childAges: [] }] }).errors["roomOccupancies.adults"], "MUST_MATCH_TOTAL_ADULTS");
});

test("room occupancy: child ages must match, order independent", () => {
  const childBase = { ...base, children: 2, childAges: [5, 12] };
  const valid = check({ ...childBase, roomOccupancies: [{ adults: 2, children: 1, childAges: [12] }, { adults: 2, children: 1, childAges: [5] }] });
  assert.ok(valid.stay);
  const invalid = check({ ...childBase, roomOccupancies: [{ adults: 2, children: 1, childAges: [11] }, { adults: 2, children: 1, childAges: [5] }] });
  assert.equal(invalid.errors["roomOccupancies.childAges"], "MUST_MATCH_TOTAL_CHILD_AGES");
});

test("room occupancy: invalid child age is rejected", () => {
  const result = check({ ...base, children: 1, childAges: [18], roomOccupancies: [{ adults: 2, children: 1, childAges: [18] }, { adults: 2, children: 0, childAges: [] }] });
  assert.equal(result.errors["roomOccupancies[0].childAges"], "ARRAY_OF_AGES_0_TO_17");
});
