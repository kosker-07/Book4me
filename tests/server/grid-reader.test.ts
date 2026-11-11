import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readGridPreview } from "../../server/contract-import/grid-reader";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name));

test("Sejour associates the extra date ranges with periods A and B", () => {
  const preview = readGridPreview(fixture("SEJOUR - SEJOUR KONTRAT EXCELI ORNEK FORMAT PENINSULA.xlsx"));
  assert.equal(preview.hotels.length, 1);
  const [hotel] = preview.hotels;
  assert.ok(hotel);
  assert.equal(hotel.name, "XANADU RESORT HOTEL");
  assert.equal(hotel.rooms.length, 5);

  for (const { periods } of hotel.rooms) {
    assert.equal(periods.length, 6);
    assert.deepEqual(periods.slice(0, 2).map(({ from, to, extra_ranges }) => ({ from, to, extra_ranges })), [
      { from: "2021-11-01", to: "2021-11-19", extra_ranges: [{ from: "2022-03-16", to: "2022-04-07" }] },
      { from: "2021-11-20", to: "2021-12-24", extra_ranges: [{ from: "2022-03-01", to: "2022-03-15" }] },
    ]);
    assert.ok(periods.slice(2).every(({ extra_ranges }) => extra_ranges.length === 0));
    assert.ok(periods.every(({ release_days, min_stay }) => release_days === 3 && min_stay === 3));
  }

  const [room] = hotel.rooms;
  assert.deepEqual(room?.periods.slice(0, 2).map(({ allotment, prices }) => [allotment, prices.dbl]), [
    [10, 400], [10, 400],
  ]);
  assert.ok(preview.warnings.some(({ code }) => code === "PRICE_OUTLIER"));
  assert.ok(preview.warnings.every(({ code }) => code !== "INVALID_EXTRA_PERIOD"));
  assert.ok(preview.warnings.every(({ code, row }) => code !== "UNKNOWN_OCCUPANCY" || ![81, 82].includes(row)));
  assert.ok(preview.skipped.some(({ sheet }) => sheet === "KAPAK"));
});

test("Crystal reads labeled release days and minimum stay for every room and stores hotel notes", () => {
  const preview = readGridPreview(fixture("S27 Crystal Hotels PriceList_Europe & UK(1).xlsx"));
  const hotel = preview.hotels.find(({ sheet }) => sheet === "DE LUXE");
  assert.ok(hotel);
  assert.equal(hotel.name, "CRYSTAL DE LUXE");
  assert.equal(hotel.region, "KEMER");
  assert.deepEqual(hotel.notes.map(note => note.split(/\r?\n/)), [[
    "* All prices are in Periods, not in arrivals.",
    "* All prices include with TAX..",
    "* Honeymoon Concept: a document issued up to 6 months prior to arrival is required",
    "* The rates are not valid for group accommodations (10 rooms and above).",
  ]]);

  for (const { periods } of hotel.rooms) {
    assert.deepEqual(periods.map(({ release_days }) => release_days), [1, 1, 1, 3, 3, 3, 5, 5, 5, 5, 5, 1, 1, 1]);
    assert.deepEqual(periods.map(({ min_stay }) => min_stay), [3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3]);
    assert.ok(periods.every(({ extra_ranges }) => extra_ranges.length === 0));
  }

  assert.equal(hotel.rooms[0]?.periods[0]?.allotment, 4);
  assert.equal(hotel.rooms.find(({ name }) => name.includes("BUNKBED"))?.periods[0]?.allotment, 0);
  assert.ok(preview.warnings.some(({ code }) => code === "ON_REQUEST"));
  assert.ok(preview.warnings.every(({ code, message }) =>
    code !== "UNKNOWN_OCCUPANCY" || !/^(release days|min(?:imum)? stay|other conditions)$/i.test(message),
  ));
  assert.ok(preview.skipped.some(({ sheet }) => sheet === "Ülke-Pazar Tanımları"));
});

test("invalid XLSX is rejected",()=>{
 assert.throws(()=>readGridPreview(Buffer.from("not an xlsx")),/INVALID_XLSX/);
});
test("10MB maximum enforced",()=>{
 assert.throws(()=>readGridPreview(Buffer.alloc(10*1024*1024+1)),/FILE_TOO_LARGE/);
});
test("invalid ZIP workbook rejected",()=>{
 assert.throws(()=>readGridPreview(Buffer.from("PKgarbage")),/INVALID_XLSX/);
});

test("invalid workbook with date-like content is not accepted",()=>{
 assert.throws(()=>readGridPreview(Buffer.from("PK\\x03\\x04")),/INVALID_XLSX/);
});
