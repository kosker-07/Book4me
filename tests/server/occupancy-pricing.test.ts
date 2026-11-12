import test from "node:test";
import assert from "node:assert/strict";
import { parseOccupancyKey, priceForOccupancy } from "../../server/occupancy-pricing";
import { priceCandidate } from "../../server/pricing";

const crystal = { pp_dbl: 60, dbl: 120, sgl: 90, dbl_exb: 162, child_1_adl_1_chd_2_11_99: 90, child_1_adl_2_chd_2_11_99: 120, child_2_adl_1_chd_2_11_99: 120, child_2_adl_2_chd_2_11_99: 150 };

test("O1 occupancy keys from real price lists parse to adults, children and age ranges", () => {
  assert.deepEqual(parseOccupancyKey("child_2_adl_1_chd_2_11_99"), { adults: 2, children: 1, ranges: [[2, 11.99]] });
  assert.deepEqual(parseOccupancyKey("child_3ad_1_chd_00_11_99"), { adults: 3, children: 1, ranges: [[0, 11.99]] });
  assert.deepEqual(parseOccupancyKey("child_2_ad_3_chd_00_11_99_00_11_99_00_01_99"), { adults: 2, children: 3, ranges: [[0, 11.99], [0, 11.99], [0, 1.99]] });
  assert.deepEqual(parseOccupancyKey("pax3"), { adults: 3, children: 0, ranges: [] });
  for (const k of ["room", "pp_dbl", "child_x", "child_2_adl_2_chd_2_11", "child_0_adl_1_chd_2_11_99"]) assert.equal(parseOccupancyKey(k), null, k);
});

test("O2 a room is priced only for an occupancy the contract prices; never a guess from the double price", () => {
  assert.deepEqual([priceForOccupancy(crystal, 2, []), priceForOccupancy(crystal, 1, []), priceForOccupancy(crystal, 3, [])], [120, 90, 162]);
  assert.deepEqual([priceForOccupancy(crystal, 2, [5]), priceForOccupancy(crystal, 1, [5]), priceForOccupancy(crystal, 2, [5, 8])], [120, 90, 150]);
  assert.equal(priceForOccupancy(crystal, 2, [1]), null, "infant below the contract's child range");
  assert.equal(priceForOccupancy(crystal, 2, [12]), null, "12 is not a child in a 2-11.99 range");
  assert.equal(priceForOccupancy(crystal, 4, []), null);
  assert.equal(priceForOccupancy({ pp_dbl: 61.5 }, 2, []), 123);
  assert.equal(priceForOccupancy({ dbl: 0 }, 2, []), null, "zero is not a price");
  const multi = { child_2_ad_3_chd_00_11_99_00_11_99_00_01_99: 700 };
  assert.equal(priceForOccupancy(multi, 2, [1, 5, 9]), 700);
  assert.equal(priceForOccupancy(multi, 2, [5, 6, 9]), null, "one of the three must be an infant");
  assert.equal(priceForOccupancy(null, 2, []), null);
});

test("O3 per-room nets: the night's sell price covers all rooms and is not multiplied again", () => {
  const base: any = { ratePlanId: "p", hotelId: "h", roomId: "r", board: "BB", currency: "EUR", markup: { type: "percent", value: "10" }, platformFeePercent: "0" };
  const o = { adults: 3, children: 0, childAges: [] };
  const byRoom = priceCandidate({ ...base, nights: [{ date: "2027-01-01", netPrice: "120", roomNetPrices: ["120", "90"] }, { date: "2027-01-02", netPrice: "120", roomNetPrices: ["120", "90"] }] }, o, "a", "b", 2, new Map());
  assert.deepEqual(byRoom.nightSellMinor, [23100, 23100]);
  assert.equal(byRoom.totalMinor, 46200);
  const classic = priceCandidate({ ...base, nights: [{ date: "2027-01-01", netPrice: "120" }] }, o, "a", "b", 2, new Map());
  assert.equal(classic.totalMinor, 26400, "classic plans still multiply by rooms");
});
