import { inflateRawSync } from "node:zlib";

/** Read a ZIP member without runtime dependencies. Supports stored/deflated OOXML files. */
export function zipMember(zip: Buffer, target: string): Buffer | null {
  let offset = 0;
  while (offset + 30 <= zip.length) {
    if (zip.readUInt32LE(offset) !== 0x04034b50) break;
    const flags = zip.readUInt16LE(offset + 6);
    const method = zip.readUInt16LE(offset + 8);
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    if (flags & 0x08) throw new Error("ZIP_DATA_DESCRIPTOR_UNSUPPORTED");
    if (start + size > zip.length) throw new Error("INVALID_XLSX");
    if (name === target) {
      if (method === 0) return zip.subarray(start, start + size);
      if (method === 8) return inflateRawSync(zip.subarray(start, start + size));
      throw new Error("UNSUPPORTED_ZIP_COMPRESSION");
    }
    offset = start + size;
  }
  return null;
}
const decode=(s:string)=>s.replace(/&(?:amp|lt|gt|quot|apos);/g,m=>({ "&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&apos;":"'"}[m]||m));
const texts=(xml:string)=>[...xml.matchAll(/<t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/t>/g)].map(m=>decode(m[1]));
export type ContractPreview = {hotel:string;rooms:{name:string;board:string;from:string;to:string;netPrice:string;allotment:number}[];errors:{row:number;field:string;message:string}[]};
export function readExcelPreview(file:Buffer):ContractPreview {
 if(file.length>10*1024*1024)throw Error("FILE_TOO_LARGE");
 if(file.subarray(0,2).toString()!=="PK")throw Error("INVALID_XLSX");
 const sheet=zipMember(file,"xl/worksheets/sheet1.xml");
 if(!sheet)throw Error("UNSUPPORTED_FORMAT");
 const shared=zipMember(file,"xl/sharedStrings.xml");
 const strings=shared?[...shared.toString().matchAll(/<si(?:\\s[^>]*)?>([\\s\\S]*?)<\\/si>/g)].map(m=>texts(m[1]).join("")):[];
 const rows=[...sheet.toString().matchAll(/<row\\b([^>]*)>([\\s\\S]*?)<\\/row>/g)].map((m,i)=>{
  const cells:Record<string,string>={};
  for(const c of m[2].matchAll(/<c\\b([^>]*)(?:\\/>|>([\\s\\S]*?)<\\/c>)/g)){
   const ref=/\\br="([A-Z]+)\\d+"/.exec(c[1])?.[1];if(!ref)continue;
   const raw=/<v>([\\s\\S]*?)<\\/v>/.exec(c[2]||"")?.[1];
   cells[ref]=/\\bt="s"/.test(c[1])?strings[Number(raw)]||"":/\\bt="inlineStr"/.test(c[1])?texts(c[2]||"").join(""):raw||"";
  }
  return {row:Number(/\\br="(\\d+)"/.exec(m[1])?.[1]||i+1),cells};
 });
 const first=rows[0];if(!first)throw Error("UNSUPPORTED_FORMAT");
 const headers=Object.entries(first.cells).map(([col,value])=>[col,value.trim().toLowerCase()] as const);
 const aliases:Record<string,string[]>={hotel:["hotel","otel"],room:["room","oda"],board:["board","pansiyon"],from:["from","başlangıç"],to:["to","bitiş"],netPrice:["net price","net fiyat"],allotment:["allotment","kontenjan"]};
 const cols:Record<string,string>={};for(const [field,names] of Object.entries(aliases)){const match=headers.find(([,v])=>names.includes(v));if(match)cols[field]=match[0];}
 if(Object.keys(cols).length!==7)throw Error("UNSUPPORTED_FORMAT");
 const errors:ContractPreview["errors"]=[],out:ContractPreview["rooms"]=[];
 let hotel="";for(const row of rows.slice(1)){
  const val=(field:string)=>String(row.cells[cols[field]]||"").trim();
  if(!Object.values(row.cells).some(Boolean))continue;
  hotel ||=val("hotel");
  for(const field of ["hotel","room","board","from","to","netPrice","allotment"])if(!val(field))errors.push({row:row.row,field,message:"Required value missing"});
  if(!/^\\d+(?:\\.\\d{1,2})?$/.test(val("netPrice")))errors.push({row:row.row,field:"netPrice",message:"Invalid price"});
  if(!/^\\d+$/.test(val("allotment")))errors.push({row:row.row,field:"allotment",message:"Invalid allotment"});
  out.push({name:val("room"),board:val("board"),from:val("from"),to:val("to"),netPrice:val("netPrice"),allotment:Number(val("allotment"))});
 }
 return {hotel,rooms:out,errors};
}
