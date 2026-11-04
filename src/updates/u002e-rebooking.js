/* Yama 1 · Rebooking
   L1 Ters açık artırma (rezervasyon akışının içinde): ücretsiz iptal süresi içindeki otel rezervasyonları açık artırmaya açılır; DMC'ler kendi panelinden fiyat verir.
      Kimse kimseyi görmez: herkesin karşı tarafı book4me ai'dır. Alıcının hiçbir bilgisi olmaz; satış fiyatı, rezervasyon numarası ve voucher değişmez.
      Artırma, mevcut tedarikçinin ücretsiz iptal süresinin son saniyesine kadar açıktır. En düşük geçerli teklif kazanır (eşitlikte ilk veren).
      Mevcut tedarikçinin tutma hakkı vardır (en düşük teklife eşitleyip rezervasyonu tutar). Kazanan teklif onay beklenmeden onaylı sayılır.
      Kazanan veremezse: bizim alış fiyatımız üzerinden cezai şart (varsayılan %10) + yerine koyma farkı DMC'den tahsil edilir. Aynı ürün kuralı kesindir.
      Teklif için teminat zorunludur; DMC puanı A/B/C risk grubunu belirler (C teklif veremez).
   L2 Otomatik fiyat takibi (Product → Fiyat takibi): DMC'nin kontrat/API fiyatlarını izler; artırma açıkken DMC adına otomatik teklif verir,
      artırma bittikten sonra daha iyi fiyat çıkarsa (eşik: %2 ve 10 EUR) rezervasyonu doğrudan değiştirir. İkisi birlikte çalışır.
   Şirket bazlı izinler (rbSrc: rezervasyonları artırmaya açılabilir, rbBid: teklif verebilir) yalnızca Back Office'te görünür ve değişir.
   Not: çevrimdışı tek dosya modelinde artırma aynı tarayıcıda çalışır; firmalar arası canlı artırma sunucuya geçişte açılır. */
const db = () => B4M.db, { ok, no } = B4M.res, PR = B4M.price, P = B4M.parties, PD = B4M.prod, AU = B4M.auth, NT = B4M.notif, Y1 = B4M.y1, FA = B4M.fa;
const RB = B4M.rb = {};
const E = (v, c) => U.r2(PR.cv(+v || 0, c || "EUR", "EUR")), norm = s => U.norm(String(s || "")).replace(/\s+/g, " ").trim();
/* ---- DMC rebooking profili: teminat, puan, izinler ---- */
RB.prof = tid => { const d = db().get("dmcs", tid); if (!d) return null; d.rb = d.rb || {}; const x = d.rb; x.score ??= Y1.prm("rbNewScore"); x.dep ??= 0; x.depCur ??= "EUR"; x.wins ??= 0; x.fails ??= 0; x.src ??= true; x.bid ??= true; x.auto ??= true; x.pen ??= []; return x; };
RB.grp = tid => { const s = RB.prof(tid).score; return s >= Y1.prm("rbA") ? "A" : s >= Y1.prm("rbB") ? "B" : "C"; };
/* teklif tavanı: A grubu teminatın 3 katına, B grubu teminat kadarına kadar; C teklif veremez */
RB.cap = tid => { const p = RB.prof(tid), g = RB.grp(tid), d = E(p.dep, p.depCur); return g == "A" ? d * 3 : g == "B" ? d : 0; };
RB.canBid = (tid, e) => { const p = RB.prof(tid); if (!p) return [0, "Firma bulunamadı."]; if (!p.bid) return [0, "Firmanızın rebooking teklifi verme izni kapalı."]; if (!(E(p.dep, p.depCur) > 0)) return [0, "Teklif verebilmek için teminat gerekir."];
  if (RB.grp(tid) == "C") return [0, "Risk grubu C: teklif veremezsiniz."]; if (e != null && e > RB.cap(tid)) return [0, "Teklif tutarı teminat limitinizi aşıyor."]; return [1, ""]; };
RB.setCo = (tid, o) => { const u = B4M.app.user(); if (B4M.ctx.org != "h" || !(u.role == "admin" || AU.can("rb"))) return no("Bu ayarlar yalnızca Back Office'te değişir."); const p = RB.prof(tid);
  ["src", "bid"].forEach(k => { if (k in o) p[k] = !!o[k]; }); if ("dep" in o) { const v = +o.dep; if (!(v >= 0)) return no("Geçerli bir teminat tutarı girin."); p.dep = v; p.depCur = o.depCur || p.depCur; }
  if ("score" in o) { const v = +o.score; if (!(v >= 0 && v <= 100)) return no("Puan 0 ile 100 arasında olmalı."); p.score = v; } B4M.audit.log("rb.company", tid, JSON.stringify(o), "P"); return ok("Rebooking ayarları kaydedildi."); };
