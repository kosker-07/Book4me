/* Product: oteller, odalar, sezon kontratları ve periyot fiyatları, kombinasyon fiyatları, SPO, stop-sale, pazar (milliyet) kuralları,
   iptal şartları; transfer ve tur ürünleri; konum veritabanı. */
const PD = B4M.prod = {};
const db = () => B4M.db, { ok, no } = B4M.res, P = B4M.parties, PR = B4M.price;
PD.BEDS = ["Çift kişilik", "İki tek kişilik", "King", "Çift kişilik + tek", "Ranza", "Kanepe yatak"];
PD.VIEWS = ["", "Deniz", "Kısmi deniz", "Bahçe", "Havuz", "Kara", "Şehir", "Dağ", "Nil"];
PD.SPOT = ["Erken rezervasyon", "Son dakika", "Uzun konaklama", "Balayı", "İndirim"];
PD.CXO = [[-1, "İade edilemez"], [0, "Hizmet gününe kadar"], [1, "1 gün önce"], [2, "2 gün önce"], [3, "3 gün önce"], [5, "5 gün önce"], [7, "7 gün önce"], [14, "14 gün önce"], [21, "21 gün önce"], [30, "30 gün önce"]];
PD.NAT = [["TR", "Türkiye"], ["DE", "Almanya"], ["GB", "Birleşik Krallık"], ["NL", "Hollanda"], ["FR", "Fransa"], ["BE", "Belçika"], ["AT", "Avusturya"], ["CH", "İsviçre"], ["IT", "İtalya"], ["ES", "İspanya"], ["PL", "Polonya"], ["RU", "Rusya"], ["UA", "Ukrayna"], ["KZ", "Kazakistan"], ["AZ", "Azerbaycan"], ["IR", "İran"], ["SA", "Suudi Arabistan"], ["AE", "BAE"], ["IL", "İsrail"], ["US", "ABD"], ["CN", "Çin"], ["XX", "Diğer"]];
PD.natN = c => (PD.NAT.find(x => x[0] == c) || [c, c])[1];
/* ---- konum veritabanı ---- */
let _LI = null;
PD.cName = c => (B4M.data.LOC[c] || { n: c || "Türkiye" }).n;
PD.locIdx = () => {
  if (_LI) return _LI; const L = [], D = B4M.data;
  for (const [c, { n, p }] of Object.entries(D.LOC)) for (const [il, s] of Object.entries(p)) { L.push({ c, cn: n, il, z: "", t: "il", label: `${il} (tüm il)` }); s.split(",").forEach(z => L.push({ c, cn: n, il, z, t: c == "TR" ? "ilçe" : "bölge" })); }
  for (const [il, s] of Object.entries(D.TRT)) s.split(",").forEach(z => L.push({ c: "TR", cn: "Türkiye", il, z, t: "turistik bölge" }));
  D.AIR.forEach(([c, il, z]) => L.push({ c, cn: D.LOC[c].n, il, z, t: "havalimanı" }));
  L.forEach(x => { x.label = x.label || x.z; x.k = U.norm(x.z + " " + x.il + " " + x.cn); }); return _LI = L;
};
PD.locFind = (q, types) => {
  q = U.norm(String(q || "").trim()); if (q.length < 2) return []; const a = [], b = [];
  for (const x of PD.locIdx()) { if (types && !types.includes(x.t)) continue; const zn = U.norm(x.z || x.il); if (zn.startsWith(q)) a.push(x); else if (x.k.includes(q)) b.push(x); }
  const w = { il: 0, "turistik bölge": 1, "havalimanı": 1, bölge: 2, ilçe: 2 }; a.sort((x, y) => (w[x.t] ?? 3) - (w[y.t] ?? 3)); return [...a, ...b].slice(0, 14);
};
PD.LT_H = ["ilçe", "turistik bölge", "bölge"]; PD.LT_FROM = ["havalimanı", "ilçe", "turistik bölge", "bölge"]; PD.LT_TO = ["ilçe", "turistik bölge", "bölge", "il"];
PD.addZone = z => { const Z = db().all("zones"); if (z && !Z.some(x => x.name == z)) db().add("zones", { name: z }); };
PD.addrTxt = h => [h.addr && h.addr.line, h.zone, h.city, PD.cName(h.country)].filter(Boolean).join(", ") + (h.addr && h.addr.phone ? " · Tel " + h.addr.phone : "");
/* ---- sözleşme para birimleri ---- */
PD.sCurs = dmc => (P.activeC("s", dmc) || { curs: U.CUR }).curs;
PD.myH = dmc => db().where("hotels", h => h.sup == dmc);
PD.H = id => db().get("hotels", id);
PD.findR = id => { for (const h of db().all("hotels")) { const r = h.rooms.find(x => x.id == id); if (r) return r; } };
/* ---- iptal şartları ---- */
PD.rcx = (h, r) => r.cxd ?? h.cxd ?? 7;
PD.supDL = (d, x) => x < 0 ? null : U.addD(d, -x);
PD.agDL = (d, x) => x < 0 ? null : U.addD(d, -(x + (P.rules().cxAdj || 0)));
PD.cxInfo = (d, x) => { const l = PD.agDL(d, x); return l == null ? { k: "nr" } : l < U.today() ? { k: "late" } : { k: "free", d: l }; };
PD.payInfo = items => { let imm = false, d = null; items.forEach(it => { const x = PD.agDL(it.a, it.cxd ?? 0); if (x == null || x < U.today()) imm = true; else d = !d || x < d ? x : d; }); return { imm, due: imm ? U.today() : (d || U.today()) }; };
/* ---- pazar kuralları ---- */
PD.mkOK = (m, nat) => !m || m.mode == "all" || (m.mode == "only" ? m.list.includes(nat) : !m.list.includes(nat));
PD.mkObj = k => { const id = +k.slice(1); return k[0] == "h" ? PD.H(id) : k[0] == "u" ? db().get("tours", id) : db().get("transfers", id); };
PD.mkSet = (k, a, v, pct) => {
  const o = PD.mkObj(k), m = o.mk || (o.mk = { mode: "all", list: [], adj: {} });
  if (a == "mode") m.mode = v; if (a == "tog") m.list = m.list.includes(v) ? m.list.filter(x => x != v) : [...m.list, v]; if (a == "del") delete m.adj[v];
  if (a == "adj") { const p = +pct; if (!p || p < -90 || p > 300) return no("-90 ile 300 arasında bir yüzde gir."); m.adj = m.adj || {}; m.adj[v] = p; }
  B4M.events.emit("market.rule.updated", k, 0, "TRY", o.sup); return ok("Pazar kuralı güncellendi.");
};
/* ---- SPO ---- */
PD.spoFor = (h, r, q) => (h.spo || []).filter(x => x.on && (!x.rooms || !x.rooms.length || x.rooms.includes(r.id)) && q.a >= x.sf && q.a <= x.st && U.today() >= x.bf && U.today() <= x.bt && U.nights(q.a, q.b).length >= (x.minN || 1)).sort((a, b) => b.pct - a.pct)[0] || null;
PD.spoAdd = (hid, o) => {
  const h = PD.H(hid), p = +o.pct; if (!(p > 0 && p <= 90)) return no("İndirim 1 ile 90 arasında olmalı.");
  if (!o.sf || !o.st || o.st < o.sf) return no("Geçerli konaklama tarihleri gir."); o.bf = o.bf || U.today(); if (!o.bt || o.bt < o.bf) return no("Geçerli satış tarihleri gir.");
  const x = { id: db().seq(), name: (o.name || "").trim() || o.type, type: o.type, pct: p, minN: Math.max(1, +o.minN || 1), sf: o.sf, st: o.st, bf: o.bf, bt: o.bt, rooms: o.rooms || [], on: true };
  (h.spo = h.spo || []).push(x); B4M.events.emit("spo.added", h.id + ":" + x.name, 0, h.cur, h.sup); return ok("Özel teklif eklendi; uygun aramalarda fiyata otomatik uygulanır.");
};
PD.spoTog = (hid, id) => { const s = PD.H(hid).spo.find(x => x.id == id); s.on = !s.on; B4M.events.emit(s.on ? "spo.started" : "spo.stopped", hid + ":" + s.name, 0); return ok(s.on ? "Teklif başlatıldı." : "Teklif durduruldu."); };
PD.spoDel = (hid, id) => { const h = PD.H(hid); h.spo = h.spo.filter(x => x.id != id); return ok("Teklif silindi."); };
/* ---- stop sale ---- */
PD.stopAdd = (hid, rooms, f, to, note) => {
  const h = PD.H(hid); to = to || f; if (!f) return no("Başlangıç tarihini seç."); if (to < f) return no("Bitiş, başlangıçtan önce olamaz.");
  let rs = rooms && rooms.length ? rooms : h.rooms.map(r => r.id);
  (h.stops = h.stops || []).push({ id: db().seq(), rooms: rs, from: f, to, at: U.now(), note: note || "" });
  const ds = U.dRange(f, to); h.rooms.filter(r => rs.includes(r.id)).forEach(r => { ds.forEach(d => !r.stop.includes(d) && r.stop.push(d)); r.stop.sort(); });
  B4M.events.emit("stop.sale.added", h.id + ":" + f + "→" + to, 0, h.cur, h.sup);
  return ok("Satış kapatıldı: {f} → {t} · {n} oda tipi", { f: I.fd(f), t: I.fd(to), n: rs.length });
};
PD.stopDel = (hid, sid) => {
  const h = PD.H(hid), rec = h.stops.find(x => x.id == sid); h.stops = h.stops.filter(x => x.id != sid); const ds = U.dRange(rec.from, rec.to);
  h.rooms.filter(r => rec.rooms.includes(r.id)).forEach(r => { r.stop = r.stop.filter(d => !ds.includes(d) || h.stops.some(o => o.rooms.includes(r.id) && d >= o.from && d <= o.to)); });
  B4M.events.emit("stop.sale.removed", h.id + ":" + rec.from + "→" + rec.to, 0, h.cur, h.sup); return ok("Stop kaldırıldı, satış yeniden açıldı.");
};
PD.delStop = (rid, d) => { const r = PD.findR(rid); r.stop = r.stop.filter(x => x != d); return ok("Kaldırıldı."); };
/* ---- otel ve oda ---- */
PD.addHotel = (dmc, o) => {
  const l = o.loc, r = o.room; if (!o.name) return no("Otel adını gir."); if (!l) return no("Konumu listeden seç."); if (!r.type || !(+o.price) || !(+o.allot)) return no("İlk oda tipi, fiyat ve kontenjanı gir."); if (r.cap < r.ma) return no("Toplam kişi, yetişkin sayısından az olamaz.");
  const h = db().add("hotels", { sup: dmc, tid: B4M.app.tidOf(dmc), name: o.name, country: l.c, city: l.il, zone: l.z, stars: +o.stars || 4, board: o.board || U.BOARD[0], cur: o.cur, cxd: Math.max(0, +o.cxd || 0), addr: o.addr || {}, rooms: [{ id: db().seq(), ...r, price: +o.price, nrp: 0, allot: +o.allot, stop: [] }], spo: [], stops: [] });
  PD.addZone(h.zone); B4M.events.emit("hotel.created", h.id, 0, h.cur, dmc);
  return ok("Otel kaydedildi. Oda tipleri, fiyat, stop ve SPO'ları ilgili sekmelerden ekleyebilirsin.", null, { h });
};
PD.saveHInfo = (id, o) => { const x = PD.H(id); if (!o.name) return no("Otel adı boş olamaz."); Object.assign(x, { name: o.name, stars: +o.stars, board: o.board, addr: o.addr }); if (o.loc) { x.country = o.loc.c; x.city = o.loc.il; x.zone = o.loc.z; PD.addZone(x.zone); } B4M.events.emit("hotel.updated", id, 0, x.cur, x.sup); return ok("Otel bilgileri kaydedildi."); };
PD.addRoom = (hid, o, price, nrp, allot) => { const h = PD.H(hid); if (!o.type || !(+price) || !(+allot)) return no("Oda tipi adı, fiyat ve kontenjan gir."); if (o.cap < o.ma) return no("Toplam kişi, yetişkin sayısından az olamaz."); h.rooms.push({ id: db().seq(), ...o, price: +price, nrp: +nrp || 0, allot: +allot, stop: [] }); return ok("Oda tipi eklendi."); };
PD.saveRoom = (rid, o) => { const r = PD.findR(rid); if (!o.type) return no("Oda tipi adı boş olamaz."); if (o.cap < o.ma) return no("Toplam kişi, yetişkin sayısından az olamaz."); Object.assign(r, o); return ok("Oda kaydedildi."); };
PD.setR = (rid, k, v) => { PD.findR(rid)[k] = Math.max(0, +v || 0); return ok("Kaydedildi."); };
PD.setH = (hid, k, v) => { const h = PD.H(hid); h[k] = Math.max(0, +v || 0); B4M.events.emit("cancel.policy.updated", "h" + hid, 0, "TRY", h.sup); return ok("Kaydedildi."); };
/* ---- sezon kontratları ---- */
PD.SX = (hid, sid) => PD.H(hid).seasons.find(s => s.id == sid);
PD.seGaps = s => { const cov = new Set(); s.periods.forEach(p => U.dRange(p.from, p.to).forEach(d => cov.add(d))); const g = []; let st = null, pv = null; U.dRange(s.from, s.to).forEach(d => { if (!cov.has(d)) { if (!st) st = d; pv = d; } else if (st) { g.push([st, pv]); st = null; } }); if (st) g.push([st, pv]); return g; };
PD.nextFrom = s => { const P2 = s.periods.slice().sort((a, b) => b.to.localeCompare(a.to)); if (!P2.length) return s.from; const n = U.addD(P2[0].to, 1); return n > s.to ? "" : n; };
PD.seAdd = (hid, n, type, f, to) => {
  const h = PD.H(hid); if (!n) return no("Sezon adını gir."); if (!f || !to || to < f) return no("Geçerli sezon tarihleri gir."); if (U.dRange(f, to).length >= 400) return no("Sezon en fazla 400 gün olabilir.");
  if ((h.seasons || []).some(s => !(to < s.from || f > s.to))) return no("Bu tarihler başka bir sezonla çakışıyor.");
  const s = { id: db().seq(), name: n, type, from: f, to, periods: [] }; (h.seasons = h.seasons || []).push(s); h.seasons.sort((a, b) => a.from.localeCompare(b.from));
  B4M.events.emit("season.added", hid + ":" + n, 0, h.cur, h.sup); return ok("Sezon eklendi. Şimdi periyotları tanımla.", null, { s });
};
PD.seDel = (hid, sid) => { const h = PD.H(hid); h.seasons = h.seasons.filter(s => s.id != sid); B4M.events.emit("season.removed", hid + ":" + sid, 0, h.cur, h.sup); return ok("Sezon silindi."); };
PD.peAdd = (hid, sid, n, f, to) => {
  const s = PD.SX(hid, sid); n = n || `P${s.periods.length + 1}`; if (!f || !to || to < f) return no("Geçerli periyot tarihleri gir.");
  if (f < s.from || to > s.to) return no("Periyot sezon aralığında olmalı ({a} → {b}).", { a: I.fd(s.from), b: I.fd(s.to) }); if (s.periods.some(p => !(to < p.from || f > p.to))) return no("Bu tarihler başka bir periyotla çakışıyor.");
  s.periods.push({ id: db().seq(), name: n, from: f, to, prices: {} }); B4M.events.emit("period.added", hid + ":" + s.name + ":" + n, 0, PD.H(hid).cur, PD.H(hid).sup); return ok("Periyot eklendi; fiyatlarını tabloya gir.");
};
PD.peDel = (hid, sid, pid) => { const s = PD.SX(hid, sid); s.periods = s.periods.filter(p => p.id != pid); return ok("Periyot silindi."); };
PD.peCopy = (hid, sid, pid) => { const P2 = PD.SX(hid, sid).periods.slice().sort((a, b) => a.from.localeCompare(b.from)), i = P2.findIndex(p => p.id == pid); if (i < 1) return no(""); P2[i].prices = U.clone(P2[i - 1].prices || {}); return ok("Önceki periyodun fiyatları kopyalandı."); };
PD.peSet = (hid, sid, pid, rid, k, v) => { const p = PD.SX(hid, sid).periods.find(p => p.id == pid); p.prices = p.prices || {}; const o = p.prices[rid] = p.prices[rid] || {}; o[k] = Math.max(0, +v || 0); B4M.events.emit("period.price.updated", hid + ":" + pid + ":" + rid, o[k], PD.H(hid).cur, PD.H(hid).sup); return ok("Fiyat kaydedildi."); };
PD.occSet = (hid, rid, oi, pid, v) => { const r = PD.H(hid).rooms.find(y => y.id == rid), o = r.occ[oi]; if (v === "") delete o.v[pid]; else o.v[pid] = Math.max(0, +v); return ok("Kombinasyon fiyatı kaydedildi."); };
/* ---- fiyat hesabı ---- */
PD.ageFit = (R, A) => { if (R.length != A.length) return false; const go = (i, used) => i == A.length || R.some((r, j) => !used[j] && A[i] >= r[0] && A[i] <= r[1] + .001 && go(i + 1, { ...used, [j]: 1 })); return go(0, {}); };
PD.occM = (r, o) => (r.occ || []).find(c => c.ad == o.ad && PD.ageFit(c.ch, o.ages || []));
PD.perOK = (h, ns) => { if (!ns.length) return true; for (const s of h.seasons || []) for (const p of s.periods) if (ns[0] >= p.from && ns[0] <= p.to) { if (p.min && ns.length < p.min) return false; if (p.rel > 0 && (new Date(ns[0]) - new Date(U.today())) / 864e5 < p.rel) return false; return true; } return true; };
/* bir gecenin fiyatı: sezon/periyot varsa periyot fiyatı, kombinasyon fiyatı varsa misafir düzenine uyan satır */
PD.baseN = (h, r, d, rt, o) => {
  const Sn = h.seasons || []; if (!Sn.length) return rt == "n" ? (r.nrp || 0) : r.price;
  for (const s of Sn) for (const p of s.periods) if (d >= p.from && d <= p.to) { const x = (p.prices || {})[r.id] || {}; if (rt != "n" && o && (r.occ || []).length) { const c = PD.occM(r, o), w = c && c.v[p.id]; return w > 0 ? w : 0; } const v = rt == "n" ? x.nrp : x.price; return v > 0 ? v : 0; }
  return 0;
};
/* konaklama toplamı (alıcının gördüğü fiyat): q = {a,b,nat,ag}, o = oda düzeni */
PD.stayT = (h, r, ns, rt, q, o) => {
  if (!PD.perOK(h, ns)) return null; let tt = 0; for (const d of ns) { const v = PD.baseN(h, r, d, rt, o); if (!(v > 0)) return null; tt += v; }
  const sp = PD.spoFor(h, r, q); return U.r2(tt * (1 + (((h.mk || {}).adj || {})[q.nat] || 0) / 100) * (1 - (sp ? sp.pct : 0) / 100) * PR.pf(q.ag, h.sup, "h"));
};
/* ---- transfer ---- */
PD.addTf = (dmc, from, to, prices, cur, cx) => {
  if (!from || !to) return no("Nereden ve nereye noktalarını listeden seç."); const f = from.z || from.il, tt = to.t == "il" ? `${to.il} (tüm il)` : to.z; if (f == tt) return no("Kalkış ve varış farklı olmalı.");
  let n = 0; Object.keys(U.VEH).forEach(v => { const p = +prices[v]; if (!(p > 0)) return; let x = db().find("transfers", y => y.sup == dmc && y.from == f && y.to == tt && y.veh == v); if (!x) x = db().add("transfers", { sup: dmc, tid: B4M.app.tidOf(dmc), from: f, to: tt, veh: v }); Object.assign(x, { price: p, cur, cxd: +cx, toIl: to.il, allIl: to.t == "il" ? to.il : null, country: to.c }); n++; });
  if (!n) return no("En az bir araç için fiyat gir."); [f, tt].forEach(PD.addZone); B4M.events.emit("transfer.prices.saved", f + "→" + tt, 0, cur, dmc);
  return ok("{n} araç fiyatı kaydedildi: {f} → {t}", { n, f, t: tt });
};
PD.setTfP = (id, v) => { db().get("transfers", id).price = Math.max(0, +v || 0); return ok("Fiyat güncellendi."); };
PD.delTf = id => { db().del("transfers", id); return ok("Silindi."); };
PD.setCx = (k, id, v) => { const o = db().get(k == "u" ? "tours" : "transfers", id); o.cxd = +v; B4M.events.emit("cancel.policy.updated", k + id, 0, "TRY", o.sup); return ok("İptal şartı kaydedildi."); };
/* ---- tur ---- */
PD.addTourRow = (dmc, o, IL) => {
  if (!PD.sCurs(dmc).includes(o.cur)) { IL.push(["Atlandı: {l} – {c} sözleşmenizdeki para birimleri arasında değil ({cs})", { l: "Tur " + o.name, c: o.cur, cs: PD.sCurs(dmc).join(", ") }]); return; }
  if (!o.name || !o.price) { IL.push(["Atlandı: eksik tur bilgisi"]); return; }
  const x = db().find("tours", y => y.sup == dmc && y.name.toLowerCase() == o.name.toLowerCase());
  if (x) { Object.assign(x, { price: o.price, cur: o.cur }); if (o.city != "—") x.city = o.city; if (o.dur != "—") x.dur = o.dur; if (o.quota) x.quota = o.quota; x.dates = U.uniq([...x.dates, ...o.dates]).sort(); }
  else db().add("tours", { sup: dmc, tid: B4M.app.tidOf(dmc), ...o, dates: U.uniq(o.dates).sort() });
  IL.push(["Tur {n}: {p} · {d} tarih{q}", { n: o.name, p: I.fm(o.price, o.cur), d: o.dates.length, q: o.quota ? " · " + t("kontenjan") + " " + o.quota : "" }]);
};
PD.addTour = (dmc, o) => { if (!o.name || !(+o.price) || !(+o.quota) || !o.dates.length) return no("Tur adı, fiyat, kontenjan ve en az bir tarih gir."); const IL = []; PD.addTourRow(dmc, { ...o, price: +o.price, quota: +o.quota }, IL); return ok(IL.map(([m, p]) => t(m, p)).join(" · ")); };
PD.delTu = id => { db().del("tours", id); return ok("Silindi."); };
/* ---- metinle / CSV ile yükleme (prompt kutusu) ---- */
PD.parseD = s => { s = (s || "").trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0]; m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; };
PD.curN = c => { c = (c || "").toUpperCase(); c = ({ "TL": "TRY", "₺": "TRY", "$": "USD", "€": "EUR", "£": "GBP" })[c] || c; return U.CUR.includes(c) ? c : ""; };
const vehN = v => /^minib/i.test(v) ? "Minibüs" : /^minivan/i.test(v) ? "Minivan" : "Sedan";
const CRX = "USD|EUR|GBP|CHF|JPY|CAD|AUD|CNY|AED|SGD|TRY|TL|₺|\\$|€|£", DT = "\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[./]\\d{1,2}[./]\\d{4}";
PD.importText = (dmc, text) => {
  const IL = [], sc = PD.sCurs(dmc), curOK = (c, l) => { if (sc.includes(c)) return true; IL.push(["Atlandı: {l} – {c} sözleşmenizdeki para birimleri arasında değil ({cs})", { l, c, cs: sc.join(", ") }]); return false; };
  const addTfRow = (f, to, v, p, c) => { if (!curOK(c, "Transfer " + f + " → " + to)) return; const x = db().find("transfers", y => y.sup == dmc && y.from == f && y.to == to && y.veh == v); [f, to].forEach(PD.addZone); if (x) { x.price = p; x.cur = c; } else db().add("transfers", { sup: dmc, tid: B4M.app.tidOf(dmc), from: f, to, veh: v, price: p, cur: c, cxd: 1 }); IL.push(["Transfer {f} → {t} · {v}: {p}", { f, t: to, v, p: I.fm(p, c) }]); };
  const applyRow = r => {
    let h = PD.myH(dmc).find(x => x.name.toLowerCase() == r.hotel.toLowerCase());
    if (!h) { if (r.cur && !curOK(r.cur, r.hotel)) return; h = db().add("hotels", { sup: dmc, tid: B4M.app.tidOf(dmc), name: r.hotel, city: r.city || "—", zone: r.zone || "Merkez", country: "TR", stars: 4, board: U.BOARD[0], cur: r.cur || sc[0], cxd: 7, addr: {}, rooms: [], spo: [], stops: [] }); IL.push(["Yeni otel açıldı: {n} (sözleşme {c})", { n: h.name, c: h.cur }]); }
    if (r.cur && r.cur != h.cur && r.price) return IL.push(["Atlandı: {n} sözleşmesi {a}, satırda {b} var", { n: h.name, a: h.cur, b: r.cur }]);
    let rs = r.room ? [h.rooms.find(x => x.type.toLowerCase() == r.room.toLowerCase())] : h.rooms;
    if (r.room && !rs[0]) { if (!r.price) return IL.push(["Atlandı: {n} / {r} yeni oda, fiyat yok", { n: h.name, r: r.room }]); rs = [{ id: db().seq(), type: r.room, cap: 2, ma: 2, mc: 1, price: r.price, nrp: 0, allot: +r.allot || 5, stop: [] }]; h.rooms.push(rs[0]); IL.push(["Yeni oda: {n} / {r}", { n: h.name, r: r.room }]); }
    rs.forEach(x => {
      if (r.room) { if (r.price) { x.price = r.price; IL.push(["{n} / {r}: fiyat {p}", { n: h.name, r: x.type, p: I.fm(x.price, h.cur) }]); } if (r.allot !== "" && r.allot != null && !isNaN(+r.allot)) { x.allot = +r.allot; IL.push(["{n} / {r}: kontenjan {a}", { n: h.name, r: x.type, a: x.allot }]); } }
      if (r.from) { U.nights(r.from, U.addD(r.to || r.from, 1)).forEach(d => !x.stop.includes(d) && x.stop.push(d)); x.stop.sort(); IL.push(["{n} / {r}: stop-sale {f} → {t}", { n: h.name, r: x.type, f: I.fd(r.from), t: I.fd(r.to || r.from) }]); }
    });
  };
  const tfR = new RegExp(`transfer\\s+(.+?)\\s*(?:->|→)\\s*(.+?)\\s+(sedan|minivan|minib[uü]s)\\s+(\\d+(?:[.,]\\d+)?)\\s*(${CRX})`, "i"), prR = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${CRX})`, "i");
  String(text || "").split("\n").map(l => l.trim()).filter(Boolean).forEach(l => {
    if (new RegExp(`u[cç]u[sş]\\s+([A-Za-z]{2}\\d{2,4})`, "i").test(l)) return IL.push(["Atlandı: uçuşlar yalnızca API bağlantısıyla alınır ({n})", { n: (l.match(/[A-Za-z]{2}\d{2,4}/) || ["?"])[0] }]);
    let m = l.match(new RegExp(`^tur\\s+(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s*(${CRX})(.*)$`, "i"));
    if (m) { const r = m[4], c = r.match(/(?:şehir|sehir)\s+(.+?)(?=\s+(?:süre|sure|kontenjan|tarih)\b|$)/i), d = r.match(/(?:süre|sure)\s+(\d+\s*(?:gün|gun|saat))/i), q = r.match(/kontenjan\s+(\d+)/i); return PD.addTourRow(dmc, { name: m[1].trim(), city: c ? c[1].trim() : "—", dur: d ? d[1] : "—", price: +m[2].replace(",", "."), cur: PD.curN(m[3]) || "EUR", quota: q ? +q[1] : 0, dates: (r.match(new RegExp(DT, "g")) || []).map(PD.parseD) }, IL); }
    m = l.match(tfR); if (m) return addTfRow(m[1].trim(), m[2].trim(), vehN(m[3]), +m[4].replace(",", "."), PD.curN(m[5]) || "EUR");
    const h = PD.myH(dmc).find(x => l.toLowerCase().includes(x.name.toLowerCase())); if (!h) return /\d/.test(l) && IL.push(["Tanınmadı: {l}", { l: l.slice(0, 60) }]);
    const rm = h.rooms.find(x => l.toLowerCase().includes(x.type.toLowerCase())), st = /stop|kapat|closed/i.test(l), ds = (l.match(/\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4}/g) || []).map(PD.parseD), pm = st ? null : l.match(prR), al = l.match(/(?:kontenjan|allotment|allot)\s*[:=]?\s*(\d+)/i);
    applyRow({ hotel: h.name, room: rm ? rm.type : "", price: pm ? +pm[1].replace(",", ".") : 0, cur: pm ? PD.curN(pm[2]) : "", allot: al ? al[1] : "", from: st ? ds[0] : "", to: st ? ds[1] : "" });
  });
  if (!IL.length) IL.push(["İşlenecek bir fiyat, kontenjan veya stop-sale satırı bulunamadı."]);
  B4M.events.emit("import.applied", IL.length, 0, "TRY", dmc); return IL;
};
PD.sampleFor = (dmc, sec) => {
  const m = PD.myH(dmc), a = m[0], d = n => U.addD(U.today(), n), Z = db().all("zones").map(z => z.name);
  if (sec == "h") { if (!a || !a.rooms[0]) return ""; const r = a.rooms[0], b = m[1] || a; return `${a.name} ${r.type} ${Math.round(r.price * 1.08)} ${a.cur} kontenjan ${r.allot + 2}\nStop sale: ${b.name} ${b.rooms[0].type} 24.12.2026 - 26.12.2026`; }
  if (sec == "t") return `Transfer ${Z[0]} -> ${Z[1]} Sedan 21 EUR\nTransfer ${Z[0]} -> ${Z[1]} Minivan 36 EUR`;
  return `Tur Boğaz Tekne Turu 33 EUR şehir İstanbul süre 4 saat kontenjan 25 tarih ${d(7)}, ${d(8)}, ${d(9)}`;
};
