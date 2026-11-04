/* Kaynak metin tarayıcı: t("..."), UI.ask("..."), ok/no("..."), toast("..."), tn(n,"...") ve
   t()'ye dolaylı giden sabit dizilerdeki metinleri toplar. Çıktı: tools/strings.json */
const fs = require("fs"), path = require("path"), SRC = path.join(__dirname, "../src");
const files = []; (function walk(d) { fs.readdirSync(d).forEach(f => { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.js$/.test(f) && !/lang\/|data\//.test(p.replace(/\\/g, "/"))) files.push(p); }); })(SRC);
const S = new Set(), lit = `"((?:[^"\\\\]|\\\\.)*)"`;
const pats = [new RegExp(`\\bt\\(\\s*${lit}`, "g"), new RegExp(`\\b(?:ok|no|toast|ask|UI\\.ask|UI\\.toast|B4M\\.res\\.ok|B4M\\.res\\.no)\\(\\s*${lit}`, "g"), new RegExp(`\\btn\\([^,()]+,\\s*${lit}`, "g")];
const un = s => JSON.parse('"' + s + '"');
for (const f of files) { const c = fs.readFileSync(f, "utf8"); for (const re of pats) { let m; re.lastIndex = 0; while ((m = re.exec(c))) { try { const v = un(m[1]); if (/[A-Za-zçğıöşüÇĞİÖŞÜ]/.test(v)) S.add(v); } catch (e) { } } } }
/* yapılandırma dizilerinden: tüm Türkçe karakterli veya boşluk içeren sabit metinler (aday) */
const C = new Set();
for (const f of files) { const c = fs.readFileSync(f, "utf8"); const re = new RegExp(lit, "g"); let m; while ((m = re.exec(c))) { try { const v = un(m[1]); if (!S.has(v) && /[çğıöşüÇĞİÖŞÜ]/.test(v) && !/[<>{}=;]|\$\{|^\s|https?:/.test(v) && v.length < 300) C.add(v); } catch (e) { } } }
fs.writeFileSync(path.join(__dirname, "strings.json"), JSON.stringify({ t: [...S].sort(), cand: [...C].sort() }, null, 1));
console.log("t()", S.size, "candidates", C.size);