RB.setAuto = (tid, on) => { const u = B4M.app.user(); if (B4M.ctx.org != "s" || B4M.app.tidOf(B4M.ctx.dmc) != tid || !(u.role == "admin" || AU.can("rbt"))) return no("Fiyat takibi için yetkiniz yok."); RB.prof(tid).auto = !!on; return ok(on ? "Otomatik fiyat takibi açıldı." : "Otomatik fiyat takibi kapatıldı."); };
/* ---- ürün ve uygunluk ---- */
RB.occ = b => { const ch = (b.ages || []).length, ad = Math.max(1, ((b.guests || []).filter(Boolean).length || 2) - ch); return { ad, ch, ages: b.ages || [] }; };
RB.end = b => b.sdl ? b.sdl + " 23:59" : "";
RB.eligible = b => { if (!b || b.kind != "h" || b.status != "Onaylı" || !b.oid || b.own || !b.sdl) return false; if (U.now() > RB.end(b) || b.a <= U.today()) return false; const h = db().get("hotels", b.hid); if (!h) return false; const sp = RB.prof(B4M.app.tidOf(b.sup)); return !!sp && sp.src; };
RB.of = b => db().find("rbAuctions", x => x.bid == b.id && x.st == "Açık");
RB.snap = b => { const h = db().get("hotels", b.hid), r = (h.rooms || []).find(r => r.id == b.room) || {}; return { key: FA.key(h), type: r.type || "", tn: norm(r.type), board: h.board, a: b.a, b: b.b, occ: RB.occ(b), dl: b.dl, nat: b.nat || "" }; };
RB.open = b => { if (!RB.eligible(b) || RB.of(b)) return null; const s = RB.snap(b), x = db().add("rbAuctions", { bid: b.id, no: b.no, hid: b.hid, ...s, end: RB.end(b), base: { amt: b.cost, cur: b.costCur, e: E(b.cost, b.costCur) }, orig: b.sup, st: "Açık", at: U.now(), keep: null, win: null });
  RB.autoBids(x); return x; };
/* aynı ürün kuralı: aynı otel (ad+şehir), aynı oda tipi, aynı pansiyon, aynı tarihler, aynı kişi sayısı, eşit veya daha iyi iptal şartı */
RB.match = (x, h) => { if (FA.key(h) != x.key || h.board != x.board || !PR.supOK(h.sup, "h")) return []; const ns = U.nights(x.a, x.b), q = { ag: 0, nat: x.nat || "", a: x.a, b: x.b }, o = x.occ;
  return h.rooms.filter(r => norm(r.type) == (x.tn || norm(x.type)) && o.ad + o.ch <= r.cap && o.ad <= (r.ma ?? r.cap) && o.ch <= (r.mc ?? r.cap) && B4M.search.avail(r, ns) > 0 && (!q.nat || PD.mkOK(h.mk, q.nat))).map(r => { const cx = PD.rcx(h, r), sdl = PD.supDL(x.a, cx);
    if (x.dl !== null && (sdl == null || sdl < x.dl)) return null; const tot = PD.stayT(h, r, ns, "r", q, o); return tot == null ? null : { h, r, tot: U.r2(tot), cur: h.cur, e: E(tot, h.cur), sdl }; }).filter(Boolean); };
