/* Rezervasyon: alış ve satış birlikte zorunlu, rezervasyon no ve alt numaralar, değişiklik ve iptal, ödenmeyenlerin otomatik iptali. */
const BK = B4M.book = {};
const db = () => B4M.db, { ok, no } = B4M.res, PR = B4M.price, PD = B4M.prod, P = B4M.parties, SR = B4M.search;
const now = () => U.now(), today = () => U.today();
BK.acc = id => db().get("accounts", id) || {};
BK.isBuyer = ag => !!BK.acc(P.rootOf("a", ag)).buyer;
BK.oBks = o => o.items.map(id => db().get("bookings", id)).filter(Boolean);
BK.oNet = o => U.r2(BK.oBks(o).filter(b => b.status == "Onaylı" || b.status == "İptal (cezalı)").reduce((s, b) => s + b.total - b.comm, 0));
BK.oDue = o => Math.max(0, U.r2(BK.oNet(o) - o.paid));
BK.oRef = o => Math.max(0, U.r2(o.paid - BK.oNet(o)));
BK.oSt = o => o.auto ? "Ödenmediği için iptal edildi" : o.pay && o.pay.state == "Onay bekliyor" ? "Havale onayı bekliyor" : BK.oBks(o).every(b => b.status.startsWith("İptal")) && !BK.oDue(o) ? (o.paid ? "İptal · iade" : "İptal") : !BK.oDue(o) ? "Ödendi" : o.paid ? "Kısmi ödendi" : "Ödeme bekliyor";
BK.supPay = b => { let x = U.addD(U.addD(b.b || b.a, 14), 1); while (new Date(x + "T12:00:00Z").getUTCDay() != 5) x = U.addD(x, 1); return x; };
BK.ledger = (ag, cur, tt, tp, dbv, cr, due) => db().add("ledger", { d: today(), due: due || "", ag, cur, t: tt, tp: tp || {}, db: U.r2(dbv || 0), cr: U.r2(cr || 0), tid: P.tidFor("a", ag) });
BK.agBals = id => { const m = {}; db().where("ledger", l => l.ag == id).forEach(l => m[l.cur] = (m[l.cur] || 0) + l.db - l.cr); return m; };
/* tedarikçiye bildirim e-postası */
BK.mailTo = (b, ev) => {
  const s = db().get("dmcs", b.sup); if (!s) return;
  B4M.mail.send({ dmc: b.sup, sup: s.id, to: s.email || "", subj: `${ev} ${b.no || "#" + b.id} – ${b.desc}`, tid: B4M.app.tidOf(b.sup),
    body: `Acente: ${P.accName(b.ag)}\nHizmet: ${b.desc}\nTarih: ${b.a}${b.b ? " → " + b.b : ""}\nRezervasyon no: ${b.no || "#" + b.id}\nKişiler: ${(b.guests || []).join(", ") || "—"}\nMilliyet: ${b.nat ? PD.natN(b.nat) : "—"}${b.vch ? "\nVoucher: " + b.vch : ""}\nTutar: ${I.fm(b.cost ?? b.total, b.costCur || b.cur)}\nAcente referansı: ${b.ref || "—"}\nNot: ${b.note || "—"}${b.fl ? "\nUçuş: " + b.fl : ""}\nDurum: ${ev}` });
};
/* alış maliyeti (DMC'nin alış-satış farkıyla) */
BK.bkCost = b => { const m = PR.dmcMg(b.sup, b.kind); return m == null ? null : { amt: U.r2(b.cost / (1 + m / 100)), cur: b.costCur }; };
/* satış hesabından rezervasyon oluştur. o = {ag, items, label, pm, cur, nat, note, ref, fl, by, resale:{to,amt,cur}} */
BK.place = o => {
  const ag = o.ag, cur = o.cur, buyer = BK.isBuyer(ag);
  if (!o.items.length) return no("Rezervasyon için hizmet seçin.");
  if (buyer && !o.noResale) { if (!((o.resale || {}).to || "").trim()) return no("Satıldığı şirketi / müşteriyi girin; alış ve satış tamamlanmadan rezervasyon oluşmaz."); if (!(+(o.resale || {}).amt > 0)) return no("Müşteriye satış tutarını girin; alış ve satış tamamlanmadan rezervasyon oluşmaz."); }
  const pi = PD.payInfo(o.items), id = db().seq(), no2 = `B4M${today().slice(2, 4)}-${U.pad(db().counter("rn"), 6)}`, ids = []; let tot = 0;
  const rsS = o.items.reduce((a, it) => a + U.r2(PR.cv(it.total, it.cur, cur)), 0) || 1, buyerT = P.tidFor("a", ag);
  o.items.forEach((it, i) => {
    const total = U.r2(PR.cv(it.total, it.cur, cur)), cx = it.cxd ?? 0, f = PR.pf(ag, it.sup, it.kind), cost = U.r2(it.total / f);
    const b = { ...it, id: db().seq(), no: `${no2}-${i + 1}`, oid: id, ag, by: o.by || "", nat: o.nat, status: "Onaylı", ns: it.ns || [], note: o.note || "", ref: o.ref || "", fl: o.fl || "", cost, costCur: it.cur, mg: PR.margins(it.sup, ag, it.kind, cost, it.cur, total, cur), total, cur, comm: 0, own: PR.agOwner(ag) || (PR.isOwnBuy(ag, it.sup) ? P.rootOf("s", it.sup) : 0), dl: PD.agDL(it.a, cx), sdl: PD.supDL(it.a, cx), sellerT: B4M.app.tidOf(it.sup), buyerT, at: now() };
    const c = BK.bkCost(b); if (c) b.dbuy = c; if (buyer && o.resale && !o.noResale) b.resale = { amt: U.r2(+o.resale.amt * total / rsS), cur: o.resale.cur, to: String(o.resale.to).trim() };
    db().add("bookings", b); if (B4M.ops) B4M.ops.fromBooking(b); if (B4M.acc && B4M.acc.commOnBook) B4M.acc.commOnBook(b);
    ids.push(b.id); tot += total; B4M.events.emit("booking.confirmed", b.no, it.total, it.cur, it.sup); BK.mailTo(b, "Yeni rezervasyon");
  });
  tot = U.r2(tot);
  const ord = db().add("orders", { id, no: no2, ag, nat: o.nat, cur, label: o.label, items: ids, total: tot, comm: 0, due: pi.due, imm: pi.imm, at: o.at || now(), paid: 0, pay: null, auto: false, inv: null, tid: buyerT });
  BK.ledger(ag, cur, "Rezervasyon {no} – {l}", { no: no2, l: o.label }, tot, 0, pi.due); B4M.events.emit("reservation.created", no2, tot, cur);
  let msg = ["Rezervasyon {no} oluşturuldu ve kesinleşti ({n} hizmet).", { no: no2, n: ids.length }], extra = null;
  if (o.pm == "pre") extra = B4M.acc.preApply(ord, pi.imm);
  else if (o.pm) { const dc = B4M.acc.doPay(ord, o.pm == "bal" ? "Bakiye" : "Kredi kartı", tot); extra = [o.pm == "bal" ? "Tutar bakiyenizden düşüldü." : "Kartla ödendi.", {}]; if (dc) extra[0] += " " + "Voucher ve fatura oluşturuldu."; }
  else extra = ["Son ödeme tarihi {d}.", { d: I.fd(pi.due) }];
  return ok(t(msg[0], msg[1]) + " " + t(extra[0], extra[1]), null, { order: ord });
};
/* ödeme yöntemine karar ver: ön ödeme → yeterliyse bloke; iade edilemezse bakiye veya kart */
BK.finish = o => {
  const need = U.r2(o.items.reduce((s, it) => s + U.r2(PR.cv(it.total, it.cur, o.cur)), 0));
  if (B4M.acc.preOf(o.ag)) { if (B4M.acc.preAvail(o.ag, o.cur) >= need - 0.004) return BK.place({ ...o, pm: "pre" }); o.warn = ["Ön ödeme bakiyeniz yetersiz (kullanılabilir {a}); diğer ödeme yöntemleri kullanılacak.", { a: I.fm(B4M.acc.preAvail(o.ag, o.cur), o.cur) }]; }
  const pi = PD.payInfo(o.items); if (!pi.imm) return BK.place(o);
  if (B4M.acc.balAv(o.ag, o.cur) >= need - 0.004) return BK.place({ ...o, pm: "bal" });
  return { ok: false, payStep: { need }, msg: "Kredi kartıyla hemen ödeme gerekli" };
};
/* ---- iptal ---- */
BK.cancel = id => {
  const b = db().get("bookings", id); if (!b || b.status != "Onaylı") return no("Rezervasyon aktif değil.");
  const pen = b.dl === null || (b.dl !== undefined && today() > b.dl), o = db().get("orders", b.oid);
  b.status = pen ? "İptal (cezalı)" : "İptal"; b.cxAt = now();
  if (!pen) { BK.ledger(b.ag, b.cur, "İptal {no} – tutar iadesi", { no: b.no || "#" + id }, 0, b.total); if (b.paShared) { b.paShared = false; BK.ledger(P.parentOf("a", b.ag), b.cur, "Alt acente kârı geri alındı · {no}", { no: b.no }, b.mg.pa, 0); } }
  if (B4M.acc.commOnCancel) B4M.acc.commOnCancel(b, pen);
  if (B4M.ops) B4M.ops.onBookingCancel(b);
  B4M.events.emit("booking.cancelled", id, -(b.cost ?? b.total), b.costCur || b.cur, b.sup); BK.mailTo(b, "Rezervasyon iptali");
  const rf = o ? BK.oRef(o) : 0;
  return pen ? ok(b.dl == null ? "{no} iptal edildi. Hizmet iade edilemez olduğu için ücret iade edilmez. Tedarikçiye bildirildi." : "{no} iptal edildi. Son ücretsiz iptal tarihi ({d}) geçtiği için ücret iade edilmez. Tedarikçiye bildirildi.", { no: b.no, d: I.fd(b.dl) })
    : ok(rf ? "{no} ücretsiz iptal edildi ve tedarikçiye bildirildi. {r} bakiyenize iade edildi." : "{no} ücretsiz iptal edildi ve tedarikçiye bildirildi.", { no: b.no, r: I.fm(rf, b.cur) });
};
/* süresinde ödenmeyen rezervasyonların iptali ve ön ödeme düşümü (sunucuda gece işi) */
BK.sweep = () => {
  let ch = 0;
  db().all("orders").forEach(o => { if (o.hold && !o.auto && BK.oDue(o) && o.due < today() && B4M.acc.preDeduct(o)) ch = 1; });
  db().all("orders").forEach(o => {
    if (o.auto || o.due >= today() || !BK.oDue(o) || (o.pay && o.pay.state == "Onay bekliyor")) return; o.auto = true; ch = 1;
    BK.oBks(o).forEach(b => { if (b.status != "Onaylı") return; b.status = "İptal (ödenmedi)"; BK.ledger(b.ag, b.cur, "Ödenmediği için iptal {no}", { no: b.no || "#" + b.id }, 0, b.total); if (B4M.acc.commOnCancel) B4M.acc.commOnCancel(b, false); B4M.events.emit("booking.cancelled.unpaid", b.id, -(b.cost ?? b.total), b.costCur || b.cur, b.sup); BK.mailTo(b, "Rezervasyon iptali (ödeme yapılmadı)"); });
  });
  return ch;
};
/* ---- değişiklik ---- */
BK.mdMode = b => b.dl === null ? "nr" : b.dl && today() > b.dl ? "late" : "free";
BK.mdInit = b => ({ names: [...(b.guests || [])], note: b.note || "", a: b.a, b: b.b, rid: b.room, rt: b.cxd < 0 ? "n" : "r" });
BK.mdQuote = (b, s) => {
  if (b.kind != "h") return { ok: true, price: false }; const h = PD.H(b.hid), r = h && h.rooms.find(x => x.id == +s.rid); if (!r) return { ok: false, msg: "Oda bulunamadı." };
  const ns = U.nights(s.a, s.b); if (!ns.length) return { ok: false, msg: "Çıkış tarihi girişten sonra olmalı." }; if (s.a < today()) return { ok: false, msg: "Geçmiş tarihe değişiklik yapılamaz." }; if ((b.guests || []).length > r.cap) return { ok: false, msg: "Misafir sayısı bu odanın kapasitesini aşıyor." };
  if (SR.avail(r, ns, b.id) < 1) return { ok: false, msg: "Seçilen tarihlerde bu odada müsaitlik yok." };
  const q = { a: s.a, b: s.b, nat: b.nat || "TR", ag: b.ag }; if (!PD.mkOK(h.mk, q.nat)) return { ok: false, msg: "Bu oda misafirin milliyetine satılmıyor." };
  const tot = PD.stayT(h, r, ns, s.rt, q, null); if (tot == null) return { ok: false, msg: s.rt == "n" ? "Bu tarihlerde iade edilemez fiyat yok." : "Bu tarihlerde fiyat tanımlı değil." };
  const total = U.r2(PR.cv(tot, h.cur, b.cur)); return { ok: true, price: true, ns, r, h, total, cost: U.r2(tot / PR.pf(b.ag, h.sup, "h")), cxd: s.rt == "n" ? -1 : PD.rcx(h, r), diff: U.r2(total - b.total) };
};
BK.mdChanges = (b, s, q) => { const c = []; if ((s.names || []).join("|") != (b.guests || []).join("|")) c.push("misafir isimleri"); if ((s.note || "") != (b.note || "")) c.push("not"); if (q.price) { if (s.a != b.a || s.b != b.b) c.push(`tarih ${b.a} → ${b.b} yerine ${s.a} → ${s.b}`); if (+s.rid != b.room || (s.rt == "n") != (b.cxd < 0)) c.push(`oda ${q.r.type}${s.rt == "n" ? " (iade edilemez)" : ""}`); } return c; };
BK.mdApply = (b, s, q, txt, by) => {
  const o = db().get("orders", b.oid); b.guests = [...s.names]; b.note = s.note;
  if (q.price && (s.a != b.a || s.b != b.b || q.r.id != b.room || q.cxd != b.cxd)) {
    const diff = q.diff, on = (b.desc.match(/oda (\d+)/) || [0, 1])[1];
    Object.assign(b, { a: s.a, b: s.b, ns: q.ns, room: q.r.id, cxd: q.cxd, desc: `${q.h.name} – ${q.r.type} (oda ${on})${q.cxd < 0 ? " · iade edilemez" : ""}`, total: q.total, cost: q.cost, dl: PD.agDL(s.a, q.cxd), sdl: PD.supDL(s.a, q.cxd), mg: PR.margins(b.sup, b.ag, "h", q.cost, b.costCur, q.total, b.cur) });
    const c2 = BK.bkCost(b); if (c2) b.dbuy = c2;
    if (o && diff) { o.total = U.r2(o.total + diff); BK.ledger(b.ag, b.cur, diff > 0 ? "Değişiklik farkı · {no}" : "Değişiklik iadesi · {no}", { no: b.no }, diff > 0 ? diff : 0, diff < 0 ? -diff : 0, o.due); if (b.dl && b.dl < o.due) o.due = b.dl < today() ? today() : b.dl; if (diff > 0 && b.dl === null) o.due = today(); }
    if (o && b.dl === null && BK.oDue(o) > 0) o.due = today();
    if (B4M.acc.commOnModify) B4M.acc.commOnModify(b);
  }
  (b.mods = b.mods || []).push({ at: now(), by, txt }); B4M.events.emit("booking.modified", b.no, q.diff || 0, b.cur, b.sup); BK.mailTo(b, "Rezervasyon değişikliği (" + txt + ")");
};
BK.mdSubmit = (id, s, by) => {
  const b = db().get("bookings", id), m = BK.mdMode(b), q = m == "late" ? { ok: true, price: false } : BK.mdQuote(b, s); if (!q.ok) return no(q.msg);
  if (s.names.some(x => !x.trim())) return no("Misafir isimleri boş olamaz."); const ch = BK.mdChanges(b, s, q); if (!ch.length) return no("Değişiklik yok.");
  if (b.kind == "f" && ch.includes("misafir isimleri")) return no("Uçak biletlerinde isim değişikliği yapılamaz; yalnızca not güncellenebilir.");
  const txt = ch.join(", ") + (q.diff ? ` · fark ${I.fm(q.diff, b.cur)}` : "");
  if (m == "nr") {
    if (b.pendingMod) return no("Bu rezervasyon için bekleyen bir talep var.");
    const r = db().add("modreq", { bid: b.id, sup: b.sup, ag: b.ag, at: now(), by, s: U.clone(s), q: q.price ? { price: true, ns: q.ns, rid: q.r.id, total: q.total, cost: q.cost, cxd: q.cxd, diff: q.diff } : { price: false }, txt, state: "Bekliyor", sellerT: b.sellerT, buyerT: b.buyerT });
    b.pendingMod = r.id; BK.mailTo(b, "Değişiklik talebi (" + txt + ")"); B4M.events.emit("booking.modify.requested", b.no, 0, b.cur, b.sup); return ok("İade edilemez rezervasyon: değişiklik talebi tedarikçi onayına gönderildi.");
  }
  BK.mdApply(b, s, q, txt, by);
  return ok(q.diff > 0 ? "Değişiklik uygulandı ve tedarikçiye bildirildi. Fark {d} ödenecek tutara eklendi." : q.diff < 0 ? "Değişiklik uygulandı ve tedarikçiye bildirildi. {d} cari hesabınıza iade olarak işlendi." : "Değişiklik uygulandı ve tedarikçiye bildirildi.", { d: I.fm(Math.abs(q.diff || 0), b.cur) });
};
BK.mrOk = id => {
  const r = db().get("modreq", id), b = db().get("bookings", r.bid); if (b.status != "Onaylı") return no("Rezervasyon artık aktif değil."); let q = { price: false };
  if (r.q.price) { const h = PD.H(b.hid), rm = h.rooms.find(x => x.id == r.q.rid); if (SR.avail(rm, r.q.ns, b.id) < 1) return no("Müsaitlik kalmadı; talebi reddedin."); q = { ...r.q, price: true, r: rm, h }; }
  BK.mdApply(b, r.s, q, r.txt + " · tedarikçi onaylı", P.dmcName(r.sup)); r.state = "Onaylandı"; r.done = now(); b.pendingMod = null; return ok("Değişiklik onaylandı ve uygulandı.");
};
BK.mrNo = id => { const r = db().get("modreq", id), b = db().get("bookings", r.bid); r.state = "Reddedildi"; r.done = now(); b.pendingMod = null; (b.mods = b.mods || []).push({ at: now(), by: P.dmcName(r.sup), txt: "Değişiklik talebi reddedildi: " + r.txt }); B4M.events.emit("booking.modify.rejected", b.no, 0, b.cur, b.sup); return ok("Talep reddedildi; acente rezervasyonunda görür."); };
/* ---- arama metni ---- */
BK.bTxt = b => [b.no, b.desc, P.accName(b.ag), P.dmcName(b.sup), b.vch || "", ...(b.guests || []), b.status, b.a, b.b || "", b.nat ? PD.natN(b.nat) : "", b.ref || ""].join(" ");
BK.oMatch = (o, q) => !q || U.mt(q, [o.no, o.label, BK.oSt(o), P.accName(o.ag), (o.inv || {}).no || "", (o.cinv || {}).no || "", ...BK.oBks(o).map(BK.bTxt)].join(" "));
BK.bMatch = (b, q) => !q || U.mt(q, BK.bTxt(b));
/* DMC alış/satış düzeltmesi (profit raporu) */
BK.rsSave = (k, a, c, to) => { const b = db().get("bookings", +k.slice(1)); if (!(+a > 0)) return no("Geçerli bir tutar girin."); if (k[0] == "b") b.dbuy = { amt: U.r2(+a), cur: c }; else b.resale = { amt: U.r2(+a), cur: c, to: String(to || "").trim() }; B4M.events.emit("dmc.reservation.cost", b.no, +a, c, B4M.ctx.dmc); return ok("Kaydedildi; profit yeniden hesaplandı."); };
