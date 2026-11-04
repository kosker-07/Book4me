/* u006 · Yeni Excel fiyat listesi biçimi (Crystal tipi): oda adı fiyatsız bir başlık satırında, fiyatlar altındaki kombinasyon satırlarında.
   Biçim sayfa sayfa tanınır; diğer sayfalar eski kurallarla okunur (eski biçimler, PDF ve fotoğraf aynen çalışır).
   Ayrıca: "EB İndirimleri" sayfası erken rezervasyon SPO'su olur, "Ülke-Pazar Tanımları" ve "ECO Rooms" otel notu olur,
   ve tüm biçimlerde şüpheli düşük fiyat uyarısı verilir (aynı kombinasyonun diğer periyotlarına göre). Arayüz dışıdır. */
const XP = B4M.xp, PD = B4M.prod, xU = XP.xU, isD = XP.xIsD;
const num = v => typeof v == "number" && isFinite(v) ? v : typeof v == "string" && /^\s*-?\d+([.,]\d+)?\s*$/.test(v) ? +v.replace(",", ".") : null;
const ROOMRE = /ROOM|SUITE|FAMILY|VILLA|STUDIO|DELUXE|SUPERIOR|JUNIOR|BUNGALOW|APART|CORNER|\bODA\b|\bAILE\b/, NOTRE = /PRIVILEGE|CONDITION|IMZA|SIGNATURE|NOTE/;
const dateRow = R => R.findIndex((r, i) => (r || []).filter(isD).length >= 3 && (R[i + 1] || []).filter(isD).length >= 3);
const str = v => v == null || typeof v == "number" ? "" : String(v).trim();
/* sayfa bu biçimde mi: tarih satırlarından sonra fiyatsız oda başlığı ve hemen altında kontenjan ya da kombinasyon satırı */
XP.isHdrLayout = s => { const R = s.rows || [], fr = dateRow(R); if (fr < 0) return false; const cols = (R[fr] || []).map((v, j) => isD(v) ? j : -1).filter(j => j >= 0);
  for (let i = fr + 2; i < R.length; i++) { const a = xU(str((R[i] || [])[0])); if (!a || NOTRE.test(a) || !ROOMRE.test(a)) continue; if (cols.some(j => num((R[i] || [])[j]) != null)) continue;
    const nx = R.slice(i + 1, i + 4).find(r => str((r || [])[0])); const b = xU(str((nx || [])[0])); if (/^ALLOT/.test(b) || (XP.occP(b).length && cols.some(j => num((nx || [])[j]) != null))) return true; }
  return false; };