RB.myHotels = (x, tid) => db().all("hotels").filter(h => B4M.app.tidOf(h.sup) == tid && FA.key(h) == x.key);
RB.bids = aid => db().where("rbBids", y => y.aid == aid && y.st == "Geçerli").sort((a, b) => a.e - b.e || a.id - b.id);
RB.low = aid => RB.bids(aid)[0] || null;
RB.best = x => { const l = RB.low(x.id); return l ? l.e : x.base.e; };
/* ---- teklif ---- */
RB.bid = (aid, tid, o, auto) => { const x = db().get("rbAuctions", aid); if (!x || x.st != "Açık") return no("Bu artırma kapandı."); if (U.now() > x.end) return no("Artırma süresi doldu.");
  if (B4M.app.tidOf(x.orig) == tid) return no("Mevcut tedarikçi teklif veremez; tutma hakkını kullanabilir.");
  if (!auto) { const u = B4M.app.user(); if (B4M.ctx.org != "s" || B4M.app.tidOf(B4M.ctx.dmc) != tid || !(u.role == "admin" || AU.can("rb"))) return no("Rebooking teklifi için yetkiniz yok."); }
  const h = db().get("hotels", +o.hid); if (!h || B4M.app.tidOf(h.sup) != tid) return no("Otel bulunamadı."); const m = RB.match(x, h).find(c => c.r.id == +o.room); if (!m) return no("Aynı ürün kuralı: oda tipi, pansiyon, tarih, kişi sayısı ve iptal şartı aynı olmalı ve müsaitlik bulunmalı.");
  const amt = U.r2(+o.amt), e = E(amt, h.cur); if (!(amt > 0)) return no("Teklif tutarını girin."); const [cb, why] = RB.canBid(tid, e); if (!cb) return no(why);
  const best = RB.best(x); if (!(e < best - 0.004)) return no("Teklif, mevcut en iyi fiyattan ({b}) düşük olmalı.", { b: I.fm(best, "EUR") });
  db().where("rbBids", y => y.aid == aid && y.tid == tid && y.st == "Geçerli").forEach(y => y.st = "Geçildi");
  const y = db().add("rbBids", { aid, tid, sup: h.sup, hid: h.id, room: m.r.id, amt, cur: h.cur, e, sdl: m.sdl, auto: !!auto, at: U.now(), st: "Geçerli" });
  if (x.keep && x.keep.e > e) x.keep = null; B4M.audit.log("rb.bid", x.no, `${I.fm(amt, h.cur)}${auto ? " (oto)" : ""}`, tid); return ok("Teklifiniz kaydedildi. Şu an en iyi teklif sizin.", {}, { y }); };
/* tutma hakkı: mevcut tedarikçi en düşük teklife eşitler */
RB.keep = (aid, tid) => { const x = db().get("rbAuctions", aid); if (!x || x.st != "Açık") return no("Bu artırma kapandı."); if (B4M.app.tidOf(x.orig) != tid || B4M.ctx.org != "s" || B4M.app.tidOf(B4M.ctx.dmc) != tid) return no("Tutma hakkı yalnızca mevcut tedarikçide."); const l = RB.low(aid); if (!l) return no("Henüz teklif yok; rezervasyon zaten sizde.");
  const b = db().get("bookings", x.bid); x.keep = { e: l.e, amt: U.r2(PR.cv(l.e, "EUR", b.costCur)), cur: b.costCur, at: U.now() }; B4M.audit.log("rb.keep", x.no, I.fm(x.keep.amt, x.keep.cur), tid); return ok("Tutma hakkı kullanıldı: rezervasyon {a} ile sizde kalır (daha düşük teklif gelmezse).", { a: I.fm(x.keep.amt, x.keep.cur) }); };
/* ---- değişim: rezervasyon yeni tedarikçiye geçer, alıcı tarafı değişmez ---- */
RB.swap = (b, y, why, aid) => { const fromE = E(b.cost, b.costCur), from = b.sup, gain = U.r2(fromE - y.e);
  b.rbH = b.rbH || []; b.rbH.push({ at: U.now(), from: { sup: b.sup, hid: b.hid, room: b.room, cost: b.cost, cur: b.costCur, sdl: b.sdl }, why });
  Object.assign(b, { sup: y.sup, hid: y.hid, room: y.room, cost: y.amt, costCur: y.cur, sdl: y.sdl, sellerT: B4M.app.tidOf(y.sup), dbuy: undefined });
  b.mg = { ...(b.mg || {}), rb: U.r2((b.mg && b.mg.rb || 0) + gain) };
  db().add("rbRev", { aid: aid || 0, bid: b.id, no: b.no, e: gain, kind: why, from, to: y.sup, at: U.now() });
  const ft = B4M.app.tidOf(from), wt = B4M.app.tidOf(y.sup), wp = RB.prof(wt); wp.wins++;
  NT.push({ tid: ft, depts: ["Rezervasyon", "Product"], perms: ["r"], title: "Rezervasyon {no}, ücretsiz iptal süresi içinde book4me ai tarafından iptal edildi.", tp: { no: b.no }, kind: "rbx", ref: b.id });
  NT.push({ tid: wt, depts: ["Rezervasyon", "Product"], perms: ["rb"], title: "Yeni rezervasyon {no} onaylı olarak size geçti (book4me ai).", tp: { no: b.no }, kind: "rbw", ref: b.id });
  B4M.audit.log("rb.swapped", b.no, `${I.fm(gain, "EUR")} · ${why}`, "P"); return gain; };
