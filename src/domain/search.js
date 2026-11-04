/* Arama motoru: otel, transfer, uçak ve tur. Sonuçlar platform fiyatlarıyla (markup dahil) gelir, tedarikçi adı gösterilmez;
   alıcının kendi DMC'sinin ürünleri kendi fiyatıyla "Special offer" olarak işaretlenir. Aynı hizmet birden çok DMC'de varsa en düşük fiyat seçilir. */
const SR = B4M.search = {};
const db = () => B4M.db, PR = B4M.price, PD = B4M.prod, P = B4M.parties;
SR.AP = ["İstanbul (IST)", "Sabiha Gökçen (SAW)", "Antalya (AYT)", "İzmir (ADB)", "Ankara (ESB)", "Dalaman (DLM)", "Bodrum (BJV)", "Kapadokya (NAV)", "Frankfurt (FRA)", "Londra (LHR)", "Amsterdam (AMS)"];
SR.CITYAP = { antalya: "Antalya (AYT)", istanbul: "İstanbul (IST)", izmir: "İzmir (ADB)", ankara: "Ankara (ESB)", nevsehir: "Kapadokya (NAV)", bodrum: "Bodrum (BJV)", mugla: "Dalaman (DLM)" };
SR.q = o => Object.assign({ ag: 0, a: U.addD(U.today(), 7), b: U.addD(U.today(), 9), nat: "TR", cur: "EUR", occ: [{ ad: 2, ch: 0, ages: [] }], city: "", cityK: null, stars: 0, board: "", max: "", sort: "p", d: U.addD(U.today(), 7), pax: 2, f: U.AYT, to: "Lara", rt: "0", tq: "", ff: "İstanbul (IST)", ft: "Antalya (AYT)" }, o || {});
SR.own = (ag, sup) => PR.isOwnBuy(ag, sup);
/* ---- stok ---- */
SR.booked = (r, d, ex) => db().where("bookings", b => b.room == r.id && b.id != ex && b.status == "Onaylı" && (b.ns || []).includes(d)).length;
SR.avail = (r, ns, ex) => ns.length ? Math.min(...ns.map(d => r.stop.includes(d) ? 0 : Math.max(0, r.allot - SR.booked(r, d, ex)))) : 0;
SR.fFree = f => f.seats - db().where("bookings", b => b.kind == "f" && b.fid == f.id && b.status == "Onaylı").reduce((s, b) => s + b.guests.length, 0);
SR.uFree = (tt, d) => tt.quota - db().where("bookings", b => b.kind == "u" && b.tid == tt.id && b.a == d && b.status == "Onaylı").reduce((s, b) => s + b.guests.length, 0);
/* ---- otel ---- */
SR.groups = ag => { const m = {}; db().all("hotels").filter(h => PR.supOK(h.sup, "h", ag)).forEach(h => (m[h.name.toLowerCase() + "|" + h.city.toLowerCase()] ??= []).push(h)); return m; };
SR.group = (ag, key) => SR.groups(ag)[key] || [];
const tk = r => r.type.toLowerCase();
SR.typesOf = L => { const m = {}; L.forEach(h => h.rooms.forEach(r => m[tk(r)] = m[tk(r)] || r.type)); return m; };
SR.offersFor = (L, ty, ns, o, q, used = {}, rt = "r") => L.filter(h => PD.mkOK(h.mk, q.nat)).flatMap(h => h.rooms.filter(r => tk(r) == ty && o.ad + o.ch <= r.cap && o.ad <= (r.ma ?? r.cap) && o.ch <= (r.mc ?? r.cap) && SR.avail(r, ns) - (used[r.id] || 0) > 0).map(r => {
  const tot = PD.stayT(h, r, ns, rt, q, o); return tot == null ? null : { h, r, rt, tot, p: U.r2(tot / ns.length), cxd: rt == "n" ? -1 : PD.rcx(h, r), spo: PD.spoFor(h, r, q), own: SR.own(q.ag, h.sup) };
}).filter(Boolean)).sort((a, b) => PR.tryP(a.p, a.h.cur) - PR.tryP(b.p, b.h.cur));
SR.alloc = (G, ns, q) => { const used = {}, res = []; for (let i = 0; i < q.occ.length; i++) { const of = SR.offersFor(G, q.sel[i], ns, q.occ[i], q, used, (q.rate || [])[i] || "r"); if (!of.length) return { err: "Oda {i}: seçilen tipte yeterli müsaitlik yok.", p: { i: i + 1 } }; used[of[0].r.id] = (used[of[0].r.id] || 0) + 1; res.push(of[0]); } return { res }; };
/* oda seçimi başlat: her oda için uygun ilk tip */
SR.pickRooms = (G, q) => { const ns = U.nights(q.a, q.b); if (!ns.length) return { err: "Önce takvimden giriş ve çıkış tarihini seç." }; const ty = SR.typesOf(G), sel = [], rate = []; for (const o of q.occ) { const k = Object.keys(ty).find(k => SR.offersFor(G, k, ns, o, q).length || SR.offersFor(G, k, ns, o, q, {}, "n").length); if (!k) return { err: "Bu oda düzenine uygun müsait oda tipi yok." }; sel.push(k); rate.push(SR.offersFor(G, k, ns, o, q).length ? "r" : "n"); } return { sel, rate }; };
/* konum araması: ülke, il, bölge veya otel adı */
SR.hsIdx = ag => { const m = new Map(), add = (k, o) => { const e = m.get(k); if (e) e.n++; else m.set(k, { ...o, n: 1 }); }; db().all("hotels").filter(h => PR.supOK(h.sup, "h", ag)).forEach(h => { const cn = PD.cName(h.country || "TR"); add("c|" + (h.country || "TR"), { t: "Ülke", l: cn, v: { k: "c", x: h.country || "TR" } }); add("i|" + h.city, { t: "Şehir", l: h.city, s: cn, v: { k: "i", x: h.city } }); add("z|" + h.zone + "|" + h.city, { t: "Bölge", l: h.zone, s: h.city + " · " + cn, v: { k: "z", x: h.zone, i: h.city } }); add("h|" + U.norm(h.name), { t: "Otel", l: h.name, s: h.zone + ", " + h.city, v: { k: "h", x: h.name } }); }); return [...m.values()]; };
SR.hsSug = (ag, text) => { const q = U.norm(text).trim(), w = { Ülke: 0, Şehir: 1, Bölge: 2, Otel: 3 }; return q.length < 2 ? [] : SR.hsIdx(ag).filter(x => U.norm(x.l + " " + (x.s || "")).includes(q)).sort((a, b) => (U.norm(a.l).startsWith(q) ? 0 : 1) - (U.norm(b.l).startsWith(q) ? 0 : 1) || w[a.t] - w[b.t]).slice(0, 12); };
SR.hsMatch = (f, q) => { const k = q.cityK; if (k) { if (k.k == "c") return (f.country || "TR") == k.x; if (k.k == "i") return f.city == k.x; if (k.k == "z") return f.zone == k.x && f.city == k.i; return U.norm(f.name) == U.norm(k.x); } return U.mt(q.city, [f.name, f.zone, f.city, PD.cName(f.country || "TR")].join(" ")); };
/* otel arama sonuçları: grup başına oda tipleri, en düşük fiyat */
SR.hotels = q => {
  const ns = U.nights(q.a, q.b), mx = Math.max(...q.occ.map(o => o.ad + o.ch)), o0 = { ad: mx, ch: 0 };
  const L = Object.entries(SR.groups(q.ag)).map(([key, G]) => {
    const ty = SR.typesOf(G), rows = Object.entries(ty).map(([k, n]) => {
      const of = SR.offersFor(G, k, ns, o0, q), nf = SR.offersFor(G, k, ns, o0, q, {}, "n"), b0 = of[0] || nf[0]; if (!b0) return null;
      return { k, n, own: SR.own(q.ag, b0.h.sup), spo: b0.spo, p: PR.cv(b0.p, b0.h.cur, q.cur), tot: PR.cv(b0.tot, b0.h.cur, q.cur), cx: of[0] ? PD.cxInfo(q.a, of[0].cxd) : null, np: nf[0] ? PR.cv(nf[0].p, nf[0].h.cur, q.cur) : null, cap: b0.r.cap, free: G.filter(x => PD.mkOK(x.mk, q.nat)).flatMap(x => x.rooms.filter(r => tk(r) == k)).reduce((s, r) => s + SR.avail(r, ns), 0) };
    }).filter(x => x && (!q.max || x.p <= +q.max));
    return { key, f: G[0], rows };
  }).filter(o => o.rows.length && o.f.stars >= +q.stars && (!q.board || o.f.board == q.board) && SR.hsMatch(o.f, q));
  const mp = o => Math.min(...o.rows.map(r => r.p)); L.sort((a, b) => q.sort == "p" ? mp(a) - mp(b) : q.sort == "s" ? b.f.stars - a.f.stars : a.f.name.localeCompare(b.f.name));
  return { ns, L };
};
/* ---- transfer ---- */
SR.trList = (fn, pax, q) => { const m = {}; db().all("transfers").filter(fn).filter(x => U.VEH[x.veh] >= pax && PR.supOK(x.sup, "t", q.ag) && PD.mkOK(x.mk, q.nat)).forEach(x => { const k = x.from + "|" + x.to + "|" + x.veh; if (!m[k] || PR.tryP(x.price * PR.pf(q.ag, x.sup, "t"), x.cur) < PR.tryP(m[k].price * PR.pf(q.ag, m[k].sup, "t"), m[k].cur)) m[k] = x; }); return Object.values(m).map(x => ({ ...x, own: SR.own(q.ag, x.sup), price: U.r2(x.price * PR.pf(q.ag, x.sup, "t")) })).sort((a, b) => PR.tryP(a.price, a.cur) - PR.tryP(b.price, b.cur)); };
SR.trPts = ag => U.uniq(db().all("transfers").filter(x => PR.supOK(x.sup, "t", ag)).flatMap(x => [x.from, x.to])).sort((a, b) => a.localeCompare(b, "tr"));
SR.transfers = q => { const px = Math.max(1, +q.pax || 1); return SR.trList(x => (x.from == q.f && x.to == q.to) || (x.from == q.to && x.to == q.f), px, q); };
SR.trForZone = (zone, pax, city, q) => { let L = SR.trList(x => x.to == zone || x.from == zone || (x.allIl && city && U.norm(x.allIl) == U.norm(city)), pax, q); return L.filter(x => !x.allIl || !L.some(y => !y.allIl && y.from == x.from && y.veh == x.veh)); };
SR.trItem = (x, m, a, b, q) => ({ kind: "t", cxd: x.cxd ?? 1, tfid: x.id, sup: x.sup, desc: `Transfer ${x.from} ↔ ${x.to} · ${x.veh}${m > 1 ? " · gidiş-dönüş" : ""}`, a, b, cur: x.cur, total: U.r2(x.price * PR.pf(q.ag, x.sup, "t")) * m, own: SR.own(q.ag, x.sup) });
/* ---- tur ---- */
SR.tours = (q, px) => {
  const m = {}, s = {}, tq = (q.tq || "").toLowerCase();
  db().all("tours").filter(x => PR.supOK(x.sup, "u", q.ag) && PD.mkOK(x.mk, q.nat) && PR.itCh(q.ag, x) && x.dates.includes(q.d) && (!tq || [x.name, x.city].some(v => v.toLowerCase().includes(tq)))).forEach(x => { const k = x.name.toLowerCase() + "|" + x.city.toLowerCase(); s[k] = (s[k] || 0) + SR.uFree(x, q.d); if (SR.uFree(x, q.d) >= px && (!m[k] || PR.tryP(x.price * PR.pf(q.ag, x.sup, "u"), x.cur) < PR.tryP(m[k].price * PR.pf(q.ag, m[k].sup, "u"), m[k].cur))) m[k] = x; });
  return Object.entries(m).map(([k, x]) => ({ ...x, own: SR.own(q.ag, x.sup), price: U.r2(x.price * PR.pf(q.ag, x.sup, "u")), free: s[k] })).sort((a, b) => PR.tryP(a.price, a.cur) - PR.tryP(b.price, b.cur));
};
SR.tourItem = (o, d, n, g, q) => ({ kind: "u", cxd: o.cxd ?? 2, tid: o.id, sup: o.sup, desc: `Tur: ${o.name} (${o.city})`, a: d, b: "", cur: o.cur, total: U.r2(o.price * PR.pf(q.ag, o.sup, "u")) * n, guests: g, own: SR.own(q.ag, o.sup) });
SR.toursInCity = (city, a, b, pax, q) => { const dts = U.nights(a, U.addD(b, 1)), best = {}; db().all("tours").filter(x => PR.supOK(x.sup, "u", q.ag) && PD.mkOK(x.mk, q.nat) && PR.itCh(q.ag, x) && U.norm(x.city) == U.norm(city)).forEach(x => { const ds = x.dates.filter(d => dts.includes(d) && SR.uFree(x, d) >= pax); if (!ds.length) return; const k = U.norm(x.name); if (!best[k] || PR.tryP(x.price * PR.pf(q.ag, x.sup, "u"), x.cur) < PR.tryP(best[k].price, best[k].cur)) best[k] = { ...x, own: SR.own(q.ag, x.sup), price: U.r2(x.price * PR.pf(q.ag, x.sup, "u")), ds }; }); return Object.values(best); };
/* ---- uçak: yalnızca tedarikçi API'leri (çevrimdışı modelde deterministik simülasyon) ---- */
SR.apiFlights = (from, to, date, px, q) => {
  if (!from || !to || from == to || !date) return []; const base = U.hsh(from + "|" + to + "|" + date), AL = [["TK", "Türk Hava Yolları"], ["PC", "Pegasus"], ["XQ", "SunExpress"], ["VF", "AJet"]], cnt = 2 + parseInt(base.slice(0, 2), 16) % 3, fl = [];
  for (let i = 0; i < cnt; i++) { const h = parseInt(U.hsh(base + i), 16), al = AL[(h >>> 3) % 4]; fl.push({ no: al[0] + (1000 + (h % 8999)), airline: al[1], cxd: (h >>> 13) % 3 == 0 ? -1 : [3, 7, 14][(h >>> 15) % 3], time: `${String(6 + h % 15).padStart(2, "0")}:${String(((h >>> 5) % 4) * 15).padStart(2, "0")}`, base: 45 + (h >>> 7) % 110, seats: 2 + (h >>> 11) % 38 }); }
  const out = {}; db().all("dmcs").filter(s => s.api && s.api.on && PR.supOK(s.id, "f", q.ag)).forEach(s => {
    const c = P.activeC("s", s.id), cur = c.curs.includes("EUR") ? "EUR" : c.curs[0];
    fl.forEach(f => { const k = parseInt(U.hsh(s.id + "|" + f.no + "|" + date), 16) % 17 - 8, p = Math.round(PR.cv(f.base * (1 + k / 100), "EUR", cur) * PR.pf(q.ag, s.id, "f") * 100) / 100, o = { ...f, sup: s.id, price: p, cur, from, to, date, own: SR.own(q.ag, s.id), key: [s.id, f.no, from, to, date].join("|") }; if (f.seats >= px && (!out[f.no] || PR.tryP(p, cur) < PR.tryP(out[f.no].price, out[f.no].cur))) out[f.no] = o; });
  });
  return Object.values(out).sort((a, b) => PR.tryP(a.price, a.cur) - PR.tryP(b.price, b.cur));
};
SR.offerByKey = (k, q) => { if (!k) return null; const [, , f, to, d] = k.split("|"); return SR.apiFlights(f, to, d, 1, q).find(o => o.key == k) || null; };
SR.flItem = (o, n, g) => ({ kind: "f", cxd: o.cxd, sup: o.sup, desc: `Uçuş ${o.no} · ${o.from} → ${o.to} · ${o.airline} · ${o.time}`, a: o.date, b: "", cur: o.cur, total: o.price * n, guests: g, flight: o.key, src: "api", own: o.own });
/* ---- otel kalemleri ve paket ---- */
SR.hotelItems = (G, al, q, names) => al.res.map(({ h, r, tot, cxd, rt, spo }, i) => ({ kind: "h", cxd, hid: h.id, room: r.id, sup: h.sup, desc: `${h.name} – ${r.type} (oda ${i + 1})${rt == "n" ? " · iade edilemez" : ""}${spo ? " · " + spo.name + " −%" + spo.pct : ""}`, a: q.a, b: q.b, ns: U.nights(q.a, q.b), cur: h.cur, total: tot, guests: names[i] || [], ages: q.occ[i].ages, src: h.src || "", own: SR.own(q.ag, h.sup) }));
SR.svOf = ag => (P.activeC("a", ag) || { services: [] }).services;
SR.cursOf = ag => (P.activeC("a", ag) || { curs: U.CUR }).curs;
SR.occN = q => q.occ.reduce((s, o) => s + o.ad + o.ch, 0);
