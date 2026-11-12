import test from "node:test";
import assert from "node:assert/strict";
import { readPdfPreview, ContractPdfError } from "../../server/contract-import/pdf-reader";
function pdf(stream:string):Buffer {
 const content=Buffer.from(stream,"latin1");
 return Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length "+content.length+" >>\nstream\n"+stream+"\nendstream\nendobj\n%%EOF","latin1");
}
test("Y2 valid text PDF produces the Excel-compatible preview schema",()=>{
 const lines=["Hotel: Test Hotel","Room: Standard","Board: BB","From: 2026-12-01","To: 2026-12-05","Net Price: 100.00","Allotment: 3"];
 const stream="BT\n"+lines.map(s=>"("+s+") Tj").join("\n")+"\nET";
 const result=readPdfPreview(pdf(stream));
 assert.equal(result.hotel,"Test Hotel");
 assert.deepEqual(result.rooms,[{name:"Standard",board:"BB",from:"2026-12-01",to:"2026-12-05",netPrice:"100.00",allotment:3}]);
 assert.deepEqual(result.errors,[]);
});
test("Y3 broken PDF fails with INVALID_PDF",()=>{
 assert.throws(()=>readPdfPreview(Buffer.from("garbage")),(e:unknown)=>e instanceof ContractPdfError&&e.code==="INVALID_PDF");
});
test("Y4 scanned PDF with image stream but no text layer returns SCANNED_PDF_UNSUPPORTED",()=>{
 assert.throws(()=>readPdfPreview(pdf("q 100 0 0 100 0 0 cm /Im0 Do Q")),(e:unknown)=>e instanceof ContractPdfError&&e.code==="SCANNED_PDF_UNSUPPORTED");
});
test("Y2 unsupported text layout is rejected rather than inventing rates",()=>{
 assert.throws(()=>readPdfPreview(pdf("BT (Hello world) Tj ET")),(e:unknown)=>e instanceof ContractPdfError&&e.code==="UNSUPPORTED_FORMAT");
});