RB.close = (aid, force) => { const x = db().get("rbAuctions", aid); if (!x || x.st != "Açık") return no(""); if (!force && U.now() <= x.end) return no("Artırma hâlâ açık.");
  const b = db().get("bookings", x.bid); if (!b || b.status != "Onaylı") { x.st = "İptal"; return ok("Rezervasyon iptal edildiği için artırma kapandı."); }
  const l = RB.low(aid); x.closed = U.now();
  if (!l) { x.st = "Değişmedi"; return ok("Teklif gelmedi; rezervasyon mevcut tedarikçide kaldı."); }
  if (x.keep && x.keep.e <= l.e) { const gain = U.r2(E(b.cost, b.costCur) - x.keep.e); b.cost = x.keep.amt; b.mg = { ...(b.mg || {}), rb: U.r2((b.mg && b.mg.rb || 0) + gain) };
    db().add("rbRev", { aid, bid: b.id, no: b.no, e: gain, kind: "keep", from: b.sup, to: b.sup, at: U.now() }); x.st = "Tutuldu"; return ok("Mevcut tedarikçi tutma hakkını kullandı; alış fiyatı düştü. Kazanç {g}.", { g: I.fm(gain, "EUR") }); }
  const gain = RB.swap(b, l, "auction", aid); l.st = "Kazandı"; x.win = l.id; x.st = "Değişti"; RB.bids(aid).forEach(y => { if (y.id != l.id) y.st = "Kaybetti"; });
  return ok("Artırma kapandı; rezervasyon yeni tedarikçiye onaylı olarak geçti. Rebooking geliri {g}.", { g: I.fm(gain, "EUR") }); };
/* kazanan veremezse: cezai şart + yerine koyma farkı DMC'den tahsil edilir */
RB.fail = (bid, repAmt, repCur, note) => { const u = B4M.app.user(); if (B4M.ctx.org != "h" || !(u.role == "admin" || AU.can("rb"))) return no("Bu işlem Back Office'te yapılır."); const b = db().get("bookings", bid); if (!b || !(b.rbH || []).length) return no("Bu rezervasyon rebooking ile değişmemiş.");
  const tid = B4M.app.tidOf(b.sup), p = RB.prof(tid), buyE = E(b.cost, b.costCur), pen = U.r2(buyE * Y1.prm("rbPenalty") / 100), rep = repAmt ? E(repAmt, repCur || "EUR") : buyE, diff = U.r2(Math.max(0, rep - buyE));
  p.fails++; p.score = Math.max(0, p.score - 20); p.pen.push({ bid: b.id, no: b.no, pen, diff, total: U.r2(pen + diff), at: U.now(), note: note || "", st: "Tahsil edilecek" });
  db().add("rbRev", { aid: 0, bid: b.id, no: b.no, e: pen, kind: "penalty", from: b.sup, to: b.sup, at: U.now() });
  if (repAmt) { b.rbH.push({ at: U.now(), from: { sup: b.sup, hid: b.hid, room: b.room, cost: b.cost, cur: b.costCur }, why: "replace" }); b.cost = U.r2(+repAmt); b.costCur = repCur || b.costCur; }
  NT.push({ tid, depts: ["Muhasebe", "Rezervasyon"], perms: ["acc"], title: "Rebooking {no}: hizmet verilemedi. Cezai şart {p} ve yerine koyma farkı {d} tahsil edilecek.", tp: { no: b.no, p: I.fm(pen, "EUR"), d: I.fm(diff, "EUR") }, kind: "rbpen", ref: b.id });
  B4M.audit.log("rb.failed", b.no, `${pen}+${diff}`, "P"); return ok("Cezai şart {p} + fark {d} = {t} DMC'ye borç yazıldı; puanı {s}.", { p: I.fm(pen, "EUR"), d: I.fm(diff, "EUR"), t: I.fm(pen + diff, "EUR"), s: p.score }); };
/* ---- L2: otomatik fiyat takibi ---- */
RB.trackers = () => db().where("dmcs", d => !d.parent).filter(d => { const p = RB.prof(d.id); return p.auto && p.bid && RB.canBid(d.id)[0]; });
RB.autoBids = x => { let n = 0; RB.trackers().forEach(d => { if (B4M.app.tidOf(x.orig) == d.id) return; const C = RB.myHotels(x, d.id).flatMap(h => RB.match(x, h)).sort((a, b) => a.e - b.e)[0]; if (!C) return;
  const mine = db().find("rbBids", y => y.aid == x.id && y.tid == d.id && y.st == "Geçerli"); if (mine && mine.e <= C.e) return; if (C.e < RB.best(x) - 0.004 && RB.bid(x.id, d.id, { hid: C.h.id, room: C.r.id, amt: C.tot }, 1).ok) n++; }); return n; };
