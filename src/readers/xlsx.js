/* Kendi Excel (.xlsx/.xlsm) okuyucumuz: ZIP + XML. Dış kütüphane ya da yapay zekâ kullanmaz.
   Çıktı: [{name, rows:[[hücre,...],...]}]; tarih biçimli hücreler Date nesnesi olarak döner. */
const X = B4M.xlsx = {};
/* sıkıştırma çözücü ortamdan gelir: tarayıcıda DecompressionStream, Node'da zlib */
X.inflate = async u8 => {
  if (B4M.env && B4M.env.inflateRaw) return B4M.env.inflateRaw(u8);
  const ds = new DecompressionStream("deflate-raw"), w = ds.writable.getWriter(); w.write(u8); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
};
X.unzip = async buf => {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = {};
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) != 0x06054b50) e--; if (e < 0) throw new Error("zip");
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const dec = new TextDecoder("utf-8");
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) != 0x02014b50) throw new Error("zip");
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true), flags = dv.getUint16(p + 8, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    if (flags & 1) throw new Error("encrypted");
    const ln = dv.getUint16(lo + 26, true), lx = dv.getUint16(lo + 28, true), st = lo + 30 + ln + lx, data = u8.subarray(st, st + csize);
    out[name] = { method, data };
  }
  return out;
};
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
X.unesc = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, k) => k[0] == "#" ? String.fromCodePoint(k[1] == "x" || k[1] == "X" ? parseInt(k.slice(2), 16) : +k.slice(1)) : ENT[k] ?? m);
const attr = (tag, a) => { const m = tag.match(new RegExp("\\s" + a + "=\"([^\"]*)\"")); return m ? X.unesc(m[1]) : null; };
const txt = s => { let r = ""; s.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (m, x) => { r += x; }); return X.unesc(r); };
X.colIdx = ref => { const m = ref.match(/^([A-Z]+)(\d+)$/); let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return [c - 1, +m[2] - 1]; };
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const isDateFmt = f => { if (!f) return false; const s = f.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, ""); return /[dmyhs]/i.test(s) && !/^general$/i.test(s) && !/[#0]/.test(s.replace(/[^#0dmyhs]/gi, "").replace(/[dmyhs]/gi, "")); };
X.serialDate = (v, d1904) => new Date(Math.round(((d1904 ? v + 1462 : v) - 25569) * 864e5));
X.read = async buf => {
  const Z = await X.unzip(buf), dec = new TextDecoder("utf-8"), get = async n => { const e = Z[n]; if (!e) return null; const d = e.method == 8 ? await X.inflate(e.data) : e.data; return dec.decode(d); };
  const wb = await get("xl/workbook.xml"); if (!wb) throw new Error("xlsx");
  const rels = (await get("xl/_rels/workbook.xml.rels")) || "", relMap = {};
  rels.replace(/<Relationship\b[^>]*>/g, tg => { relMap[attr(tg, "Id")] = attr(tg, "Target"); return ""; });
  const d1904 = /date1904="(1|true)"/.test(wb);
  const ss = [], sst = await get("xl/sharedStrings.xml"); if (sst) sst.replace(/<si>([\s\S]*?)<\/si>/g, (m, x) => { ss.push(txt(x)); return ""; });
  const fmts = {}, xf = [], sty = await get("xl/styles.xml");
  if (sty) { sty.replace(/<numFmt\b[^>]*>/g, tg => { fmts[+attr(tg, "numFmtId")] = attr(tg, "formatCode"); return ""; }); const cx = (sty.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || ""; cx.replace(/<xf\b[^>]*>/g, tg => { xf.push(+attr(tg, "numFmtId") || 0); return ""; }); }
  const dateStyle = i => { const id = xf[i]; if (id == null) return false; return DATE_IDS.has(id) || isDateFmt(fmts[id]); };
  const sheets = [];
  const list = []; wb.replace(/<sheet\b[^>]*>/g, tg => { list.push({ name: attr(tg, "name"), rid: attr(tg, "r:id") }); return ""; });
  for (const s of list) {
    let tg = relMap[s.rid] || ""; tg = tg.startsWith("/") ? tg.slice(1) : "xl/" + tg.replace(/^\.\//, "");
    const xml = await get(tg); if (!xml) { sheets.push({ name: s.name, rows: [] }); continue; }
    const cells = [], fx = []; let mr = -1, mc = -1;
    const sd = (xml.match(/<sheetData[^>]*>([\s\S]*)<\/sheetData>/) || [])[1] || "";
    sd.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (m, a, body) => {
      const ref = attr(" " + a, "r"); if (!ref) return ""; const [c, r] = X.colIdx(ref), ty = attr(" " + a, "t"), si = attr(" " + a, "s");
      let v = null; const vm = body && body.match(/<v>([\s\S]*?)<\/v>/), raw = vm ? X.unesc(vm[1]) : null;
      if (ty == "s") v = raw != null ? ss[+raw] ?? null : null;
      else if (ty == "inlineStr") v = body ? txt(body) : null;
      else if (ty == "str") v = raw;
      else if (ty == "b") v = raw != null ? raw == "1" : null;
      else if (ty == "e") v = null;
      else if (raw != null && raw !== "") { const n = +(+raw).toPrecision(15); v = isFinite(n) ? (si != null && dateStyle(+si) ? X.serialDate(n, d1904) : n) : raw; }
      if (v === "") v = null;
      const fm = body && body.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/);
      if (v == null && fm && ty != "s" && ty != "str") fx.push([r, c, X.unesc(fm[1])]);
      if (r > mr) mr = r; if (c > mc) mc = c;
      cells.push([r, c, v]); return "";
    });
    const dim = (xml.match(/<dimension\s+ref="([A-Z]+\d+)(?::([A-Z]+\d+))?"/) || []);
    if (dim[2]) { const [c2, r2] = X.colIdx(dim[2]); mr = Math.max(mr, r2); mc = Math.max(mc, c2); }
    const rows = mr < 0 ? [] : Array.from({ length: mr + 1 }, () => Array(mc + 1).fill(null));
    cells.forEach(([r, c, v]) => { rows[r][c] = v; });
    if (fx.length) X.calc(rows, fx);
    sheets.push({ name: s.name, rows });
  }
  return sheets;
};
/* basit CSV okuyucu (eski "satır başlıklı" yükleme için) */
X.csv = text => { const L = String(text).replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim()); if (!L.length) return []; const sep = (L[0].match(/;/g) || []).length > (L[0].match(/,/g) || []).length ? ";" : ","; const sp = l => { const r = []; let c = "", q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch == '"' && l[i + 1] == '"') { c += '"'; i++; } else if (ch == '"') q = false; else c += ch; } else if (ch == '"') q = true; else if (ch == sep) { r.push(c); c = ""; } else c += ch; } r.push(c); return r; }; return L.map(sp); };
/* önbellek değeri olmayan basit formülleri hesaplar (hücre başvurusu, + - * / ^, parantez, SUM/MIN/MAX/AVERAGE/ROUND) */
X.calc = (rows, fx) => {
  const F = {}; fx.forEach(([r, c, f]) => F[r + ":" + c] = f); const busy = {};
  const val = (r, c) => { const k = r + ":" + c; if (F[k] != null) { if (busy[k]) return null; busy[k] = 1; const v = ev(F[k]); delete F[k]; busy[k] = 0; if (rows[r]) rows[r][c] = v; return v; } const v = (rows[r] || [])[c]; return typeof v == "number" ? v : v == null ? 0 : v; };
  const ref = s => { const [c, r] = X.colIdx(s.replace(/\$/g, "")); return [r, c]; };
  function ev(f) {
    let i = 0, dt = 0; const s = f.replace(/\s+/g, "");
    /* tarih hücreleri Excel seri numarasına çevrilerek hesaplanır (ör. =D18+1 bir sonraki gün) */
    const isD = x => Object.prototype.toString.call(x) == "[object Date]";
    const num = x => typeof x == "number" ? x : x == null ? 0 : isD(x) ? (dt++, x.getTime() / 864e5 + 25569) : isFinite(+x) ? +x : NaN;
    const range = (a, b) => { const [r1, c1] = ref(a), [r2, c2] = ref(b), L = []; for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) { const v = val(r, c); if (typeof v == "number") L.push(v); } return L; };
    const args = () => { const L = []; if (s[i] == ")") { i++; return L; } for (;;) { const m = s.slice(i).match(/^(\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?\d+)/); if (m) { i += m[0].length; L.push(...range(m[1], m[2])); } else L.push(num(expr())); if (s[i] == ",") { i++; continue; } if (s[i] == ")") { i++; return L; } throw 0; } };
    const prim = () => {
      if (s[i] == "(") { i++; const v = expr(); if (s[i++] != ")") throw 0; return v; }
      if (s[i] == "-") { i++; return -num(prim()); } if (s[i] == "+") { i++; return num(prim()); }
      let m = s.slice(i).match(/^(SUM|MIN|MAX|AVERAGE|ROUND)\(/i); if (m) { i += m[0].length; const L = args(), n = m[1].toUpperCase(); return n == "SUM" ? L.reduce((a, b) => a + b, 0) : n == "MIN" ? Math.min(...L) : n == "MAX" ? Math.max(...L) : n == "AVERAGE" ? L.reduce((a, b) => a + b, 0) / (L.length || 1) : Math.round(L[0] * 10 ** (L[1] || 0)) / 10 ** (L[1] || 0); }
      m = s.slice(i).match(/^\$?[A-Z]+\$?\d+/); if (m) { i += m[0].length; const [r, c] = ref(m[0]); return val(r, c); }
      m = s.slice(i).match(/^\d+(\.\d+)?(E[+-]?\d+)?/i); if (m) { i += m[0].length; return +m[0]; } throw 0;
    };
    const pow = () => { let a = prim(); while (s[i] == "^") { i++; a = num(a) ** num(prim()); } return a; };
    const term = () => { let a = pow(); while (s[i] == "*" || s[i] == "/") { const o = s[i++], b = num(pow()); a = o == "*" ? num(a) * b : num(a) / b; } return a; };
    function expr() { let a = term(); while (s[i] == "+" || s[i] == "-") { const o = s[i++], b = num(term()); a = o == "+" ? num(a) + b : num(a) - b; } return a; }
    try { const v = expr(); if (i < s.length) return null; if (isD(v)) return v; if (dt == 1 && typeof v == "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)); return typeof v == "number" && isFinite(v) ? +v.toPrecision(15) : null; } catch (e) { return null; }
  }
  fx.forEach(([r, c]) => { if (F[r + ":" + c] != null) val(r, c); });
};
