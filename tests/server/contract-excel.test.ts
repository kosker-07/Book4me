import test from "node:test";
import assert from "node:assert/strict";
import { readExcelPreview } from "../../server/contract-import/excel-reader";
function member(name:string,body:string):Buffer{
 const n=Buffer.from(name),b=Buffer.from(body),h=Buffer.alloc(30);
 h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt32LE(b.length,18);h.writeUInt32LE(b.length,22);h.writeUInt16LE(n.length,26);
 return Buffer.concat([h,n,b]);
}
const row=(n:number,values:string[])=>'<row r="'+n+'">'+values.map((v,i)=>'<c r="'+String.fromCharCode(65+i)+n+'" t="inlineStr"><is><t>'+v+'</t></is></c>').join("")+'</row>';
test("Y1 Excel preview extracts hotel, room, board, price and allotment without DB writes",()=>{
 const headers=["hotel","room","board","from","to","net price","allotment"];
 const values=["Test Hotel","Standard","BB","2026-12-01","2026-12-05","100.00","3"];
 const xml='<worksheet><sheetData>'+row(1,headers)+row(2,values)+'</sheetData></worksheet>';
 const preview=readExcelPreview(member("xl/worksheets/sheet1.xml",xml));
 assert.equal(preview.hotel,"Test Hotel");assert.deepEqual(preview.errors,[]);
 assert.deepEqual(preview.rooms,[{name:"Standard",board:"BB",from:"2026-12-01",to:"2026-12-05",netPrice:"100.00",allotment:3}]);
});
test("Y3 malformed workbook is rejected",()=>assert.throws(()=>readExcelPreview(Buffer.from("broken")),/INVALID_XLSX/));
test("Y3 unknown spreadsheet layout is rejected",()=>{
 const xml='<worksheet><sheetData>'+row(1,["unknown"])+'</sheetData></worksheet>';
 assert.throws(()=>readExcelPreview(member("xl/worksheets/sheet1.xml",xml)),/UNSUPPORTED_FORMAT/);
});
