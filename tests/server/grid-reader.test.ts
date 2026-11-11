import test from "node:test";
import assert from "node:assert/strict";
import { readGridPreview } from "../../server/contract-import/grid-reader";

test("invalid XLSX is rejected",()=>{
 assert.throws(()=>readGridPreview(Buffer.from("not an xlsx")),/INVALID_XLSX/);
});
test("10MB maximum enforced",()=>{
 assert.throws(()=>readGridPreview(Buffer.alloc(10*1024*1024+1)),/FILE_TOO_LARGE/);
});
test("invalid ZIP workbook rejected",()=>{
 assert.throws(()=>readGridPreview(Buffer.from("PKgarbage")),/INVALID_XLSX/);
});
