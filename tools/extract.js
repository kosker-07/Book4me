// v40'tan veri varlıklarını ayıklar (konum DB, demo fiyat listesi, çeviri sözlüğü)
const fs=require('fs');const js=fs.readFileSync(process.argv[2],'utf8').split('\n');const out=process.argv[3];
const seg=(a,b)=>js.slice(a-1,b).join('\n');
// konum
const locSrc=js.slice(530,661).join('\n');
const L=new Function('norm',locSrc.replace(/let _LI[\s\S]*$/,'')+';return {LOC,TRT,AIR}')(s=>s);
fs.writeFileSync(out+'/data/loc.js','/* Konum veritabanı: Türkiye 81 il + ilçeler, turistik bölgeler; Mısır valilikleri; havalimanları */\nB4M.data.LOC='+JSON.stringify(L.LOC)+';\nB4M.data.TRT='+JSON.stringify(L.TRT)+';\nB4M.data.AIR='+JSON.stringify(L.AIR)+';\n');
// demo fiyat listesi
const xd=js[1186].replace(/^const XDEMO=/,'').replace(/;\s*$/,'');JSON.parse(xd);
fs.writeFileSync(out+'/data/xdemo.js','/* Örnek fiyat listesi: 2023_SUMMER_PRICE_1.xlsx (4 otel) */\nB4M.data.XDEMO='+xd+';\n');
// sözlük
const i18=new Function(seg(1701,1808).replace('const I18N=','return '))();
fs.writeFileSync(out+'/../tools/v40-i18n.json',JSON.stringify(i18));
const w=new Function(seg(1810,1812).replace('const I18W=','return '))();
fs.writeFileSync(out+'/../tools/v40-i18w.json',JSON.stringify(w));
console.log('loc',Object.keys(L.LOC.TR.p).length,'xdemo sheets',JSON.parse(xd).length,'i18n',Object.keys(i18).length,'i18w',Object.keys(w).length);
