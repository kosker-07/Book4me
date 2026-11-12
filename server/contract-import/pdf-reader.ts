import { inflateSync } from "node:zlib";
import type { ContractPreview } from "./excel-reader";

/** Text-layer PDF only; scanned/image-only documents must be rejected, not guessed. */
export class ContractPdfError extends Error {
  constructor(public readonly code: "INVALID_PDF" | "SCANNED_PDF_UNSUPPORTED" | "UNSUPPORTED_FORMAT") { super(code); }
}
function pdfString(s:string):string {
  return s.replace(/\\([nrtbf()\\])/g,(_,c:string)=>({n:"\n",r:"\r",t:"\t",b:"",f:"","(":"(",")":")","\\":"\\"}[c]??c))
    .replace(/\\([0-7]{1,3})/g,(_,oct:string)=>String.fromCharCode(parseInt(oct,8)));
}
function extractText(file:Buffer):string {
  if(file.length>10*1024*1024 || !file.subarray(0,8).toString("latin1").startsWith("%PDF-"))throw new ContractPdfError("INVALID_PDF");
  const raw=file.toString("latin1"),chunks:string[]=[];
  for(const match of raw.matchAll(/stream\r?\n/g)){
    const start=match.index!+match[0].length;
    const end=raw.indexOf("endstream",start);if(end<0)continue;
    const dictionary=raw.slice(Math.max(0,match.index!-800),match.index!);
    let bytes=file.subarray(start,end);
    if(bytes.length&&bytes[bytes.length-1]===10)bytes=bytes.subarray(0,bytes.length-1);
    if(bytes.length&&bytes[bytes.length-1]===13)bytes=bytes.subarray(0,bytes.length-1);
    if(/\/FlateDecode\b/.test(dictionary)){try{bytes=inflateSync(bytes)}catch{continue}}
    const content=bytes.toString("latin1");
    for(const block of content.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)){
      const pieces:string[]=[];
      for(const token of (block[1]??"").matchAll(/\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|\[((?:\((?:\\.|[^\\)])*\)|[^\]])*)\]\s*TJ/g)){
        if(token[1]!==undefined)pieces.push(pdfString(token[1]));
        else pieces.push([...(token[2]??"").matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map(part=>pdfString(part[1]??"")).join(""));
      }
      if(pieces.length)chunks.push(pieces.join("\n"));
    }
  }
  return chunks.join("\n");
}
export function readPdfPreview(file:Buffer):ContractPreview {
  const text=extractText(file);
  if(!text.trim())throw new ContractPdfError("SCANNED_PDF_UNSUPPORTED");
  const fields:Record<string,string>={};
  for(const line of text.split(/\r?\n/)){
    const match=/^\s*(Hotel|Otel|Room|Oda|Board|Pansiyon|From|Başlangıç|To|Bitiş|Net Price|Net Fiyat|Allotment|Kontenjan)\s*:\s*(.+)\s*$/i.exec(line);
    if(match)fields[(match[1]??"").toLocaleLowerCase("tr")]=(match[2]??"").trim();
  }
  const get=(...keys:string[])=>keys.map(k=>fields[k]).find(Boolean)||"";
  const hotel=get("hotel","otel"),name=get("room","oda"),board=get("board","pansiyon"),from=get("from","başlangıç"),to=get("to","bitiş"),netPrice=get("net price","net fiyat"),allotment=get("allotment","kontenjan");
  if(!hotel||!name||!board||!from||!to)throw new ContractPdfError("UNSUPPORTED_FORMAT");
  const errors:ContractPreview["errors"]=[];
  if(!/^\d+(?:\.\d{1,2})?$/.test(netPrice))errors.push({row:1,field:"netPrice",message:"Invalid price"});
  if(!/^\d+$/.test(allotment))errors.push({row:1,field:"allotment",message:"Invalid allotment"});
  return {hotel,rooms:[{name,board,from,to,netPrice,allotment:Number(allotment)}],errors};
}