/* artırma bittikten sonra: daha iyi fiyat eşiği geçerse doğrudan değişim (yalnızca mevcut tedarikçinin ücretsiz iptali hâlâ açıksa) */
RB.after = b => { if (!b || b.kind != "h" || b.status != "Onaylı" || b.own || !b.sdl || U.now() > RB.end(b) || b.a <= U.today() || RB.of(b)) return null; const x = { ...RB.snap(b), orig: b.sup }, cur = E(b.cost, b.costCur);
  let best = null; RB.trackers().forEach(d => { if (B4M.app.tidOf(b.sup) == d.id) return; RB.myHotels(x, d.id).flatMap(h => RB.match(x, h)).forEach(c => { if (c.e <= RB.cap(d.id) && (!best || c.e < best.e)) best = c; }); });
  if (!best) return null; const g = cur - best.e; if (g < Y1.prm("rbMinEur") || g / cur * 100 < Y1.prm("rbMinPct")) return null;
  return RB.swap(b, { sup: best.h.sup, hid: best.h.id, room: best.r.id, amt: best.tot, cur: best.cur, e: best.e, sdl: best.sdl }, "track"); };
/* ---- tarama: yeni artırmalar, süresi dolanları kapatma, otomatik teklifler ---- */
RB.sweep = () => { if (!db()) return 0; let n = 0;
  db().where("rbAuctions", x => x.st == "Açık").forEach(x => { const b = db().get("bookings", x.bid); if (!b || b.status != "Onaylı" || b.a != x.a || b.b != x.b || b.hid != x.hid && !(b.rbH || []).length) { x.st = "İptal"; n++; return; } if (U.now() > x.end) { RB.close(x.id); n++; } else n += RB.autoBids(x); });
  db().where("bookings", b => b.kind == "h" && b.status == "Onaylı" && !b.own && b.sdl).forEach(b => { if (RB.of(b)) return; const done = db().find("rbAuctions", x => x.bid == b.id && x.a == b.a && x.b == b.b && x.st != "İptal"); if (!done) { if (RB.open(b)) n++; } else if (RB.after(b) != null) n++; });
  return n; };
RB.list = () => db().all("rbAuctions").slice().reverse();
/* DMC'nin göreceği: kendi teklifleri, en iyi fiyat ve sırası; kimsenin adı yok */
RB.forDmc = tid => db().where("rbAuctions", x => x.st == "Açık" && B4M.app.tidOf(x.orig) != tid).map(x => { const H = RB.myHotels(x, tid), C = H.flatMap(h => RB.match(x, h)).sort((a, b) => a.e - b.e), mine = db().find("rbBids", y => y.aid == x.id && y.tid == tid && y.st == "Geçerli"), l = RB.low(x.id);
  return { x, can: C, mine, best: RB.best(x), lead: !!(mine && l && l.id == mine.id), n: RB.bids(x.id).length }; }).filter(r => r.can.length || r.mine);
RB.mineOrig = tid => db().where("rbAuctions", x => x.st == "Açık" && B4M.app.tidOf(x.orig) == tid).map(x => ({ x, low: RB.low(x.id), b: db().get("bookings", x.bid) }));
RB.revOf = m => db().where("rbRev", r => !m || r.at.slice(0, 7) == m);
RB.score = tid => { const p = RB.prof(tid); return { ...p, grp: RB.grp(tid), cap: RB.cap(tid) }; };
/* rezervasyon akışı: yeni rezervasyonda artırma hemen açılır; açılışta ve gece işinde tarama */
const baseEmit = B4M.events.emit; B4M.events.emit = function (ev, ...a) { const e = baseEmit.call(this, ev, ...a); try { if (db() && !RB.busy && /^(reservation\.created|booking\.(modified|cancelled))/.test(ev)) { RB.busy = 1; try { RB.sweep(); } finally { RB.busy = 0; } } } catch (er) { console.error(er); } return e; };
Y1.hooks.push({ ready() { RB.sweep(); } });
if (B4M.jobs && B4M.jobs.nightly) { const bn = B4M.jobs.nightly; B4M.jobs.nightly = (...a) => { const r = bn(...a); try { RB.sweep(); } catch (e) { console.error(e); } return r; }; }
