/* Yama 2a · Yama 1'den eksik kalanlar (iş kuralları). Arayüz dışı; Node testlerinde de yüklenir.
   C  yeni satış hesabı bildirimi DMC departmanına da gider · tanıtım faturası kesilince Commercial ve Muhasebe'ye bildirim
   I  yeni gider türleri: turizm payı, damga vergisi, amortisman · maaş talebi iki adım: talep → yönetici → Muhasebe
   H  prim kuralına ad · J rezervasyon başına gelir, tahsil edilen, ödenecek, çalışan kârlılığı (Back Office)
   K  platformun kestiği tanıtım faturası "mahsup" edilince platformun DMC'ye ödeyeceği tutardan gerçekten düşer
   Ayrıca: kişiye özel bildirim (uid) artık yalnızca o kişiye ve her durumda o kişiye gider (Yama 1'de alan kayboluyordu). */
const db = () => B4M.db, { ok, no } = B4M.res, NT = B4M.notif, FN = B4M.fin, P = B4M.parties, PR = B4M.price, AC = B4M.acc, BK = B4M.book;
const E = (v, c) => PR.cv(+v || 0, c || "EUR", "EUR"), ym = d => String(d || "").slice(0, 7);
/* ---- kişiye özel bildirim ---- */
const basePush = NT.push; NT.push = o => { const n = basePush(o); if (o.uid) n.uid = o.uid; return n; };
const baseFor = NT.forUser; NT.forUser = u => { u = u || B4M.app.user(); if (!u.id) return []; const tid = NT.tidOfUser(u), L = baseFor(u).filter(n => !n.uid || n.uid == u.id), seen = new Set(L.map(n => n.id));
  db().where("notifs", n => n.uid == u.id && n.tid == tid && !seen.has(n.id)).forEach(n => L.push(n)); return L.sort((a, b) => (b.at || "").localeCompare(a.at || "") || b.id - a.id); };
/* ---- C: bildirim kuralları ---- */
NT.RULES["account.created"] = e => { const a = db().get("accounts", +e.ref); if (a) NT.push({ tid: "P", depts: ["Commercial", "DMC"], perms: ["cs", "a", "s"], title: "Yeni satış hesabı: {n}", tp: { n: a.name }, kind: "acct", ref: a.id }); };
const baseAddPromo = FN.addPromo; FN.addPromo = (tid, o) => { const r = baseAddPromo(tid, o); if (r.ok && r.x) { const x = r.x;
  NT.push({ tid, depts: tid == "P" ? ["Commercial", "Muhasebe"] : ["Muhasebe"], perms: ["mkt", "mkti", "acc"], title: "Tanıtım faturası kesildi: {no} · {h} · {a}", tp: { no: x.no, h: x.hotel, a: I.fm(x.amt, x.cur) }, kind: "promo", ref: x.id }); } return r; };
/* ---- I: gider türleri ---- */
[["tpay", "Turizm payı", "770"], ["stamp", "Damga vergisi", "770"], ["dep", "Amortisman", "770"]].forEach(c => { if (!FN.CATS.some(x => x[0] == c[0])) FN.CATS.splice(FN.CATS.length - 1, 0, c); });
/* ---- I: maaş talebi iki adım ---- */
const SF = B4M.salFlow = {};
SF.MGR = "Yönetici onayında";
SF.approvers = x => { const L = db().where("users", u => u.active && u.id != x.uid && NT.tidOfUser(u) == x.tid), mg = L.filter(u => u.mgr && u.dept == x.dept && u.role != "admin"); return mg.length ? mg : L.filter(u => u.role == "admin"); };
SF.mineToApprove = (x, u) => { u = u || B4M.app.user(); return x.st == SF.MGR ? SF.approvers(x).some(a => a.id == u.id) : true; };
SF.forMe = u => { u = u || B4M.app.user(); return db().where("salReq", x => x.st == SF.MGR && SF.approvers(x).some(a => a.id == u.id)); };
const baseReq = FN.reqSal; FN.reqSal = o => { const u = B4M.app.user(), r = baseReq(o); if (!r.ok || !r.x || u.role == "admin") return r; const x = r.x, ap = SF.approvers(x); if (!ap.length) return r;
  x.st = SF.MGR; db().del("notifs", n => n.kind == "sal" && n.ref == x.id);
  ap.forEach(a => NT.push({ tid: x.tid, depts: [], perms: [], uid: a.id, title: "Ekibinizden maaş talebi: {n}", tp: { n: x.name }, kind: "salmgr", ref: x.id }));
  return ok("Maaş talebiniz önce yöneticinize, onaylanınca Muhasebe'ye iletilir.", {}, { x }); };
