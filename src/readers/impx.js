/* Toplu otel yükleme oturumu: dosya → kontrol ve düzenleme → kontrat. Siz kaydedene kadar hiçbir şey sisteme yazılmaz. */
const IX = B4M.imp = {};
const db = () => B4M.db, XP = B4M.xp, PD = B4M.prod;
IX.blank = () => ({ st: "up", src: "", hotels: [], tf: [], tfNotes: [], skipped: [], sel: {}, cur: -1, f: "all", allot: 10, yr: 0, rc: true, busy: false, done: null, fileMsg: [] });
/* konum: il / bölge veritabanıyla eşle */
IX.loc = h => {
  const Pp = Object.keys((B4M.data.LOC.TR || {}).p || {}), isIl = x => Pp.some(p => U.norm(p) == U.norm(x)); let c = h.city, z = h.zone;
  if (z && isIl(z) && !isIl(c)) [c, z] = [z, c]; if (/CITY|CENT/i.test(z)) z = "Merkez";
  const il = Pp.find(p => U.norm(p) == U.norm(c)) || XP.xTitle(c); let zone = XP.xTitle(z);
  if (z && !/^merkez$/i.test(z)) { const r = PD.locFind(z).filter(x => x.c == "TR" && x.z), m = r.find(x => U.norm(x.il) == U.norm(il)) || r[0]; if (m) zone = m.z; }
  h.city = il; h.zone = zone || "Merkez"; h.country = "TR";
};
IX.load = (S, sheets, src) => { const B = XP.xBook(sheets); B.hotels.forEach(IX.loc); const sel = {}; B.hotels.forEach((h, i) => { if (h.st != "e") sel[i] = 1; }); return Object.assign(S, { fileMsg: S.fileMsg || [], st: "list", src, hotels: B.hotels, tf: B.tf, tfNotes: B.tfNotes, skipped: B.skipped, sel, cur: -1, f: "all", busy: false, done: null }); };
IX.demo = S => IX.load(S, U.clone(B4M.data.XDEMO), "2023_SUMMER_PRICE_1.xlsx (örnek: 4 otel)");
/* dosyaları oku (tarayıcı) */
IX.readFiles = async (S, F, prog) => {
  F = [...(F || [])]; if (!F.length) return { ok: false };
  if (F.some(f => !/\.(xlsx|xlsm|pdf|jpe?g|png|webp|bmp)$/i.test(f.name))) return { ok: false, msg: "Excel (.xlsx), PDF veya fotoğraf (.jpg, .png) yükleyebilirsiniz." };
  const sh = [], msg = [], IP = [], IN = []; let ifx = 0, ilo = 0;
  for (const f of F) {
    try {
      if (/\.pdf$/i.test(f.name)) { const buf = await f.arrayBuffer(), Pg = await B4M.pdfx.pages(buf.slice(0)); if (Pg.reduce((s, p) => s + p.items.length, 0) >= 15) B4M.pdfx.sheets(Pg, f.name).forEach(x => sh.push(x)); else { prog && prog(t("{f}: taranmış belge, OCR başlıyor…", { f: f.name })); const r = await B4M.ocr.pdf(buf, m => prog && prog(`${f.name} · ${m.status}`, m.progress)); B4M.pdfx.sheets(r.pages, f.name).forEach(x => { x.ocr = { fix: r.fix, low: r.low }; x.pdf += " · OCR"; sh.push(x); }); } }
      else if (/\.(jpe?g|png|webp|bmp)$/i.test(f.name)) { prog && prog(t("{f}: OCR başlıyor…", { f: f.name })); const r = await B4M.ocr.image(f, m => prog && prog(`${f.name} · ${m.status}`, m.progress)); IP.push(...r.pages); IN.push(f.name); ifx += r.fix; ilo += r.low; }
      else (await B4M.xlsx.read(await f.arrayBuffer())).forEach(s => sh.push(s));
    } catch (e) { msg.push(`${f.name}: ${t(e.message == "load" ? "okuyucu yüklenemedi (internet bağlantısını kontrol edin)" : e.message == "img" ? "görüntü açılamadı" : /encrypt|password/i.test(e.message || "") ? "şifreli dosya" : "okunamadı")}`); }
  }
  if (IP.length) B4M.pdfx.sheets(IP, IN.length > 1 ? "fotoğraflar" : IN[0]).forEach(x => { x.ocr = { fix: ifx, low: ilo }; x.pdf = `${IN.join(", ")} · OCR`; sh.push(x); });
  S.busy = false; if (!sh.length) return { ok: false, msg: msg.join(" · ") || "Dosyada okunabilir sayfa bulunamadı." };
  IX.load(S, sh, F.map(f => f.name).join(", ")); S.fileMsg = msg; return { ok: true, n: S.hotels.length };
};
IX.ex = (h, dmc) => db().find("hotels", x => x.sup == dmc && U.norm(x.name) == U.norm(h.name));
IX.yr = h => +((h.periods[0] || {}).from || h.from || "").slice(0, 4) || 0;
IX.shift = (S, d, h) => !d || !S.yr || !IX.yr(h) ? d : String(+d.slice(0, 4) + S.yr - IX.yr(h)) + d.slice(4);
IX.ap = c => c == "AYT" ? U.AYT : c == "IST" ? U.IST : c;
IX.zone = z => { const r = PD.locFind(z).filter(x => x.c == "TR" && x.z); return r.length ? r[0].z : XP.xTitle(z); };
IX.veh = n => (Object.entries(U.VEH).sort((a, b) => a[1] - b[1]).find(([, c]) => c >= n) || Object.entries(U.VEH).pop())[0];
/* düzenleme */
IX.re = (S, hi) => { const h = S.hotels[hi]; XP.xVal(h); if (h.st == "e") delete S.sel[hi]; };
IX.set = (S, hi, k, v) => { S.hotels[hi][k] = typeof v == "string" ? v.trim() : v; IX.re(S, hi); };
IX.per = (S, hi, k, f, v) => { const p = S.hotels[hi].periods[k]; p[f] = f == "rel" || f == "min" ? (v === "" ? null : Math.max(0, +v)) : v; IX.re(S, hi); };
IX.room = (S, hi, ri, f, v) => { S.hotels[hi].rooms[ri][f] = String(v).trim(); IX.re(S, hi); };
IX.base = (S, hi, ri, k, v) => { const r = S.hotels[hi].rooms[ri], o = r.base[k], n = v === "" ? null : +v; if (S.rc && o > 0 && n > 0) r.occ.forEach(c => { if (c.v[k] > 0) c.v[k] = XP.xR2(c.v[k] * n / o); }); r.base[k] = n; IX.re(S, hi); };
IX.cell = (S, hi, ri, ci, k, v) => { S.hotels[hi].rooms[ri].occ[ci].v[k] = v === "" ? null : XP.xR2(+v); IX.re(S, hi); };
IX.lbl = (S, hi, ri, ci, v) => { const c = S.hotels[hi].rooms[ri].occ[ci], o = XP.occP(v); c.lbl = String(v).trim(); c.alts = o.map(x => ({ ad: x.ad, ch: x.ch })); c.guess = o.some(x => x.guess); IX.re(S, hi); };
IX.delOcc = (S, hi, ri, ci) => { S.hotels[hi].rooms[ri].occ.splice(ci, 1); IX.re(S, hi); };
IX.delRoom = (S, hi, ri) => { S.hotels[hi].rooms.splice(ri, 1); IX.re(S, hi); };
IX.addOcc = (S, hi, ri) => { const h = S.hotels[hi]; h.rooms[ri].occ.push({ lbl: "", alts: [], v: h.periods.map(() => null) }); IX.re(S, hi); };
/* kayıt */
IX.save = (S, dmc) => {
  const cs = PD.sCurs(dmc), sk = [], tid = B4M.app.tidOf(dmc); let n = 0, u = 0, tf = 0;
  Object.keys(S.sel).map(Number).forEach(i => {
    const h = S.hotels[i]; if (!h || h.st == "e") return sk.push([`{h}: okunamadı`, { h: h ? h.name : i }]); if (!cs.includes(h.cur)) return sk.push(["{h}: {c} sözleşmede yok", { h: h.name, c: h.cur }]);
    const R = h.rooms.filter(r => r.occ.some(c => c.alts.length)); if (!R.length) return sk.push(["{h}: oda yok", { h: h.name }]);
    let x = IX.ex(h, dmc); if (x) u++; else { n++; x = db().add("hotels", { sup: dmc, tid, name: h.name, country: "TR", cxd: 7, addr: {}, rooms: [], spo: [], stops: [] }); }
    Object.assign(x, { name: h.name, country: h.country || "TR", city: h.city, zone: h.zone, stars: h.stars || x.stars || 0, board: h.board, cur: h.cur }); PD.addZone(x.zone);
    const sn = S.yr && IX.yr(h) ? h.season.replace(/20\d\d/, S.yr) : h.season, se = { id: db().seq(), name: sn, type: /WINTER|KIŞ|KIS/i.test(sn) ? "Kış" : "Yaz", from: IX.shift(S, h.from || h.periods[0].from, h), to: IX.shift(S, h.to || h.periods[h.periods.length - 1].to, h), periods: [] };
    h.periods.forEach(p => se.periods.push({ id: db().seq(), name: p.name, from: IX.shift(S, p.from, h), to: IX.shift(S, p.to, h), rel: p.rel, min: p.min, prices: {} }));
    const oldP = new Set(((x.seasons || []).find(q => q.name == sn) || { periods: [] }).periods.map(p => p.id)), same = (a, b) => a.ad == b.ad && JSON.stringify(a.ch) == JSON.stringify(b.ch);
    R.forEach(ir => {
      let r = x.rooms.find(y => U.norm(y.type) == U.norm(ir.type)); const pr = ir.occ.filter(c => c.alts.length).flatMap(c => c.alts.map(a => ({ c, a }))), al = pr.map(z => z.a);
      if (!r) { r = { id: db().seq(), type: ir.type, price: 0, nrp: 0, allot: S.allot, stop: [] }; x.rooms.push(r); }
      Object.assign(r, { cap: Math.max(...al.map(a => a.ad + a.ch.length)), ma: Math.max(...al.map(a => a.ad)), mc: Math.max(...al.map(a => a.ch.length)), bcode: ir.code });
      const occ = []; pr.forEach(({ c, a }) => { if (occ.some(q => same(q, a))) return; const o = { lbl: c.lbl, ad: a.ad, ch: a.ch, v: {} }; se.periods.forEach((p, k) => { if (c.v[k] > 0) o.v[p.id] = c.v[k]; }); occ.push(o); });
      const std = ir.occ.find(c => c.alts.some(a => a.ad == 2 && !a.ch.length)) || ir.occ.find(c => c.alts.length); se.periods.forEach((p, k) => p.prices[r.id] = { price: std && std.v[k] > 0 ? std.v[k] : 0, nrp: 0 });
      (r.occ || []).forEach(o => { const v = {}; Object.entries(o.v).forEach(([k, val]) => { if (!oldP.has(+k)) v[k] = val; }); if (!Object.keys(v).length) return; const m = occ.find(q => same(q, o)); if (m) Object.assign(m.v, v); else occ.push({ ...o, v }); }); r.occ = occ;
    });
    x.seasons = (x.seasons || []).filter(s => s.name != sn); x.seasons.push(se); B4M.events.emit("hotel.contract.imported", x.id, 0, x.cur, dmc);
    if (h.st == "w" && B4M.agents) B4M.agents.note("product", { kind: "check", hid: x.id, name: x.name, warn: h.W.filter(w => w[0] == "w").length }, dmc);
  });
  S.tf.filter(z => z.on && z.one > 0).forEach(z => {
    if (!cs.includes(z.cur)) { sk.push(["Transfer {z}: {c} sözleşmede yok", { z: z.zones.join("/"), c: z.cur }]); return; }
    z.zones.forEach(zn => { const to = IX.zone(zn), from = IX.ap(z.ap), veh = IX.veh(z.pmax), e = db().find("transfers", y => y.sup == dmc && y.from == from && y.to == to && y.veh == veh); if (e) { e.price = z.one; e.cur = z.cur; } else db().add("transfers", { sup: dmc, tid, from, to, veh, price: z.one, cur: z.cur, cxd: 1, toIl: "Antalya", country: "TR" }); PD.addZone(to); tf++; });
  });
  if (!db().commit()) return { ok: false, msg: "Tarayıcı depolama alanı doldu; daha az otel seçip tekrar deneyin." };
  S.done = { n, u, t: tf, sk }; S.sel = {}; return { ok: true, msg: "{n} otel kaydedildi.", p: { n: n + u } };
};
