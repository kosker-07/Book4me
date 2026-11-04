/* PDF fiyat listesi: metin konumlarından tablo satırları kurar, Excel ayrıştırıcısına verir.
   PDF metni pdf.js ile çıkarılır (açık kaynak, tarayıcıda çalışır); tablo kurma kuralları bizimdir. */
const PX = B4M.pdfx = {};
/* v40'ta çalıştığı doğrulanan sürüm (klasik betik, window.pdfjsLib). Test ortamı B4M.env.pdfjs ile kendi kütüphanesini verebilir. */
PX.URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
PX.WURL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
PX.load = () => { if (PX.lib) return Promise.resolve(PX.lib); if (B4M.env.pdfjs) return Promise.resolve(PX.lib = B4M.env.pdfjs);
  if (globalThis.pdfjsLib) { globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = PX.WURL; return Promise.resolve(PX.lib = globalThis.pdfjsLib); }
  return new Promise((okk, bad) => { const s = document.createElement("script"); s.src = PX.URL; s.onload = () => { if (!globalThis.pdfjsLib) return bad(new Error("load")); globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = PX.WURL; okk(PX.lib = globalThis.pdfjsLib); }; s.onerror = () => bad(new Error("load")); document.head.appendChild(s); }); };
PX.pages = async buf => {
  const lib = await PX.load(), doc = await lib.getDocument({ data: buf }).promise, P = [];
  for (let i = 1; i <= doc.numPages; i++) { const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent(); P.push({ items: PX.items(tc.items, vp.height) }); }
  return P;
};
PX.items = (L, H) => L.filter(x => x.str && x.str.trim()).map(x => { const fh = Math.hypot(x.transform[2], x.transform[3]) || x.height || 8; return { s: x.str, x: x.transform[4], w: x.width || fh * x.str.length * .5, y: H - x.transform[5], h: fh }; });
const pYY = y => y.length == 2 ? "20" + y : y, pIso = (y, m, d) => `${pYY(y)}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function pTok(s) {
  s = s.trim(); let m; if ((m = s.match(/^(\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4})\s*[-–]?\s*(\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4})$/)) && !/^\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}$/.test(s)) s = m[1] + "-" + m[2];
  if ((m = s.match(/^(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?\s*[-–]\s*(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/))) { const y2 = m[6], y1 = m[3] || y2; return { t: "r", a: pIso(y1, m[2], m[1]), b: pIso(y2, m[5], m[4]) }; }
  if ((m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/))) return { t: "d", v: pIso(m[3], m[2], m[1]) };
  if ((m = s.match(/^%\s*(\d+(?:[.,]\d+)?)$|^(\d+(?:[.,]\d+)?)\s*%$/))) return { t: "n", v: +(m[1] || m[2]).replace(",", ".") / 100 };
  const c = s.replace(/^(€|\$|£|EUR|USD|TL|TRY)\s*|\s*(€|\$|£|EUR|USD|TL|TRY)$/gi, "");
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(c)) return { t: "n", v: +c.replace(/\./g, "").replace(",", ".") };
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(c)) return { t: "n", v: +c.replace(/,/g, "") };
  if (/^-?\d+([.,]\d+)?$/.test(c)) return { t: "n", v: +c.replace(",", ".") };
  return { t: "s", v: s };
}
PX.pTok = pTok;
/* sayfa → satırlar → hücreler */
function pdfLines(pg, yo) {
  const it = pg.items.slice().sort((a, b) => a.y - b.y || a.x - b.x), L = [];
  it.forEach(tt => { const l = L[L.length - 1]; if (l && Math.abs(tt.y - l.y) <= Math.max(1.5, .45 * Math.min(tt.h, l.h))) l.it.push(tt); else L.push({ y: tt.y, h: tt.h, it: [tt] }); });
  return L.map(l => {
    const a = l.it.sort((p, q) => p.x - q.x), C = [];
    a.forEach(tt => { const c = C[C.length - 1], gap = c ? tt.x - c.x1 : 99, isD = x => /^\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}$/.test(x.trim()); if (c && isD(c.s) && isD(tt.s) && tt.x < c.x1 - .4 * tt.w) { c.s = c.s.trim() + "-" + tt.s.trim(); c.x1 = Math.max(c.x1, tt.x + tt.w); return; } if (c && gap <= 1.3 * Math.max(tt.h, c.h) && !(pTok(c.s).t != "s" && pTok(tt.s).t != "s")) c.s += (gap > .15 * tt.h ? " " : "") + tt.s, c.x1 = Math.max(c.x1, tt.x + tt.w); else C.push({ s: tt.s, x0: tt.x, x1: tt.x + tt.w, h: tt.h }); });
    const C2 = []; C.forEach(c => { const seg = c.s.trim().split(/\s{3,}/); if (seg.length < 2) return C2.push({ ...c, s: c.s.trim().replace(/\s{2}/g, " ") }); const cw = (c.x1 - c.x0) / Math.max(1, c.s.length); let pos = 0; seg.forEach(tt => { const i = c.s.indexOf(tt, pos); C2.push({ s: tt.replace(/\s{2}/g, " "), x0: c.x0 + i * cw, x1: c.x0 + (i + tt.length) * cw, h: c.h, est: 1 }); pos = i + tt.length; }); }); C.length = 0; C.push(...C2);
    const out = []; C.forEach(c => {
      const p = c.s.trim().split(/\s+/), num = x => pTok(x).t != "s"; let k = p.length; while (k > 0 && num(p[k - 1])) k--;
      if (p.length > 1 && p.length - k >= 2) {
        const cw = (c.x1 - c.x0) / Math.max(1, c.s.length), est = !!k || p.length > 1; let pos = 0;
        if (k) { const lab = c.s.trim().split(/\s{2,}/); const head = p.slice(0, k).join(" "); const L2 = lab.filter(x => !x.split(/\s+/).every(num)); const txt = L2.length > 1 ? L2 : [head]; txt.forEach(tt => { const i = c.s.indexOf(tt.split(/\s+/)[0], pos); out.push({ s: tt, x0: c.x0 + Math.max(0, i) * cw, x1: c.x0 + (Math.max(0, i) + tt.length) * cw, h: c.h }); pos = Math.max(pos, i + tt.length); }); }
        p.slice(k).forEach(x => { const i = c.s.indexOf(x, pos); out.push({ s: x, x0: c.x0 + i * cw, x1: c.x0 + (i + x.length) * cw, h: c.h, est }); pos = i + x.length; });
      } else out.push({ ...c, s: c.s.trim() });
    });
    out.forEach(c => c.k = pTok(c.s)); return { y: l.y + yo, cells: out };
  });
}
const P_META = /^(hotel ?name|otel ?ad[ıi]|add?ress?|adres|season|sezon|valid(?: between)?|ge[cç]erlilik|market|pazar|accomm?\.?(?:odation)? ?basis|pansiyon)\s*:?\s*(.+)$/i;
function pShift(NC, CT) { if (NC.length >= CT.length) return 0; if (NC._s != null) return NC._s; const Pp = NC.map(c => (c.x0 + c.x1) / 2); let bs = 0, bv = 1e9; for (let sh = 0; sh <= CT.length - NC.length; sh++) { const v = Pp.reduce((a, p, i) => a + Math.abs(p - CT[i + sh]), 0); if (v < bv) { bv = v; bs = sh; } } return NC._s = bs; }
function pdfGrid(lines, stat) {
  const sp = []; lines.forEach(L => { const n = L.cells.filter(c => c.k.t != "s"); if (n.length >= 2) n.forEach(c => { if (c.est) { const m = (c.x0 + c.x1) / 2, w = (c.x1 - c.x0) * .3; sp.push([m - w, m + w]); } else sp.push([c.x0, c.x1]); }); });
  sp.sort((a, b) => a[0] - b[0]); const B = []; sp.forEach(([a, b]) => { const l = B[B.length - 1]; if (l && a < l[1] - .5) l[1] = Math.max(l[1], b); else B.push([a, b]); });
  const estM = lines.some(L => L.cells.some(c => c.est)); let CT = null; if (estM) { let K = 0, best = null; lines.forEach(L => { const n = L.cells.filter(c => c.k.t != "s"); if (n.length > K) { K = n.length; best = n; } }); CT = best ? best.map(c => (c.x0 + c.x1) / 2) : null; }
  const rows = []; lines.forEach(L => {
    const NC = L.cells.filter(c => c.k.t != "s"); const r = [], r2 = []; let hasR = false, tx = 0; const nb = NC.length >= 2;
    if (!nb && L.cells.length <= 4 && (L.cells.length < 3 || P_META.test(L.cells[0].s + " x"))) { const c0 = L.cells[0].s, m = L.cells.length == 1 && c0.match(P_META); rows.push(m ? [m[1], m[2]] : [c0, L.cells.slice(1).map(c => c.s).join(" ") || null]); return; }
    let used = new Set();
    L.cells.forEach(c => {
      let bi = B.length && c.x0 >= B[0][0] - 2 ? B.findIndex(([a, b]) => c.x1 > a + .3 && c.x0 < b - .3) : -1; if (CT && c.k.t != "s" && (c.est || NC.some(q => q.est))) bi = NC.indexOf(c) + pShift(NC, CT); else if (CT && c.est) bi = -1;
      if (bi >= 0 && (nb || c.k.t == "s")) { if (c.k.t != "s") { if (used.has(bi)) stat.col++; used.add(bi); } const j = 3 + bi; if (c.k.t == "r") { r[j] = c.k.a; r2[j] = c.k.b; hasR = true; } else if (r[j] == null) r[j] = c.k.v; else if (typeof r[j] == "string") r[j] += " " + c.s; return; }
      if (!tx) { const m = !nb && L.cells.length == 1 && c.s.match(P_META); if (m) { r[0] = m[1]; r[1] = m[2]; } else r[0] = c.s; } else if (!nb && r[1] == null) r[1] = c.s; else if (r[2] == null && /^[A-ZÇĞİÖŞÜ]{2,8}$/.test(c.s)) r[2] = c.s; else if (r[0] != null) r[0] += " " + c.s; else if (r[2] == null) r[2] = c.s; else r[2] += " " + c.s; tx++;
    });
    if (nb) stat.rows.push({ n: NC.length, est: NC.some(q => q.est) });
    for (let j = 0; j < r.length; j++) if (r[j] === undefined) r[j] = null; rows.push(r); if (hasR) { for (let j = 0; j < r2.length; j++) if (r2[j] === undefined) r2[j] = null; rows.push(r2); }
  });
  return rows;
}
/* kayan sütun tespiti: fiyat satırlarının çoğunluğu aynı sütun sayısındayken, tahmini konumla eşlenen satırlarda sayı farklıysa belge güvenilir değildir */
function shiftCount(stat) {
  const R = stat.rows.filter(x => x.n >= 2); if (R.length < 4) return stat.col;
  const cnt = {}; R.forEach(x => cnt[x.n] = (cnt[x.n] || 0) + 1); const mode = +Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
  return stat.col + R.filter(x => x.est && x.n != mode && x.n < mode).length;
}
PX.sheets = (pages, fname) => {
  const G = []; pages.forEach((pg, pi) => { const ls = pdfLines(pg, pi * 1e4), hn = ls.some(l => /HOTEL ?NAME|OTEL ?ADI/.test(B4M.xp.xU(l.cells.map(c => c.s).join(" ")))); if (hn || !G.length) G.push({ ls: [], p: [] }); const g = G[G.length - 1]; g.ls.push(...ls); g.p.push(pi + 1); });
  return G.map((g, i) => {
    const stat = { col: 0, rows: [] }, rows = pdfGrid(g.ls, stat), nr = rows.find(r => /^HOTEL ?NAME|^OTEL ?ADI/.test(B4M.xp.xU(r[0]))); const nm = nr && nr[1] ? String(nr[1]) : fname.replace(/\.pdf$/i, "") + (G.length > 1 ? " " + (i + 1) : "");
    const sh = shiftCount(stat), o = { name: nm.slice(0, 60), rows, pdf: `${fname} · ${t("sayfa")} ${g.p[0]}${g.p.length > 1 ? "–" + g.p[g.p.length - 1] : ""}` };
    if (sh >= 3) o.shift = sh; return o;
  });
};
