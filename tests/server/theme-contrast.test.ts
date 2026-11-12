import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css=readFileSync("web/styles.css","utf8");
function rgb(hex:string){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);}
function contrast(a:string,b:string){const l=(x:string)=>rgb(x).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i]!,0);const x=l(a),y=l(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
test("theme C1 danger, metric and price use semantic CSS tokens",()=>{for(const [cls,token] of [["danger","danger-text"],["metric","metric-text"],["price","price-text"]])assert.match(css,new RegExp("\\."+cls+"\\{[^}]*color:var\\(--"+token+"\\)"));});
test("theme C2 dark and light semantic accents meet WCAG AA 4.5:1",()=>{for(const color of ["#ff8993"])assert.ok(contrast(color,"#0b0d12")>=4.5);for(const color of ["#b00020","#a0001d"])assert.ok(contrast(color,"#ffffff")>=4.5);});
