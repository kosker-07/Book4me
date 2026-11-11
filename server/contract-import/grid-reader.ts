import { inflateRawSync } from "node:zlib";

export type GridWarning = { sheet: string; row: number; code: string; message: string };
export type GridPeriod = { from: string; to: string; min_stay: number | null; allotment: number; prices: Record<string,number> };
export type GridRoom = { name: string; periods: GridPeriod[] };
export type GridHotel = { name: string; region: string; concept: string; currency: string; sheet: string; rooms: GridRoom[] };
export type GridPreview = { hotels: GridHotel[]; skipped: {sheet:string;reason:string}[]; warnings: GridWarning[] };
type Sheet = { name:string; rows:Map<number,Map<number,string>> };
const decode=(s:string)=>s.replace(/&(?:amp|lt|gt|quot|apos);/g,m=>({"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&apos;":"'"}[m]??m));
const texts=(s:string)=>[...s.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>decode(m[1]??"")).join("");
const attr=(s:string,k:string)=>new RegExp("\\b"+k+"=\"([^\"]*)\"").exec(s)?.[1]??"";
function entries(file:Buffer):Map<string,Buffer>{
 if(file.length>10485760)throw Error("FILE_TOO_LARGE");
 if(file.subarray(0,2).toString()!=="PK")throw Error("INVALID_XLSX");
 const out=new Map<string,Buffer>();let p=0;
 while(p+30<=file.length&&file.readUInt32LE(p)===0x04034b50){
  const flags=file.readUInt16LE(p+6),method=file.readUInt16LE(p+8),size=file.readUInt32LE(p+18),nl=file.readUInt16LE(p+26),el=file.readUInt16LE(p+28);
  const start=p+30+nl+el;if(flags&8||start+size>file.length)throw Error("INVALID_XLSX");
  const name=file.subarray(p+30,p+30+nl).toString();
  if(name.startsWith("xl/")&&(name.endsWith(".xml")||name.endsWith(".rels"))){
   if(method!==0&&method!==8)throw Error("INVALID_XLSX");
   out.set(name,method===0?file.subarray(start,start+size):inflateRawSync(file.subarray(start,start+size)));
  }p=start+size;
 }
 if(!out.has("xl/workbook.xml"))throw Error("INVALID_XLSX");return out;
}
function parseSheets(file:Buffer):Sheet[]{
 const zip=entries(file),wb=zip.get("xl/workbook.xml")?.toString()??"",rels=zip.get("xl/_rels/workbook.xml.rels")?.toString()??"";
 const shared=[...(zip.get("xl/sharedStrings.xml")?.toString()??"").matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m=>texts(m[1]??""));
 const paths=new Map<string,string>();
 for(const m of rels.matchAll(/<Relationship\b([^>]*?)\/?\s*>/g)){
  const a=m[1]??"",target=attr(a,"Target");
  paths.set(attr(a,"Id"),target.startsWith("/")?target.slice(1):"xl/"+target.replace(/^\.\.\//,""));
 }
 const result:Sheet[]=[];let index=0;
 for(const m of wb.matchAll(/<sheet\b([^>]*?)\/?\s*>/g)){
  index++;const a=m[1]??"",name=decode(attr(a,"name")),path=paths.get(attr(a,"r:id"))??"xl/worksheets/sheet"+index+".xml";
  const xml=zip.get(path)?.toString()??"",rows=new Map<number,Map<number,string>>();
  for(const r of xml.matchAll(/<row\b([^>]*?)>([\s\S]*?)<\/row>/g)){
   const rn=Number(attr(r[1]??"","r"));if(!rn)continue;const cells=new Map<number,string>();
   for(const c of (r[2]??"").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
    const a=c[1]??"",ref=attr(a,"r"),letters=/^[A-Z]+/.exec(ref)?.[0]??"";
    let col=0;for(const ch of letters)col=col*26+ch.charCodeAt(0)-64;
    if(!col)continue;const body=c[2]??"",raw=/<v>([\s\S]*?)<\/v>/.exec(body)?.[1]??"";
    const v=attr(a,"t")==="s"?shared[Number(raw)]??"":attr(a,"t")==="inlineStr"?texts(body):raw;
    if(v.trim())cells.set(col,decode(v).trim());
   }rows.set(rn,cells);
  }result.push({name,rows});
 }return result;
}
const cell=(s:Sheet,r:number,c:number)=>s.rows.get(r)?.get(c)??"";
function asDate(v:string):string|null{
 if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;
 if(/^\d{5}(?:\.0+)?$/.test(v)){const d=new Date(Date.UTC(1899,11,30)+Number(v)*86400000);return d.toISOString().slice(0,10);}
 const m=/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(v);
 if(!m)return null;const d=Number(m[1]??0),mo=Number(m[2]??0),y=Number(m[3]??0),x=new Date(Date.UTC(y,mo-1,d));
 return x.getUTCDate()===d&&x.getUTCMonth()===mo-1?x.toISOString().slice(0,10):null;
}
function key(label:string):string|null{
 const v=label.toUpperCase().replace(/\s+/g," ").trim();
 if(/^(IN DBL PP|PER PERSON IN DBL)$/.test(v))return "pp_dbl";
 if(/^(DOUBLE|DBL)$/.test(v))return "dbl";
 if(/^(SINGLE|SNG)$/.test(v))return "sgl";
 if(/^(DOUBLE\s*\+\s*EXTRA BED|DBL\s*\+\s*EXB)$/.test(v))return "dbl_exb";
 if(/CHD|CHILD/.test(v)&&/ADL|AD|ADULT|DBL|SNG/.test(v))return "child_"+v.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
 return null;
}
function parse(s:Sheet,warnings:GridWarning[]):GridHotel|null{
 const ids=[...s.rows.keys()].sort((a,b)=>a-b);
 const blocks=ids.filter(r=>cell(s,r,1)!==""&&/ALLOTMENT/i.test(cell(s,r+1,1)));if(!blocks.length)return null;
 const first=blocks[0]??Infinity;let name="",region="",concept="",currency="EUR";
 for(const r of ids.filter(r=>r<first)){
  const a=cell(s,r,1),b=cell(s,r,2);
  if(/^hotel\s*name/i.test(a))name=b;
  if(/^region/i.test(a))region=b;
  if(/^concept/i.test(a))concept=b;
  if(/^currency/i.test(a))currency=/USD/i.test(b)?"USD":/GBP/i.test(b)?"GBP":/TRY|TL/i.test(b)?"TRY":"EUR";
 }
 if(!name)name=ids.filter(r=>r<first).map(r=>cell(s,r,1)).find(v=>/CRYSTAL/i.test(v))??s.name;
 const periods:{col:number;from:string;to:string;min_stay:number|null}[]=[];
 for(const r of ids.filter(r=>r<first)){
  const dates=[...(s.rows.get(r)?.entries()??[])].filter(([c,v])=>c>1&&asDate(v));
  if(dates.length<2)continue;
  const vertical=dates.filter(([c])=>asDate(cell(s,r+1,c))).length>=Math.max(2,dates.length-1);
  if(vertical){
   for(const [c,v] of dates){const from=asDate(v),to=asDate(cell(s,r+1,c));if(from&&to)periods.push({col:c,from,to,min_stay:Number(cell(s,r+2,c))||null});}
  }else{
   for(let j=0;j+1<dates.length;j+=2){const from=asDate(dates[j]?.[1]??""),to=asDate(dates[j+1]?.[1]??"");if(from&&to)periods.push({col:dates[j]?.[0]??0,from,to,min_stay:null});}
  }if(periods.length)break;
 }if(!periods.length)return null;
 const rooms:GridRoom[]=[];
 for(let i=0;i<blocks.length;i++){
  const start=blocks[i]??0,end=blocks[i+1]??(Math.max(...ids)+1);
  const room:GridRoom={name:cell(s,start,1),periods:periods.map(p=>({from:p.from,to:p.to,min_stay:p.min_stay,allotment:0,prices:{}}))};
  for(let j=0;j<periods.length;j++){
   const p=periods[j],target=room.periods[j];if(!p||!target)continue;
   const raw=cell(s,start+1,p.col);
   if(/ON\s*REQUEST/i.test(raw)){warnings.push({sheet:s.name,row:start+1,code:"ON_REQUEST",message:"ON_REQUEST (satışa açılmaz)"});continue;}
   target.allotment=[...raw.matchAll(/\d+/g)].reduce((sum,m)=>sum+Number(m[0]??0),0);
  }
  for(let r=start+2;r<end;r++){
   const label=cell(s,r,1);if(!label)continue;
   const values=periods.map(p=>cell(s,r,p.col));if(!values.some(Boolean))continue;
   const occupancy=key(label);if(!occupancy){warnings.push({sheet:s.name,row:r,code:"UNKNOWN_OCCUPANCY",message:label});continue;}
   const nums=values.map(v=>v?Number(v.replace(",",".")):NaN);
   const valid=nums.filter(n=>Number.isFinite(n)&&n>=0).sort((a,b)=>a-b);
   const median=valid.length?(valid.length%2?valid[Math.floor(valid.length/2)]??0:((valid[valid.length/2-1]??0)+(valid[valid.length/2]??0))/2):0;
   for(let j=0;j<periods.length;j++){
    const n=nums[j],target=room.periods[j];if(!target)continue;
    if(n===undefined||!Number.isFinite(n)||n<0){warnings.push({sheet:s.name,row:r,code:"EMPTY_PRICE",message:label});continue;}
    target.prices[occupancy]=n;
    if(median>0&&(n>3*median||n*3<median))warnings.push({sheet:s.name,row:r,code:"PRICE_OUTLIER",message:label+": "+n});
   }
  }rooms.push(room);
 }return {name,region,concept,currency,sheet:s.name,rooms};
}
export function readGridPreview(file:Buffer):GridPreview{
 const warnings:GridWarning[]=[],hotels:GridHotel[]=[],skipped:GridPreview["skipped"]=[];
 for(const s of parseSheets(file)){const hotel=parse(s,warnings);if(hotel)hotels.push(hotel);else skipped.push({sheet:s.name,reason:"Oda bloğu veya dönem bulunamadı"});}
 return {hotels,skipped,warnings};
}