SF.decide = (id, yes, note) => { const x = db().get("salReq", id), u = B4M.app.user(); if (!x || x.st != SF.MGR) return no("Talep yönetici onayında değil."); if (!SF.approvers(x).some(a => a.id == u.id)) return no("Bu talebi yalnızca çalışanın yöneticisi onaylar.");
  x.mgr = { by: u.name, uid: u.id, at: U.now(), yes: !!yes, note: note || "" };
  if (yes) { x.st = "Bekliyor"; NT.push({ tid: x.tid, depts: ["Muhasebe"], perms: ["sal"], title: "Yeni maaş talebi: {n}", tp: { n: x.name }, kind: "sal", ref: x.id }); }
  else { x.st = "Reddedildi"; x.dec = { by: u.name, at: U.now(), note: note || "" }; NT.push({ tid: x.tid, depts: [], perms: [], uid: x.uid, title: "Maaş talebiniz reddedildi", tp: {}, kind: "salme", ref: x.id }); }
  B4M.audit.log("salary.request.manager", x.id, yes ? "onay" : "ret", x.tid); return ok(yes ? "Onaylandı; talep Muhasebe'ye iletildi." : "Talep reddedildi."); };
/* ---- H: prim kuralına ad ---- */
const baseRule = FN.setRule; FN.setRule = (tid, o) => { const r = baseRule(tid, o); if (r.ok && r.x) r.x.name = String(o.name || "").trim(); return r; };
/* ---- J: ek finans göstergeleri ---- */
FN.extra = (tid, m) => { const M = FN.month(tid, m), bo = tid == "P";
  const ownO = o => BK.oBks(o).some(b => b.own == tid);
  const collected = db().where("orders", o => o.pay && o.pay.state != "Onay bekliyor" && ym(o.pay.at) == m && (bo ? true : ownO(o))).reduce((s, o) => s + E(o.pay.amt ?? o.paid, o.cur), 0);
  const payable = bo ? db().where("bookings", b => b.oid && b.status == "Onaylı" && !b.own && !b.sp).reduce((s, b) => s + E(b.cost ?? b.total, b.costCur || b.cur), 0) - FN.offE()
    : B4M.ops.payables(tid).filter(s => !s.supPaid).reduce((s, x) => s + E(B4M.ops.cost(x), x.buy.cur), 0) + db().where("orders", o => (db().get("accounts", o.ag) || {}).buyer == tid && !o.auto).reduce((s, o) => s + E(BK.oDue(o), o.cur), 0);
  const cnt = {}; FN.staff(tid).forEach(u => { const d = u.dept || "Diğer"; cnt[d] = (cnt[d] || 0) + 1; });
  const staff = bo ? FN.staff(tid).map(u => { const d = u.dept || "Diğer", s = M.S.find(x => x.uid == u.id), b = M.bon.find(x => x.uid == u.id), rev = M.revDept[d], share = rev == null ? null : U.r2((rev - (M.costDept[d] || 0)) / (cnt[d] || 1));
    return { uid: u.id, name: u.name, dept: d, cost: s ? s.e : 0, bonus: b ? b.amt : 0, share }; }) : [];
  return { m, perBk: M.n ? U.r2(M.net / M.n) : null, collected: U.r2(collected), payable: U.r2(Math.max(0, payable)), staff }; };
/* ---- K: tanıtım faturası mahsubu ---- */
const baseSettle = FN.settlePromo; FN.settlePromo = (id, mode) => { const x = db().get("promoInv", id), r = baseSettle(id, mode);
  if (r.ok && mode == "mahsup" && x && x.tid == "P") { const h = db().get("hotels", x.hid); if (h) { x.off = { dmc: P.rootOf("s", h.sup), e: U.r2(E(x.amt, x.cur)), at: U.now() }; B4M.audit.log("promo.offset", x.no, P.dmcName(x.off.dmc), "P");
    NT.push({ tid: x.off.dmc, depts: ["Muhasebe"], perms: ["acc"], title: "Tanıtım faturası {no} ({h}) platform ödemenizden mahsup edildi: {a}", tp: { no: x.no, h: x.hotel, a: I.fm(x.amt, x.cur) }, kind: "promoff", ref: x.id });
    return ok("Tutar platformun {d} firmasına ödeyeceği tutardan mahsup edildi.", { d: P.dmcName(x.off.dmc) }); } }
  return r; };
FN.offs = dmc => db().where("promoInv", x => x.off && (dmc == null || x.off.dmc == dmc));
FN.offE = dmc => U.r2(FN.offs(dmc).reduce((s, x) => s + x.off.e, 0));
const baseNet = AC.nettedE; AC.nettedE = dmc => U.r2(baseNet(dmc) + FN.offE(dmc));
