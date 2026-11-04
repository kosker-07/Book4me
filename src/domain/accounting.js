/* Muhasebe: tahsilat, tek fatura, voucher, bakiye ve ön ödeme (blokaj + iptal şartına göre düşüm), DMC ödemeleri,
   DMC'nin kendi API ticaretinden %1 + %1 komisyon, aylık komisyon faturası ve mahsup. */
const AC = B4M.acc = {};
const db = () => B4M.db, { ok, no } = B4M.res, PR = B4M.price, P = B4M.parties, BK = B4M.book;
const now = () => U.now(), today = () => U.today();
AC.KGRP = [["h", "Konaklama"], ["t", "Transfer"], ["u", "Tur"], ["f", "Uçak bileti"]];
AC.balAv = (ag, cur) => Math.max(0, U.r2(-(BK.agBals(ag)[cur] || 0) + db().where("orders", o => o.ag == ag && o.cur == cur && !o.auto).reduce((s, o) => s + BK.oDue(o), 0)));
/* ödeme */
AC.doPay = (o, m, a) => { o.paid = U.r2(o.paid + a); o.pay = { m, at: now(), amt: a, state: "Ödendi" }; if (m != "Bakiye" && m != "Ön ödeme") BK.ledger(o.ag, o.cur, "{m} ödemesi · {no}", { m, no: o.no }, 0, a); B4M.events.emit("payment." + (m == "Bakiye" ? "balance" : m == "Kredi kartı" ? "card" : m == "Ön ödeme" ? "prepayment" : "transfer"), o.no, a, o.cur); return AC.issueInv([o], m); };
AC.payCard = oid => { const o = db().get("orders", oid), a = BK.oDue(o); if (!a) return no("Bu rezervasyonda ödenecek tutar yok."); const dc = AC.doPay(o, "Kredi kartı", a); return ok(dc ? "{a} kartla ödendi. Voucher ve fatura oluşturuldu." : "{a} kartla ödendi.", { a: I.fm(a, o.cur) }); };
AC.payBal = oid => { const o = db().get("orders", oid), a = BK.oDue(o); if (!a) return no("Bu rezervasyonda ödenecek tutar yok."); if (AC.balAv(o.ag, o.cur) < a - 0.004) return no("Bakiyeniz yetersiz ({a}).", { a: I.fm(AC.balAv(o.ag, o.cur), o.cur) }); const dc = AC.doPay(o, "Bakiye", a); return ok(dc ? "{a} bakiyenizden düşüldü. Voucher ve fatura oluşturuldu." : "{a} bakiyenizden düşüldü.", { a: I.fm(a, o.cur) }); };
AC.banks = () => db().all("banks");
AC.payBank = oid => { const o = db().get("orders", oid), a = BK.oDue(o); if (!a) return no("Bu rezervasyonda ödenecek tutar yok."); if (!AC.banks().some(b => b.cur == o.cur)) return no("{c} için banka hesabı tanımlı değil; kartla ödeyin.", { c: o.cur }); o.pay = { m: "Havale/EFT", at: now(), amt: a, state: "Onay bekliyor" }; B4M.events.emit("payment.transfer.notified", o.no, a, o.cur); return ok("Havale bildiriminiz alındı. Platform hesabı kontrol edip onaylayınca ödeme kesinleşir."); };
AC.bankOk = oid => { const o = db().get("orders", oid); o.paid = U.r2(o.paid + o.pay.amt); o.pay.state = "Ödendi"; BK.ledger(o.ag, o.cur, "Havale/EFT · {no}", { no: o.no }, 0, o.pay.amt); B4M.events.emit("payment.transfer.confirmed", o.no, o.pay.amt, o.cur); const dc = AC.issueInv([o], "Havale/EFT"); return ok(dc ? "Havale onaylandı. Voucher ve fatura oluşturuldu." : "Havale onaylandı."); };
AC.bankNo = oid => { const o = db().get("orders", oid); o.pay = null; B4M.events.emit("payment.transfer.rejected", o.no, 0, o.cur); return ok("Havale bildirimi reddedildi; rezervasyon yeniden ödeme bekliyor."); };
AC.payMany = (ag, cur, ids, m) => {
  const os = db().where("orders", o => o.ag == ag && o.cur == cur && ids.includes(o.id) && BK.oDue(o) && !o.auto && !(o.pay && o.pay.state == "Onay bekliyor")); if (!os.length) return no("Ödenecek rezervasyon seçin.");
  const sum = U.r2(os.reduce((s, o) => s + BK.oDue(o), 0)); if (m == "Bakiye" && AC.balAv(ag, cur) < sum - 0.004) return no("Bakiyeniz yetersiz ({a}).", { a: I.fm(AC.balAv(ag, cur), cur) });
  os.forEach(o => { const a = BK.oDue(o); o.paid = U.r2(o.paid + a); o.pay = { m, at: now(), amt: a, state: "Ödendi" }; if (m != "Bakiye") BK.ledger(o.ag, o.cur, "{m} ödemesi · {no} (toplu)", { m, no: o.no }, 0, a); B4M.events.emit("payment." + (m == "Bakiye" ? "balance" : "card"), o.no, a, o.cur); });
  const okk = AC.issueInv(os, m); return ok(okk ? "{n} rezervasyon için {a} ödendi. Tek fatura {f} ve voucher'lar oluşturuldu." : "{n} rezervasyon için {a} ödendi.", { n: os.length, a: I.fm(sum, cur), f: (os[0].inv || {}).no });
};
/* tek fatura + rezervasyon başına tek voucher */
AC.issueInv = (OS, m) => {
  OS = OS.filter(o => !o.inv && !BK.oDue(o)); if (!OS.length) return false;
  const L = OS.flatMap(o => BK.oBks(o).filter(b => b.status == "Onaylı" || b.status == "İptal (cezalı)").map(b => ({ b, o })));
  const inv = { no: `FTR-${today().slice(0, 4)}-${U.pad(db().counter("invn"), 6)}`, at: now(), method: m, ag: OS[0].ag, cur: OS[0].cur, orders: OS.map(o => o.no), lines: L.map(({ b, o }) => ({ no: b.no, rez: o.no, kind: b.kind, desc: b.desc, a: b.a, b: b.b, pax: (b.guests || []).length, lead: (b.guests || [])[0] || "", cx: b.status != "Onaylı", total: b.total })), total: U.r2(L.reduce((s, x) => s + x.b.total, 0)), comm: U.r2(L.reduce((s, x) => s + (x.b.comm || 0), 0)) };
  inv.net = U.r2(inv.total - inv.comm);
  OS.forEach(o => { o.inv = inv; o.vch = "VCH-" + o.no; }); L.filter(x => x.b.status == "Onaylı").forEach(({ b, o }) => { b.vch = o.vch; BK.mailTo(b, "Ödeme alındı, voucher düzenlendi"); });
  L.forEach(({ b }) => { const par = P.parentOf("a", b.ag); if (par && b.mg && b.mg.pa > 0 && !b.paShared) { b.paShared = true; BK.ledger(par, b.cur, "Alt acente kârı · {no} ({a})", { no: b.no, a: P.accName(b.ag) }, 0, b.mg.pa); } });
  B4M.events.emit("invoice.issued", inv.no, inv.net, inv.cur); return true;
};
/* bakiye yükleme */
AC.topUp = (ag, cur, a, m) => { a = U.r2(+a); if (!(a > 0)) return no("Geçerli bir tutar gir."); const x = db().add("topups", { ag, cur, amt: a, m, at: now(), state: m == "Kredi kartı" ? "Onaylandı" : "Onay bekliyor", tid: P.tidFor("a", ag) }); B4M.events.emit("balance.topup." + (m == "Kredi kartı" ? "card" : "transfer"), x.id, a, cur); if (x.state == "Onaylandı") { BK.ledger(ag, cur, "Bakiye yükleme (kredi kartı)", {}, 0, a); return ok("{a} bakiyenize yüklendi (demo kart ödemesi).", { a: I.fm(a, cur) }); } return ok("Havale bildiriminiz alındı; platform onaylayınca bakiyenize eklenecek."); };
AC.topOk = id => { const x = db().get("topups", id); x.state = "Onaylandı"; BK.ledger(x.ag, x.cur, "Bakiye yükleme (havale/EFT)", {}, 0, x.amt); B4M.events.emit("balance.topup.confirmed", id, x.amt, x.cur); return ok("Bakiye yüklemesi onaylandı."); };
AC.topNo = id => { const x = db().get("topups", id); x.state = "Reddedildi"; B4M.events.emit("balance.topup.rejected", id, 0, x.cur); return ok("Bakiye yükleme bildirimi reddedildi."); };
/* müşteri faturası taslağı (hesap sahibinden müşterisine) */
AC.agMk = ag => { const a = db().get("accounts", ag) || {}; return a.mk ?? 10; };
AC.saveMk = (ag, v) => { v = +v; if (!(v >= 0 && v <= 100)) return no("0 ile 100 arasında bir yüzde gir."); db().get("accounts", ag).mk = v; return ok("Satış komisyonunuz kaydedildi."); };
AC.custInv = oid => {
  const o = db().get("orders", oid), a = db().get("accounts", o.ag);
  if (!o.cinv) { const L = BK.oBks(o).filter(b => b.status == "Onaylı" || b.status == "İptal (cezalı)"), mk = AC.agMk(o.ag); a.cn = (a.cn || 0) + 1; o.cinv = { no: `${a.name.slice(0, 3).toLocaleUpperCase("tr")}-${today().slice(0, 4)}-${U.pad(a.cn, 5)}`, at: now(), mk, buyer: ((L[0] && L[0].guests) || [])[0] || "", lines: L.map(b => ({ no: b.no, desc: b.desc, a: b.a, b: b.b, total: U.r2(b.total * (1 + mk / 100)) })) }; o.cinv.total = U.r2(o.cinv.lines.reduce((s, l) => s + l.total, 0)); B4M.events.emit("customer.invoice.draft", o.cinv.no, o.cinv.total, o.cur); }
  return ok("");
};
/* banka hesapları */
AC.addBank = (cur, bank, holder, iban) => { if (!bank || !/^[A-Z]{2}[0-9 ]{10,}/i.test(iban || "")) return no("Banka adı ve geçerli bir IBAN gir."); db().add("banks", { cur, bank, holder, iban: iban.toUpperCase() }); return ok("Banka hesabı eklendi."); };
AC.delBank = id => { db().del("banks", id); return ok("Silindi."); };
/* ---- ön ödeme (depozito) ---- */
AC.preOf = ag => { const p = (db().get("accounts", ag) || {}).pre; return p && p.on ? p : null; };
AC.preHeld = (ag, cur) => U.r2(db().where("orders", o => o.ag == ag && o.hold && !o.auto).reduce((s, o) => s + PR.cv(BK.oDue(o), o.cur, cur), 0));
AC.preAvail = (ag, cur) => { const p = AC.preOf(ag); if (!p) return 0; return U.r2(PR.cv(Math.max(0, AC.balAv(ag, p.cur) - AC.preHeld(ag, p.cur)), p.cur, cur)); };
AC.preApply = (o, imm) => {
  if (imm) return AC.preDeduct(o) ? ["Tutar ön ödemenizden düşüldü; fatura ve voucher oluşturuldu.", {}] : ["Ön ödeme yetersiz olduğu için tutar düşülemedi.", {}];
  o.hold = { at: now() }; o.vch = "VCH-" + o.no; BK.oBks(o).forEach(b => { if (b.status == "Onaylı") { b.vch = o.vch; BK.mailTo(b, "Ön ödeme teminatıyla voucher düzenlendi"); } }); B4M.events.emit("prepayment.hold", o.no, BK.oDue(o), o.cur);
  return ["Tutar ön ödemenizde bloke edildi; ücretsiz iptal süresi ({d}) dolunca otomatik düşülecek. Voucher düzenlendi.", { d: I.fd(o.due) }];
};
AC.preDeduct = o => {
  const ac = db().get("accounts", o.ag) || {}, p = AC.preOf(o.ag) || ac.pre; if (!p) return false; const dep = p.cur, a = BK.oDue(o); if (!a) { delete o.hold; return true; }
  const need = U.r2(PR.cv(a, o.cur, dep)), avail = U.r2(AC.balAv(o.ag, dep) - AC.preHeld(o.ag, dep) + (o.hold ? need : 0)); if (avail < need - 0.004) { o.preFail = true; B4M.events.emit("prepayment.insufficient", o.no, need, dep); return false; }
  if (o.cur != dep) { BK.ledger(o.ag, dep, "Ön ödemeden kur çevrimi · {no} (1 {a} = {r} {b})", { no: o.no, a: o.cur, r: PR.cv(1, o.cur, dep).toFixed(4), b: dep }, need, 0); BK.ledger(o.ag, o.cur, "Ön ödeme ile kapatıldı (kur çevrimi) · {no}", { no: o.no }, 0, a); }
  delete o.hold; delete o.preFail; AC.doPay(o, "Ön ödeme", a); B4M.events.emit("prepayment.deducted", o.no, need, dep); return true;
};
AC.preNow = oid => { const o = db().get("orders", oid); if (!o || !o.hold) return no(""); if (!AC.preDeduct(o)) return no("Ön ödeme bakiyesi yetersiz; kartla veya havaleyle ödeyin."); return ok("Tutar ön ödemeden düşüldü; fatura oluşturuldu."); };
AC.preSet = (ag, amt, cur, on) => { amt = +amt; if (!(amt > 0)) return no("Anlaşma tutarını girin."); db().get("accounts", ag).pre = { on: !!on, cur, amt: U.r2(amt) }; B4M.events.emit("prepayment.agreement", ag, amt, cur); return ok("Ön ödeme anlaşması kaydedildi."); };
/* ---- DMC ödemeleri (platform alıcılarına satışlar) ---- */
AC.supPaid = id => { const b = db().get("bookings", id); b.sp = now(); B4M.events.emit("supplier.paid", id, b.cost ?? b.total, b.costCur || b.cur, b.sup); return ok("DMC ödemesi işaretlendi."); };
AC.dmcRecv = dmc => db().where("bookings", b => P.rootOf("s", b.sup) == dmc && b.status == "Onaylı" && b.oid && !b.own);
AC.dmcCollect = (dmc, ag, v, c, m) => { if (!(+v > 0)) return no("Geçerli bir tutar girin."); BK.ledger(ag, c, "Tahsilat ({m}) – {d}", { m, d: P.dmcName(dmc) }, 0, +v); B4M.events.emit("dmc.collection", ag, +v, c, dmc); return ok("Tahsilat işlendi."); };
/* ---- %1 + %1 API komisyonu: yalnızca DMC'nin kendi API bağlantısından gelen ticarette ---- */
AC.commQualifies = b => { if (b.src != "api") return false; const root = P.rootOf("s", b.sup); return PR.isOwnBuy(b.ag, b.sup) || PR.agOwner(b.ag) == root; };
AC.commCalc = b => {
  const R = PR.comm(), sell = b.resale && b.resale.amt > 0 ? { amt: b.resale.amt, cur: b.resale.cur } : { amt: b.total, cur: b.cur }, buy = { amt: b.cost, cur: b.costCur };
  const bc = U.r2(buy.amt * R.buy / 100), sc = U.r2(sell.amt * R.sell / 100);
  return { buyBase: buy, sellBase: sell, buy: bc, sell: sc, buyE: U.r2(PR.cv(bc, buy.cur, "EUR")), sellE: U.r2(PR.cv(sc, sell.cur, "EUR")) };
};
AC.commOnBook = b => { if (!AC.commQualifies(b)) return; const root = P.rootOf("s", b.sup), c = AC.commCalc(b); db().add("commissions", { bid: b.id, bno: b.no, dmc: root, tid: root, at: now(), month: today().slice(0, 7), ...c, totalE: U.r2(c.buyE + c.sellE), status: "Açık", inv: "" }); };
AC.commOf = b => db().find("commissions", c => c.bid == b.id);
/* iade edilen tutardan komisyon alınmaz; cezalı iptalde yalnızca ceza tutarından alınır */
AC.commOnCancel = (b, pen) => { const c = AC.commOf(b); if (!c || c.inv) { if (c && c.inv && !pen) db().add("commissions", { bid: b.id, bno: b.no, dmc: c.dmc, tid: c.tid, at: now(), month: today().slice(0, 7), buy: -c.buy, sell: -c.sell, buyE: -c.buyE, sellE: -c.sellE, totalE: -c.totalE, status: "Açık", inv: "", rev: 1, buyBase: c.buyBase, sellBase: c.sellBase }); return; } if (pen) { c.penalty = 1; return; } c.buy = c.sell = c.buyE = c.sellE = c.totalE = 0; c.status = "İptal (komisyon yok)"; };
AC.commOnModify = b => { const c = AC.commOf(b); if (!c || c.inv) return; Object.assign(c, AC.commCalc(b)); c.totalE = U.r2(c.buyE + c.sellE); };
AC.commOpen = dmc => db().where("commissions", c => c.dmc == dmc && c.status == "Açık" && !c.inv);
/* ay sonu tek komisyon faturası */
AC.commInvoice = (dmc, month) => {
  const L = AC.commOpen(dmc).filter(c => !month || c.month <= month); if (!L.length) return no("Faturalanacak komisyon yok.");
  const inv = db().add("cinvoices", { no: `KMS-${today().slice(0, 4)}-${U.pad(db().counter("kmsn"), 6)}`, dmc, tid: dmc, month: month || today().slice(0, 7), at: now(), lines: L.map(c => ({ bno: c.bno, buyBase: c.buyBase, sellBase: c.sellBase, buy: c.buy, sell: c.sell, totalE: c.totalE })), total: U.r2(L.reduce((s, c) => s + c.totalE, 0)), cur: "EUR", paid: 0, status: "Açık", offsets: [] });
  L.forEach(c => c.inv = inv.no); B4M.events.emit("commission.invoice.issued", inv.no, inv.total, "EUR", dmc);
  return ok("Komisyon faturası {no} kesildi: {a}", { no: inv.no, a: I.fm(inv.total, "EUR") }, { inv });
};
AC.cinvDue = v => Math.max(0, U.r2(v.total - v.paid));
/* mahsup: platformun DMC'ye borçlu olduğu tutarlardan veya ön ödeme bakiyesinden */
AC.recvOpenE = dmc => U.r2(AC.dmcRecv(dmc).filter(b => !b.sp).reduce((s, b) => s + PR.cv(b.cost ?? b.total, b.costCur || b.cur, "EUR"), 0) - AC.nettedE(dmc));
AC.nettedE = dmc => U.r2(db().where("cinvoices", v => v.dmc == dmc).flatMap(v => v.offsets).filter(o => o.src == "recv").reduce((s, o) => s + o.amt, 0));
AC.commOffset = (id, src) => {
  const v = db().get("cinvoices", id), due = AC.cinvDue(v); if (!due) return no("Bu faturada kapanacak tutar yok.");
  let amt = 0;
  if (src == "recv") { amt = Math.min(due, Math.max(0, AC.recvOpenE(v.dmc))); if (!(amt > 0)) return no("Mahsup edilecek platform alacağı yok."); }
  else if (src == "pre") {
    const b = db().find("accounts", a => a.buyer == v.dmc && !a.owner), p = b && b.pre; if (!b || !p) return no("DMC'nin ön ödeme hesabı yok.");
    const avE = PR.cv(AC.preAvail(b.id, p.cur), p.cur, "EUR"); amt = U.r2(Math.min(due, avE)); if (!(amt > 0)) return no("Ön ödeme bakiyesi yetersiz.");
    BK.ledger(b.id, p.cur, "Komisyon faturası {no} mahsubu", { no: v.no }, U.r2(PR.cv(amt, "EUR", p.cur)), 0);
  } else if (src == "pay") amt = due;
  v.offsets.push({ src, amt: U.r2(amt), at: now() }); v.paid = U.r2(v.paid + amt); v.status = AC.cinvDue(v) ? "Kısmi kapandı" : "Kapandı";
  B4M.events.emit("commission.invoice.offset", v.no + ":" + src, amt, "EUR", v.dmc);
  return ok(src == "recv" ? "{a} platform alacağından mahsup edildi." : src == "pre" ? "{a} ön ödeme bakiyesinden mahsup edildi." : "{a} tahsil edildi.", { a: I.fm(amt, "EUR") });
};
