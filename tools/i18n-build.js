/* Dil dosyalarını üretir: v40 sözlüğü + tools/tr/*.txt çeviri partileri → src/lang/{en,ar,ru}.js
   Yer tutucuların ({x}) her dilde aynı olduğunu denetler. */
const fs = require("fs"), path = require("path"), T = path.join(__dirname, "tr");
const keys = require("./todo.json"), v40 = require("./v40-i18n.json"), D = { en: {}, ar: {}, ru: {} }, L = ["en", "ar", "ru"];
Object.entries(v40).forEach(([k, a]) => L.forEach((l, i) => { if (a[i]) D[l][k] = a[i]; }));
let n = 0, bad = [];
fs.readdirSync(T).filter(f => /\.txt$/.test(f)).sort().forEach(f => fs.readFileSync(path.join(T, f), "utf8").split("\n").forEach(line => {
  if (!line.trim()) return; const p = line.split("|"); const i = +p[0]; if (!(i >= 0) || p.length != 4) { bad.push(f + ": " + line.slice(0, 60)); return; }
  const k = keys[i]; if (k == null) { bad.push("no key " + i); return; }
  const ph = s => (s.match(/\{\w+\}/g) || []).sort().join(","), want = ph(k);
  L.forEach((l, j) => { const v = p[j + 1].trim(); if (ph(v) != want) bad.push(`${i} ${l} placeholders ${ph(v)} != ${want}: ${k.slice(0, 50)}`); D[l][k] = v; }); n++;
}));
const miss = keys.filter(k => !D.en[k]);
L.forEach(l => { const o = Object.keys(D[l]).sort().reduce((a, k) => (a[k] = D[l][k], a), {}); fs.writeFileSync(path.join(__dirname, "../src/lang", l + ".js"), `/* ${l}: çeviri dosyası (kaynak metin Türkçe → ${l}). tools/i18n-build.js ile üretilir. */\nObject.assign(B4M.i18n.dicts.${l}, ${JSON.stringify(o, null, 0).replace(/","/g, '",\n"')});\n`); });
console.log("batch lines", n, "en entries", Object.keys(D.en).length, "missing", miss.length, "problems", bad.length); bad.slice(0, 30).forEach(x => console.log(" ", x)); miss.slice(0, 20).forEach(x => console.log(" miss:", x));