XP.xHotel2 = (name, R) => {
  const fr = dateRow(R), cols = (R[fr] || []).map((v, j) => isD(v) ? j : -1).filter(j => j >= 0), hdr = xU(str((R[fr - 1] || [])[0]) || str((R[fr - 2] || [])[0]));
  const title = str((R[0] || [])[0]).split(/\r?\n/).map(x => x.trim()).filter(Boolean), sub = str((R[1] || [])[0]);
  const loc = title.length > 1 ? title[title.length - 1] : "", parts = loc.split("/").map(x => x.trim()).filter(Boolean);
  const h = { sheet: name, name: XP.xTitle((title.length > 1 ? title.slice(0, -1) : title).join(" ") || name), meta: { addr: loc, season: sub }, periods: [], rooms: [], chain: {}, notes: [], cur: "EUR", board: "", code: "", stars: 0, fmt: "hdr" };
  h.cur = ["EUR", "USD", "GBP", "TRY", "CHF"].find(c => hdr.includes(c) || (c == "EUR" && /EURO|€/.test(hdr))) || "EUR";
  h.board = /ULTIMATE|ULTRA/.test(hdr) ? "Ultra her şey dahil" : /ALL ?INC/.test(hdr) ? "Her şey dahil" : /HALF|\bHB\b/.test(hdr) ? "Yarım pansiyon" : /FULL|\bFB\b/.test(hdr) ? "Tam pansiyon" : /BED|\bBB\b/.test(hdr) ? "Oda kahvaltı" : "Her şey dahil";
  h.code = /ULTIMATE|ULTRA/.test(hdr) ? "UAI" : "AI";
  const z = parts.length ? parts[parts.length - 1] : "", f = z ? PD.locFind(z).filter(x => x.c == "TR") : []; h.zone = f.length && f[0].z ? f[0].z : z ? XP.xTitle(z.replace(/İ/g, "I").replace(/ı/g, "i")) : ""; h.city = f.length ? f[0].il : "";
  const yr = (sub.match(/20\d\d/) || [""])[0]; h.season = /WINTER|KIŞ|KIS/i.test(sub) ? "Winter " + yr : "Summer " + yr; h.meta.market = sub;
  const nm = cols.map(j => { const v = str((R[fr - 1] || [])[j]); return v && v.length <= 12 ? v : ""; });
  h.periods = cols.map((j, k) => ({ name: nm[k] || "P" + (k + 1), from: XP.xD(R[fr][j]), to: XP.xD((R[fr + 1] || [])[j]), rel: null, min: null }));
  if (h.periods.length) { h.from = h.periods.map(p => p.from).sort()[0]; h.to = h.periods.map(p => p.to).filter(Boolean).sort().pop(); }
  const days = h.periods.map(p => p.from && p.to ? Math.round((Date.parse(p.to) - Date.parse(p.from)) / 864e5) + 1 : null);
  let room = null;
  for (let i = fr + 2; i < R.length; i++) { const r = R[i] || [], a = str(r[0]), k = xU(a), v = cols.map(j => { const n = num(r[j]); return n == null ? null : XP.xR2(n); }), nn = v.filter(x => x != null).length;
    if (!a && nn) { if (v.every((x, q) => x == null || x == days[q])) continue; continue; }
    if (/^RELEASE/.test(k)) { v.forEach((x, p) => h.periods[p].rel = x); continue; }
    if (/^MIN\.?\s*STAY|^MINIMUM/.test(k)) { v.forEach((x, p) => h.periods[p].min = x); continue; }
    if (!nn && ROOMRE.test(k) && !NOTRE.test(k)) { const m = a.match(/^([^(]+)(\((.*)\))?/); room = { type: XP.xTitle(m[1].trim()), code: h.code, base: v, occ: [], info: (a.slice(m[1].length) || "").trim() }; h.rooms.push(room); continue; }
    if (/^ALLOT/.test(k)) { if (room) room.allotTxt = cols.map(j => str(r[j])).concat(str(r[1])).filter(Boolean)[0] || ""; continue; }
    if (/PER PERSON/.test(k)) continue;
    if (!nn) { if (a && a.length > 2 && !/^(IMZA|SIGNATURE|KASE)/.test(k)) h.notes.push(a); continue; }
    const o = XP.occP(a); if (room && o.length) { room.occ.push({ lbl: a, alts: o.map(x => ({ ad: x.ad, ch: x.ch })), guess: o.some(x => x.guess), v }); continue; }
    if (room && !NOTRE.test(k) && !/AVR|AVERAGE|OTHER/.test(k)) { room.occ.push({ lbl: a, alts: [], v }); continue; }
    if (a) h.notes.push(a + " " + cols.map(j => str(r[j])).filter(Boolean).join(" "));
  }
  h.rooms = h.rooms.filter(r => r.occ.length || r.allotTxt);
  h.rooms.forEach(r => { if (r.allotTxt) h.notes.push(`${r.type}: ${t("kontenjan")} ${r.allotTxt}`); });
  return XP.xVal(h); };
/* erken rezervasyon tablosu → SPO */
XP.isEB = s => /EB|EARLY/.test(xU(s.name)) && (s.rows || []).some(r => /EARLY ?BOOKING/.test(xU((r || [])[0])));
XP.xEB = R => { const L = []; let cur = null, hi = R.findIndex(r => (r || []).some(v => /ACCOMMODATION|KONAKLAMA/.test(xU(v)))); if (hi < 0) return L; const H = (R[hi] || []).map(v => xU(v));
  const acc = H.findIndex(v => /ACCOMMODATION|KONAKLAMA/.test(v)), pc = H.findIndex((v, j) => j > acc && /DISCOUNT|INDIRIM/.test(v)), sale = H.findIndex(v => /BOOKING|SALE|SATIS/.test(v)), payD = H.findIndex(v => /PAYMENT DATE|ODEME TARIHI/.test(v)), pay = H.findIndex((v, j) => j != payD && /^PAYMENT$|^ODEME$/.test(v));
  const dv = v => isD(v) ? XP.xD(v) : "";
  R.slice(hi + 1).forEach(r => { r = r || []; const a = xU(str(r[0])); if (/^EARLY ?BOOKING/.test(a)) { cur = { name: XP.xTitle(str(r[0])), bf: dv(r[sale]), bt: dv(r[sale + 1]), payD: payD >= 0 ? dv(r[payD]) : "", pay: pay >= 0 && typeof r[pay] == "number" ? r[pay] : null, rows: [] }; L.push(cur); }
    if (!cur) return; const pct = num(r[pc]); if (!(pct > 0 && pct < 1)) return; const f = r[acc], to = r[acc + 1];
    if ((isD(f) || /ACILIS|OPEN/.test(xU(f))) && (isD(to) || /KAPANIS|CLOS/.test(xU(to)))) cur.rows.push({ sf: dv(f), st: dv(to), pct: Math.round(pct * 1000) / 10 }); });
  return L.filter(e => e.rows.length && e.bt); };
XP.isMarket = s => /PAZAR|MARKET/.test(xU(s.name)) && !(s.rows || []).some(r => (r || []).filter(isD).length >= 3);
XP.isEco = s => /ECO/.test(xU(s.name)) && !(s.rows || []).some(r => (r || []).filter(isD).length >= 3);
const baseBook = XP.xBook;
XP.xBook = sheets => {
  const eb = sheets.find(XP.isEB), mk = sheets.find(XP.isMarket), eco = sheets.find(XP.isEco), spec = new Set([eb, mk, eco].filter(Boolean));
  const rest = sheets.filter(s => !spec.has(s)), hdr = rest.filter(s => XP.isHdrLayout(s)), B = baseBook(rest.filter(s => !hdr.includes(s)));
  const order = new Map(sheets.map((s, i) => [s.name, i]));
  hdr.forEach(s => { const h = XP.xHotel2(s.name, s.rows); if (s.pdf) h.pdf = s.pdf; B.hotels.push(h); });
  B.hotels.sort((a, b) => (order.get(a.sheet) ?? 0) - (order.get(b.sheet) ?? 0));
  B.extra = [];
  if (eb) { const E = XP.xEB(eb.rows); if (E.length) { B.hotels.forEach(h => { h.eb = E; }); B.extra.push(["{s}: {n} erken rezervasyon dönemi okundu; kaydederken otellere SPO olarak eklenir.", { s: eb.name, n: E.length }]); } else B.skipped.push(eb.name); }
  if (mk) { const W = []; (mk.rows || []).slice(1).forEach(r => (r || []).forEach(v => { const x = str(v); if (x && x.length > 1) W.push(x); })); const txt = U.uniq(W).join(", "); if (txt) { B.hotels.forEach(h => h.notes.push(`${t("Pazar tanımı")} (${mk.name}): ${txt.slice(0, 600)}`)); B.extra.push(["{s}: pazar ve ülke tanımı otellere not olarak eklendi.", { s: mk.name }]); } }
  if (eco) { const R = (eco.rows || []).slice(1).filter(r => str((r || [])[0])), W = h => xU(h).replace(/[^A-Z0-9 ]/g, " ").split(" ").filter(w => w.length > 2), cnt = {}; B.hotels.forEach(h => U.uniq(W(h.name)).forEach(w => cnt[w] = (cnt[w] || 0) + 1));
    R.filter(r => !/^\*/.test(str(r[0]))).forEach(r => { const ws = W(str(r[0])).filter(w => (cnt[w] || 0) <= 1 && !/^(CRYSTAL|COLLECTION|HOTEL|RESORT)$/.test(w)); const h = B.hotels.find(x => { const hn = xU(x.name).replace(/[^A-Z0-9]/g, ""); return ws.some(w => hn.includes(w)); }); const txt = (r || []).slice(1).map(str).filter(Boolean).join(" · "); if (h && txt) h.notes.push(`${t("Ekonomi oda")}: ${txt}`); });
    const foot = R.filter(r => /^\*/.test(str(r[0]))).map(r => r.map(str).filter(Boolean).join(" ")).join(" "); if (foot) B.hotels.forEach(h => { if (h.notes.some(n => n.startsWith(t("Ekonomi oda")))) h.notes.push(foot); }); B.extra.push(["{s}: ekonomi oda bilgisi ilgili otellere not olarak eklendi.", { s: eco.name }]); }
  return B; };
/* tüm biçimlerde: şüpheli düşük fiyat (aynı kombinasyonun periyot ortancasının %35'inden az) */
const baseVal = XP.xVal;
XP.xVal = h => { baseVal(h); const add = [];
  (h.rooms || []).forEach((r, ri) => (r.occ || []).forEach((c, ci) => { if (!c.alts.length) return; const L = c.v.filter(x => x > 0).slice().sort((a, b) => a - b); if (L.length < 3) return; const med = L[L.length >> 1];
    c.v.forEach((x, k) => { if (x > 0 && x < med * 0.35) { h.bad[ri + ":" + ci + ":" + k] = 1; add.push(["w", "{r}: “{l}” {p} periyodunda fiyat şüpheli derecede düşük ({v}; diğer periyotlar ~{m}). Kaydetmeden önce kontrol edin.", { r: r.type, l: c.lbl, p: (h.periods[k] || {}).name || k + 1, v: x, m: med }]); } }); }));
  if (add.length) { h.W.push(...add); if (h.st == "ok") h.st = "w"; } return h; };
/* yükleme oturumu: ek sayfa mesajları; kayıtta notlar ve erken rezervasyon SPO'ları */
const IX = B4M.imp, db = () => B4M.db, AU = B4M.auth;
const baseLoad = IX.load; IX.load = (S, sheets, src) => { const r = baseLoad(S, sheets, src); const B = XP.xBook.last; S.extra = B ? B.extra || [] : []; return r; };
const bk2 = XP.xBook; XP.xBook = sheets => { const B = bk2(sheets); XP.xBook.last = B; return B; };
const baseSave = IX.save; IX.save = (S, dmc) => { const pick = Object.keys(S.sel).map(Number).map(i => S.hotels[i]).filter(h => h && h.st != "e"), r = baseSave(S, dmc); if (!r || !r.ok) return r;
  const u = B4M.app.user(), canSpo = u.role == "admin" || AU.can("spo"); let spo = 0, skip = 0;
  pick.forEach(h => { const x = IX.ex(h, dmc); if (!x) return; if (h.notes && h.notes.length) x.notes = U.uniq([...(x.notes || []), ...h.notes]).slice(-60);
    if (!(h.eb || []).length) return; if (!canSpo) { skip++; return; } x.spo = (x.spo || []).filter(o => !(o.src == "import" && o.season == h.season));
    h.eb.filter(e => !e.bt || e.bt >= U.today()).forEach(e => e.rows.forEach(row => { const sf = row.sf || h.from, st = row.st || h.to; if (!sf || !st || st < sf || !(row.pct > 0)) return;
      x.spo.push({ id: db().seq(), name: `${e.name}${e.pay ? ` · %${Math.round(e.pay * 100)} ${t("ön ödeme")} ${e.payD ? I.fd(e.payD) : ""}` : ""}`.trim(), type: "Erken rezervasyon", pct: row.pct, minN: 1, sf, st, bf: e.bf || U.today(), bt: e.bt, rooms: [], on: true, src: "import", season: h.season }); spo++; })); });
  if (spo) B4M.events.emit("spo.added", "import", spo, "", dmc); if (spo || skip) db().commit();
  if (S.done) { S.done.spo = spo; if (skip) S.done.sk.push(["Erken rezervasyon indirimleri SPO yetkiniz olmadığı için eklenmedi ({n} otel).", { n: skip }]); }
  return spo ? { ...r, msg: "{n} otel kaydedildi; {s} erken rezervasyon SPO'su eklendi.", p: { ...(r.p || {}), s: spo } } : r; };
