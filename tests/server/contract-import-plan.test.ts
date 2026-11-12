import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readGridPreview } from "../../server/contract-import/grid-reader";
import { nights, planHotel, roomPrice, rowCount } from "../../server/contract-import/plan";

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name));
const CRYSTAL = "S27 Crystal Hotels PriceList_Europe & UK(1).xlsx";
const PENINSULA = "SEJOUR - SEJOUR KONTRAT EXCELI ORNEK FORMAT PENINSULA.xlsx";

test("X1 Crystal workbook: 13 hotels, first period of DE LUXE land view becomes nightly rows at the double room price", () => {
  const plans = readGridPreview(fixture(CRYSTAL)).hotels.map(planHotel);
  assert.equal(plans.length, 13);
  const deluxe = plans.find(p => p.name === "CRYSTAL DE LUXE")!;
  assert.equal(deluxe.currency, "EUR");
  const room = deluxe.rooms.find(r => r.name.startsWith("STANDARD ROOM LAND VIEW"))!;
  const i = room.dates.indexOf("2027-03-05");
  assert.ok(i >= 0);
  assert.equal(room.prices[i], "120.00");
  assert.equal(room.allotments[i], 4);
  assert.ok(room.dates.includes("2027-03-18"), "the period's last night is included");
  assert.deepEqual([...room.dates].sort(), room.dates, "dates are sorted");
  assert.equal(new Set(room.dates).size, room.dates.length, "no duplicate nights");
  assert.ok(rowCount(plans) > 0);
});

test("X2 Peninsula workbook: extra date ranges are imported and the concept is kept", () => {
  const [xanadu] = readGridPreview(fixture(PENINSULA)).hotels.map(planHotel);
  assert.equal(xanadu!.name, "XANADU RESORT HOTEL");
  assert.equal(xanadu!.concept, "Ultra All inclusive");
  const room = xanadu!.rooms.find(r => r.name === "MAIN BUILDING STANDARD GARDENVIEW")!;
  for (const d of ["2021-11-01", "2021-11-19", "2022-03-16", "2022-04-07"]) assert.ok(room.dates.includes(d), d);
  assert.equal(room.prices[room.dates.indexOf("2021-11-01")], "400.00");
  assert.ok(xanadu!.validFrom! <= "2021-11-01" && xanadu!.validTo! >= "2022-04-07");
});

test("X3 plan rules: room price falls back to per-person x2, bad ranges and missing prices are errors", () => {
  assert.equal(roomPrice({ from: "", to: "", extra_ranges: [], min_stay: null, release_days: null, allotment: 1, prices: { pp_dbl: 61.5 } }), 123);
  assert.equal(roomPrice({ from: "", to: "", extra_ranges: [], min_stay: null, release_days: null, allotment: 1, prices: { sgl: 90 } }), null);
  assert.deepEqual(nights("2027-01-30", "2027-02-02"), ["2027-01-30", "2027-01-31", "2027-02-01", "2027-02-02"]);
  assert.equal(nights("2027-02-02", "2027-01-30"), null);
  assert.equal(nights("2027-01-01", "2029-01-01"), null, "over two years");
  const p = planHotel({ name: " Test ", region: "", concept: "", currency: "eur", sheet: "s", notes: [], rooms: [
    { name: "A", periods: [
      { from: "2027-01-01", to: "2027-01-03", extra_ranges: [], min_stay: null, release_days: null, allotment: 2, prices: { dbl: 100 } },
      { from: "2027-01-03", to: "2027-01-04", extra_ranges: [], min_stay: null, release_days: null, allotment: 3, prices: { dbl: 110 } },
      { from: "2027-02-01", to: "2027-02-01", extra_ranges: [], min_stay: null, release_days: null, allotment: 3, prices: { sgl: 80 } }
    ] },
    { name: "B", periods: [{ from: "x", to: "y", extra_ranges: [], min_stay: null, release_days: null, allotment: 1, prices: { dbl: 1 } }] }
  ] });
  assert.equal(p.name, "Test"); assert.equal(p.currency, "EUR");
  assert.deepEqual(p.rooms.map(r => r.name), ["A"], "a room with no valid night is left out");
  assert.deepEqual(p.rooms[0]!.dates, ["2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04"]);
  assert.deepEqual(p.rooms[0]!.prices, ["100.00", "100.00", "110.00", "110.00"], "overlap: the later period wins");
  assert.deepEqual(p.errors.map(e => e.code).sort(), ["INVALID_DATE_RANGE", "NO_ROOM_PRICE"]);
  assert.deepEqual(p.warnings.map(e => e.code), ["OVERLAPPING_PERIOD_LAST_WINS"]);
  assert.deepEqual([p.validFrom, p.validTo], ["2027-01-01", "2027-01-04"]);
});
