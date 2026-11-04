/* Excel fiyat listesi ayrıştırıcı (otel sayfaları, INDEX, TRANSFER). Kendi kurallarımızla çalışır.
   Uyarılar [düzey, metin, parametreler] biçimindedir; ekranda seçilen dilde gösterilir. */
const XP = B4M.xp = {};
const xU = XP.xU = s => String(s == null ? "" : s).toUpperCase().replace(/İ/g, "I").replace(/Ç/g, "C").replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/\s+/g, " ").trim();
const xIsD = XP.xIsD = v => v instanceof Date || (typeof v == "string" && /^\d{4}-\d{2}-\d{2}/.test(v));
const xD = XP.xD = v => { if (v instanceof Date) { const tt = new Date(v.getTime() + 432e5); return `${tt.getFullYear()}-${String(tt.getMonth() + 1).padStart(2, "0")}-${String(tt.getDate()).padStart(2, "0")}`; } return typeof v == "string" ? v.slice(0, 10) : ""; };
const xN = v => typeof v == "number" && isFinite(v) ? v : typeof v == "string" && /^\s*-?\d+([.,]\d+)?\s*$/.test(v) ? +v.replace(",", ".") : null;
const xR2 = XP.xR2 = v => v == null ? null : Math.round(v * 100) / 100;
const xTitle = XP.xTitle = s => String(s || "").trim().toLowerCase().replace(/(^|[\s\/\-&(.])([a-zçğıöşü])/g, (m, a, b) => a + b.toUpperCase());
function xDmy(s) { const m = String(s || "").match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/); if (!m) return ""; const y = m[3].length == 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
/* kombinasyon etiketi → yetişkin sayısı + çocuk yaş aralıkları */
const occP = XP.occP = raw => { const s = xU(raw); if (!s) return []; const parts = []; let d = 0, c = ""; for (const ch of s) { if (ch == "(") d++; if (ch == ")") d = Math.max(0, d - 1); if (ch == "/" && !d) { parts.push(c); c = ""; } else c += ch; } parts.push(c); if (parts.length > 1) { const R = parts.map(occ1); if (R.every(x => x.length)) return R.flat(); } return occ1(s); };
function occ1(s) {
  const rg = []; s.replace(/(\d{1,2})\s*[-–]\s*(\d{1,2})(?:\s*[,.]\s*(\d{1,2}))?/g, (m, a, b, c) => { rg.push([+a, +b + (c ? +("0." + c) : 0)]); return ""; });
  const tt = s.replace(/\(([^)]*)\)/g, " ").replace(/(\d{1,2})\s*[-–]\s*(\d{1,2})(?:\s*[,.]\s*\d{1,2})?/g, " ").replace(/\s+/g, " "); let ad = null, ch = 0, m;
  if ((m = tt.match(/^\s*(\d)\s*\+\s*(\d)\b/))) { ad = +m[1]; ch = +m[2]; if (/\bINF/.test(tt) && !rg.length) rg.push([0, 1.99]); }
  else {
    if ((m = tt.match(/(\d)\s*(PAX|ADULTS?|ADL|AD|YETISKIN|YET)\b/))) ad = +m[1]; else if (/\b(SNG|SGL|SINGLE)\b/.test(tt)) ad = 1; else if (/\b(DBL|DOUBLE|TWIN)\b/.test(tt)) ad = 2; else if (/\b(TRP|TRIPLE)\b/.test(tt)) ad = 3; else if (/\b(QUAD|QUADRUPLE|QUARTER|QDR|QDPL)\b/.test(tt)) ad = 4; else if (/\b(QUINT|QUINTUPLE)\b/.test(tt)) ad = 5;
    if (ad != null && /(EXT|EXTRA)\.?\s*BED|EXB/.test(tt)) ad++;
    if ((m = tt.match(/(\d)\s*(CHD|CHILD|CHILDREN|CH|COC|COCUK)\b/))) ch = +m[1]; else if (/\b(CHD|CH|COC)\b/.test(tt)) ch = Math.max(1, rg.length);
    if (/\bINF/.test(tt)) { ch++; rg.push([0, 1.99]); }
  }
  if (ad == null || ad < 1 || ad > 9) return []; if (!ch) return [{ ad, ch: [] }];
  if (!rg.length) return [{ ad, ch: Array(ch).fill([0, 11.99]), guess: 1 }];
  if (ch == 1 && rg.length > 1 && !/\bINF/.test(tt)) return rg.map(r => ({ ad, ch: [r] }));
  const R = []; for (let i = 0; i < ch; i++) R.push(rg[Math.min(i, rg.length - 1)]); return [{ ad, ch: R }];
}
XP.occTxt = a => { const g = {}; a.ch.forEach(r => { const k = `${r[0]}–${String(r[1]).replace(".", ",")}`; g[k] = (g[k] || 0) + 1; }); return B4M.i18n.tn(a.ad, "yetişkin") + (a.ch.length ? " + " + Object.entries(g).map(([k, c]) => `${B4M.i18n.tn(c, "çocuk")} (${k})`).join(" + ") : ""); };
/* INDEX sayfası: otel → bölge */
function xIndex(rows) { const M = []; const h = rows.findIndex(r => (r || []).filter(v => typeof v == "string" && v.trim()).length >= 3); if (h < 0) return M; rows[h].forEach((reg, j) => { if (typeof reg != "string" || !reg.trim()) return; for (let i = h + 1; i < rows.length; i++) { const v = (rows[i] || [])[j]; if (typeof v != "string" || !v.trim()) continue; if (/TRANSFER|PRICE|PLEASE|AVAILAB/i.test(v)) break; M.push({ n: xU(v), reg: xU(reg) }); } }); return M; }
function xRegion(M, name) { const n = xU(name), tk = n.split(" ").filter(w => w.length > 2); let best = null, bs = 0; for (const x of M) { if (x.n == n) return x.reg; let s = x.n.startsWith(n) || n.startsWith(x.n) ? .9 : 0; const xt = x.n.split(" ").filter(w => w.length > 2), c = tk.filter(w => xt.includes(w)).length; s = Math.max(s, c / Math.max(tk.length, xt.length, 1)); if (s > bs) { bs = s; best = x.reg; } } return bs >= .6 ? best : ""; }
/* TRANSFER sayfası: bireysel (araç başı) fiyatlar */
function xTransfer(rows) {
  const T = [], N = []; let sec = ""; rows.forEach(r => {
    r = r || []; const a = xU(r[0]); if (!a) return;
    if (!r[1] && !r[2]) { if (/TRANSFER|RATES/.test(a)) sec = a; else if (a.length > 4) N.push(String(r[0]).trim()); return; }
    const m = a.match(/^([A-Z]{3})\s*>>\s*(.+?)(?:\s*>>\s*[A-Z]{3})?$/); if (!m) return;
    const px = xU(r[1]).match(/(\d+)\s*-\s*(\d+)\s*PAX/), pr = String(r[2] || "").match(/(\d+(?:[.,]\d+)?)/), cu = (xU(r[2]).match(/EUR|USD|TRY|GBP/) || ["EUR"])[0];
    if (!px || !pr) { N.push(`${String(r[0]).trim()} · ${r[1] || ""} · ${r[2] || ""} (kişi başı grup fiyatı; araç bazlı modele aktarılmadı)`); return; }
    const ret = /RETURN|>>\s*[A-Z]{3}$/.test(sec + " " + a), price = +pr[1].replace(",", ".");
    T.push({ ap: m[1], zones: m[2].split(/&|,| VE /).map(z => z.trim()).filter(Boolean), pmin: +px[1], pmax: +px[2], price, cur: cu, ret, one: ret ? xR2(price / 2) : price, on: true, sec });
  }); return { T, N };
}
/* otel sayfası */
function xHotel(name, rows) {
  const g = (i, j) => (rows[i] || [])[j], L = i => String(g(i, 0) == null ? "" : g(i, 0)).trim(); const meta = {};
  for (let i = 0; i < Math.min(rows.length, 30); i++) { const k = xU(L(i)), v = g(i, 1); if (v == null || xIsD(v)) continue; const vs = String(v).trim(); if (/^HOTEL ?NAME/.test(k)) meta.name = vs; else if (/^ADD?RESS?/.test(k)) meta.addr = vs; else if (/^SEASON/.test(k)) meta.season = vs; else if (/^VALID/.test(k)) meta.valid = vs; else if (/^MARKET/.test(k)) meta.market = vs; else if (/^ACCOM/.test(k)) meta.acc = vs; }
  let fr = -1, tr = -1; for (let i = 0; i < rows.length - 1 && fr < 0; i++) { if (!(rows[i] || []).some(xIsD)) continue; for (let j = i + 1; j <= i + 2 && j < rows.length; j++) if ((rows[j] || []).some(xIsD)) { fr = i; tr = j; break; } }
  const h = { sheet: name, name: xTitle(meta.name || name), meta, periods: [], rooms: [], chain: {}, notes: [], cur: "EUR", board: "", code: "", stars: 0 };
  const mk = xU(meta.market), cu = ["EUR", "USD", "GBP", "TRY", "CHF", "AED", "JPY", "CAD", "AUD", "CNY", "SGD"].find(c => mk.includes(c)); if (cu) h.cur = cu;
  const ac = xU(meta.acc); h.code = (ac.match(/^[A-Z]+/) || [""])[0]; h.stars = +(ac.match(/(\d)\s*\*/) || [0, 0])[1];
  const ad = String(meta.addr || "").split("/").map(x => x.trim()).filter(Boolean); h.city = ad.length ? ad[ad.length - 1] : ""; h.zone = ad.length > 1 ? ad[0] : "";
  const yr = String(meta.season || "").match(/20\d\d/); h.season = meta.season ? xTitle(meta.season) : "Summer " + (yr ? yr[0] : ""); h.from = xDmy((meta.valid || "").split("-")[0]); h.to = xDmy((meta.valid || "").split("-").slice(1).join("-"));
  if (fr < 0) { h.board = xBoard(h.code); return XP.xVal(h); } const cols = []; (rows[fr] || []).forEach((v, j) => { if (xIsD(v)) cols.push(j); });
  const nm = cols.map(j => { const v = g(fr - 1, j); return v != null && !xIsD(v) && String(v).trim() && !/ROOM/i.test(String(v)) ? String(v).trim() : ""; });
  h.periods = cols.map((j, k) => ({ name: nm[k] || "P" + (k + 1), from: xD(g(fr, j)), to: xIsD(g(tr, j)) ? xD(g(tr, j)) : "", rel: null, min: null }));
  if (!h.from && h.periods.length) { h.from = h.periods.map(p => p.from).sort()[0]; h.to = h.periods.map(p => p.to).filter(Boolean).sort().pop(); }
  const bc = cols.includes(2) ? -1 : 2, vals = i => cols.map(j => { const n = xN(g(i, j)); return n == null ? null : xR2(n); }), str = v => v == null || typeof v == "number" || xIsD(v) ? "" : String(v).trim();
  let room = null; for (let i = tr + 1; i < rows.length; i++) {
    const a = str(g(i, 0)), c = bc < 0 ? "" : str(g(i, bc)), v = vals(i), nn = v.filter(x => x != null).length, k = xU(a || c);
    if (/^RELEASE/.test(k)) { v.forEach((x, p) => h.periods[p].rel = x); continue; }
    if (/^MIN\.?\s*STAY|^MINIMUM/.test(k)) { v.forEach((x, p) => h.periods[p].min = x); continue; }
    if (!nn) { if (a && a.length > 2 && !/^INDEX$|^\d+ ?INDEX$/i.test(a)) h.notes.push(a); continue; }
    if (/KONTRAT|CONTRACT/.test(k)) { h.chain.k = v; continue; } if (/^SPO/.test(k)) { h.chain.spo = v; continue; } if (/MARK ?UP/.test(k)) { h.chain.mu = v; continue; }
    if (!a && !c) { if (!room) { if (v.every(x => x == null || Math.abs(x) < 1)) h.chain.disc = v; else if (!h.chain.k) h.chain.k = v; } continue; }
    const o = occP(a), nx = occP(str(g(i + 1, 0)));
    if (c && /^[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ0-9 \/*.+-]{1,11}$/.test(c) && (!o.length || !room || /ROOM|FAMILY|SUITE|VILLA|STUDIO|DELUXE|STANDAR|SUPERIOR|JUNIOR|BUNGALOW|APART|CORNER|ODA|AILE/.test(xU(a)))) { if (!o.length || nx.length || !room) { room = { type: xTitle(a || c), code: xU(c), base: v, occ: [] }; h.rooms.push(room); continue; } }
    if (o.length && room) { room.occ.push({ lbl: a, alts: o.map(x => ({ ad: x.ad, ch: x.ch })), guess: o.some(x => x.guess), v }); continue; }
    if (!o.length && (nx.length || !room)) { room = { type: xTitle(a), code: h.code, base: v, occ: [] }; h.rooms.push(room); continue; }
    if (room) room.occ.push({ lbl: a, alts: [], v });
  }
  h.board = xBoard(h.code); XP.xVal(h); return h;
}
function xBoard(c) { c = xU(c); if (/UAI|UALL|ULTRA/.test(c)) return "Ultra her şey dahil"; if (/AI$|^AI|ALL|ALCIN|INCL/.test(c)) return "Her şey dahil"; if (/^HB|HALF/.test(c)) return "Yarım pansiyon"; if (/^FB|FULL/.test(c)) return "Tam pansiyon"; if (/^BB|^RO|BED/.test(c)) return "Oda kahvaltı"; return "Her şey dahil"; }
const xAdd = (d, n) => { const tt = new Date(d + "T12:00:00Z"); tt.setUTCDate(tt.getUTCDate() + n); return tt.toISOString().slice(0, 10); };
XP.xVal = h => {
  const W = [], bad = {}, Pp = h.periods, w = (l, m, p) => W.push([l, m, p || {}]);
  if (!Pp.length) w("e", "Periyot tarihleri bulunamadı.");
  Pp.forEach(p => { if (!p.from || !p.to) w("e", "{p}: başlangıç veya bitiş tarihi eksik.", { p: p.name }); else if (p.to < p.from) w("e", "{p}: bitiş tarihi başlangıçtan önce.", { p: p.name }); });
  const Sd = Pp.filter(p => p.from && p.to).slice().sort((a, b) => a.from.localeCompare(b.from));
  for (let i = 1; i < Sd.length; i++) { const a = Sd[i - 1], b = Sd[i]; if (b.from <= a.to) w("w", "{a} ({af} → {at}) ile {b} ({bf} → {bt}) çakışıyor.", { a: a.name, af: a.from, at: a.to, b: b.name, bf: b.from, bt: b.to }); else if (b.from != xAdd(a.to, 1)) w("w", "{f} → {t} arası hiçbir periyotta yok; bu tarihler satışa kapalı kalır.", { f: xAdd(a.to, 1), t: xAdd(b.from, -1) }); }
  if (!h.rooms.some(r => r.occ.some(c => c.alts.length))) w("e", "Oda tipi ve kombinasyon fiyatı bulunamadı.");
  h.rooms.forEach((r, ri) => {
    if (!r.occ.length) w("w", "{r}: kombinasyon satırı yok; bu oda kaydedilmez.", { r: r.type }); let miss = 0;
    r.occ.forEach((c, ci) => { if (!c.alts.length) w("w", "{r}: “{l}” satırı tanınmadı; düzeltmezseniz kaydedilmez.", { r: r.type, l: c.lbl }); else { if (c.guess) w("i", "{r}: “{l}” satırında çocuk yaşı yok, 0–11,99 varsayıldı.", { r: r.type, l: c.lbl }); c.v.forEach((v, k) => { if (!(v > 0)) { miss++; bad[ri + ":" + ci + ":" + k] = 1; } }); } });
    if (miss) w("w", "{r}: {n} hücrede fiyat yok; ilgili periyotta o kombinasyon satılmaz.", { r: r.type, n: miss });
    const adOnly = n => r.occ.find(c => c.alts.some(a => a.ad == n && !a.ch.length));
    r.occ.forEach((c, ci) => { const a = c.alts[0]; if (!a || !a.ch.length) return; const ref = adOnly(a.ad + a.ch.length); if (!ref) return; const ks = Pp.map((_, k) => k).filter(k => c.v[k] > 0 && ref.v[k] > 0 && c.v[k] > ref.v[k] + .01); if (ks.length) { ks.forEach(k => bad[ri + ":" + ci + ":" + k] = 1); w("w", "{r}: “{l}” fiyatı, {n} yetişkin fiyatından yüksek ({p}).", { r: r.type, l: c.lbl, n: a.ad + a.ch.length, p: ks.map(k => Pp[k].name).join(", ") }); } });
    const s1 = adOnly(1), d2 = adOnly(2); if (s1 && d2) { const ci = r.occ.indexOf(s1), ks = Pp.map((_, k) => k).filter(k => s1.v[k] > d2.v[k] + .01 && d2.v[k] > 0); if (ks.length) { ks.forEach(k => bad[ri + ":" + ci + ":" + k] = 1); w("w", "{r}: tek kişilik fiyat çift kişilikten yüksek ({p}).", { r: r.type, p: ks.map(k => Pp[k].name).join(", ") }); } }
  });
  if (Pp.length && !Pp.some(p => p.rel != null)) w("i", "Release günü bulunamadı; satış girişe kadar açık kalır.");
  if (h.shift) W.unshift(["e", "Sütunlar sayfa boyunca kayıyor ({n} satırda fiyat sayısı başlıktaki periyot sayısıyla uyuşmuyor); belge güvenilir okunamadı. Excel sürümünü yükleyin veya fiyatları elle kontrol edip düzeltin.", { n: h.shift }]);
  if (h.ocr) W.unshift(["w", "Taranmış belgeden (OCR) okundu{fx}{lo}. Kaydetmeden önce tüm tarih ve fiyatları belgeyle karşılaştırın.", { fx: h.ocr.fix ? "; " + t("{n} değer otomatik düzeltildi", { n: h.ocr.fix }) : "", lo: h.ocr.low ? "; " + t("{n} değer düşük güvenle okundu", { n: h.ocr.low }) : "" }]);
  h.W = W; h.bad = bad; h.st = W.some(x => x[0] == "e") ? "e" : W.some(x => x[0] == "w") ? "w" : "ok"; return h;
};
XP.xBook = sheets => {
  let M = [], tf = { T: [], N: [] }; const hotels = [], skipped = [];
  sheets.forEach(s => { const n = xU(s.name); if (n == "INDEX") M = xIndex(s.rows); else if (/TRANSFER/.test(n)) tf = xTransfer(s.rows); });
  sheets.forEach(s => {
    const n = xU(s.name); if (n == "INDEX" || /TRANSFER/.test(n)) return; const isH = s.rows.slice(0, 30).some(r => /HOTEL ?NAME/.test(xU((r || [])[0]))) || s.rows.some(r => (r || []).some(xIsD)); if (!isH) { skipped.push(s.name); return; }
    const h = xHotel(s.name, s.rows), reg = xRegion(M, h.meta.name || s.name); if (s.pdf) h.pdf = s.pdf; if (s.ocr) h.ocr = s.ocr; if (s.shift) h.shift = s.shift; if (s.ocr || s.shift) XP.xVal(h);
    h.region = reg; if (!h.zone && reg && !/-/.test(reg)) h.zone = /CITY|CENT/.test(reg) ? "Merkez" : xTitle(reg); hotels.push(h);
  });
  return { hotels, tf: tf.T, tfNotes: tf.N, skipped };
};
