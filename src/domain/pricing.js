/* Fiyatlandırma: kurlar, platform markup (varsayılan %5), alt hesap kârı, DMC'nin kendi acentelerine kârı, satış kanalları, alış-satış farkı, API komisyonu. */
const PR = B4M.price = {};
const db = () => B4M.db, { ok, no } = B4M.res, P = B4M.parties;
PR.DEF_RATES = { TRY: 1, USD: 35, EUR: 38, GBP: 45, CHF: 40, JPY: 0.23, CAD: 25.5, AUD: 23, CNY: 4.9, AED: 9.5, SGD: 26 };
PR.rates = () => db().cfg("rates") || db().cfg("rates", { ...PR.DEF_RATES });
PR.cv = (a, f, to) => { const R = PR.rates(); return (a || 0) * (R[f] || 1) / (R[to] || 1); };
PR.tryP = (p, c) => PR.cv(p, c, "TRY");
PR.SVK = ["h", "t", "f", "u"];
PR.Z = v => ({ h: v, t: v, f: v, u: v });
PR.DEF_MK = 5;
/* platform markup tablosu: def.a = alıcı tarafı (varsayılan %5), def.s = satıcı tarafı (varsayılan 0); DMC bazında değiştirilebilir */
PR.table = () => { let x = db().cfg("markup"); if (!x || !x.def) x = db().cfg("markup", { def: { s: PR.Z(0), a: PR.Z(PR.DEF_MK) }, sup: {}, ag: {} }); return x; };
PR.comm = () => db().cfg("apiComm") || db().cfg("apiComm", { buy: 1, sell: 1 });
const acc = id => db().get("accounts", id) || {};
PR.agOwner = id => id ? acc(P.rootOf("a", id)).owner || 0 : 0;
PR.isOwnBuy = (ag, sup) => { const b = acc(P.rootOf("a", ag)).buyer; return !!b && b == P.rootOf("s", sup); };
PR.prR = (k, id, sv) => { const T = PR.table(), o = T[k][P.rootOf(k == "sup" ? "s" : "a", id)]; return o && o[sv] != null ? o[sv] : T.def[k == "sup" ? "s" : "a"][sv]; };
PR.ppR = (p, id, sv) => { const x = P.get(p, id); return x && x.parent ? ((x.pp || {})[sv] || 0) : 0; };
PR.supF = (id, sv) => (1 + PR.ppR("s", id, sv) / 100) * (1 + PR.prR("sup", id, sv) / 100);
PR.agF = (id, sv) => (1 + PR.prR("ag", id, sv) / 100) * (1 + PR.ppR("a", id, sv) / 100);
PR.dmcMk = (ag, sv) => { const a = acc(P.rootOf("a", ag)); return (a.dmk || {})[sv] ?? 10; };
/* alıcının gördüğü fiyat çarpanı */
PR.pf = (ag, sup, sv) => !ag ? 1 : PR.agOwner(ag) ? 1 + PR.dmcMk(ag, sv) / 100 : PR.isOwnBuy(ag, sup) ? 1 : PR.supF(sup, sv) * PR.agF(ag, sv);
/* satış kanalları ve alış-satış farkı */
PR.dmcCh = (id, sv) => ((db().get("dmcs", P.rootOf("s", id)) || {}).ch || {})[sv] || { hq: true, own: true };
PR.dmcMg = (id, sv) => { const s = db().get("dmcs", P.rootOf("s", id)) || {}, v = (s.mgn || {})[sv]; return typeof v == "number" && isFinite(v) ? v : null; };
PR.chanOK = (ag, id, sv) => { if (!ag) return true; if (PR.dmcMg(id, sv) == null) return false; const o = PR.agOwner(ag), ch = PR.dmcCh(id, sv); if (o) return P.rootOf("s", id) == o && ch.own; if (acc(P.rootOf("a", ag)).buyer == P.rootOf("s", id)) return true; return ch.hq; };
PR.itCh = (ag, x) => { if (!x.chs || !ag) return true; return PR.isOwnBuy(ag, x.sup) ? true : PR.agOwner(ag) ? !!x.chs.own : !!x.chs.hq; };
PR.supOK = (id, sv, ag) => { const c = P.activeC("s", id); return !!c && c.services.includes(sv) && PR.chanOK(ag, id, sv); };
/* kâr dağılımı: ps = üst DMC'nin alt DMC kârı, hq = platform markup geliri, dm = DMC'nin kendi acentesinden kârı, pa = üst hesabın alt hesap kârı */
PR.margins = (sup, ag, sv, cost, costCur, total, cur) => {
  if (PR.isOwnBuy(ag, sup)) return { ps: 0, psCur: costCur, hq: 0, dm: 0, pa: U.r2(total - PR.cv(cost, costCur, cur)) };
  if (PR.agOwner(ag)) { const k = 1 + PR.dmcMk(ag, sv) / 100; return { ps: 0, psCur: costCur, hq: 0, dm: U.r2(PR.cv(cost * (k - 1), costCur, cur)), pa: U.r2(total - PR.cv(cost * k, costCur, cur)) }; }
  const a = cost * (1 + PR.ppR("s", sup, sv) / 100), b = a * (1 + PR.prR("sup", sup, sv) / 100) * (1 + PR.prR("ag", ag, sv) / 100);
  return { ps: U.r2(cost * PR.ppR("s", sup, sv) / 100), psCur: costCur, hq: U.r2(PR.cv(b - a, costCur, cur)), pa: U.r2(total - PR.cv(b, costCur, cur)) };
};
/* ---- ayar işlemleri ---- */
const okPct = v => v >= -50 && v <= 200;
PR.setMk = (k, id, sv, v) => { const T = PR.table(); if (v === "" || v == null) { if (T[k][id]) { delete T[k][id][sv]; if (!Object.keys(T[k][id]).length) delete T[k][id]; } } else { const n = +v; if (!okPct(n)) return no("-50 ile 200 arasında bir oran gir."); (T[k][id] = T[k][id] || {})[sv] = n; } B4M.events.emit("markup.updated", k + ":" + id + ":" + sv, (T[k][id] || {})[sv] ?? 0); return ok("Platform markup oranı kaydedildi; yeni sorgulara uygulanır."); };
PR.setDef = (k, sv, v) => { const n = +v; if (!okPct(n)) return no("-50 ile 200 arasında bir oran gir."); PR.table().def[k][sv] = n; B4M.events.emit("markup.default", k + ":" + sv, n); return ok("Varsayılan oran kaydedildi."); };
PR.setPP = (p, id, sv, v) => { const n = +v; if (!(n >= 0 && n <= 200)) return no("0 ile 200 arasında bir oran gir."); const x = P.get(p, id); (x.pp = x.pp || PR.Z(0))[sv] = n; B4M.events.emit("profit.parent", p + ":" + id + ":" + sv, n); return ok("Alt hesaba uyguladığınız kâr oranı kaydedildi."); };
PR.setCh = (dmc, sv, k, v) => { const s = db().get("dmcs", dmc); s.ch = s.ch || {}; s.ch[sv] = { ...PR.dmcCh(dmc, sv), [k]: v }; B4M.events.emit("dmc.channel.updated", dmc + ":" + sv, 0, "TRY", dmc); return ok("Satış kanalı güncellendi."); };
PR.setDmk = (ag, sv, v) => { const n = +v; if (!(n >= -50 && n <= 200)) return no("-50 ile 200 arasında bir oran girin."); const a = acc(ag); a.dmk = a.dmk || {}; a.dmk[sv] = n; return ok("Kâr oranı kaydedildi; yeni sorgulara uygulanır."); };
PR.setMg = (dmc, sv, v) => { const s = db().get("dmcs", dmc); s.mgn = s.mgn || {}; if (v === "") { delete s.mgn[sv]; B4M.events.emit("dmc.margin.cleared", dmc + ":" + sv, 0, "TRY", dmc); return ok("Alış-satış farkı kaldırıldı; bu hizmet satışa kapandı."); } const n = +v; if (!(n >= 0 && n <= 200)) return no("0 ile 200 arasında bir oran girin."); s.mgn[sv] = n; B4M.events.emit("dmc.margin.updated", dmc + ":" + sv, n, "TRY", dmc); return ok("Alış-satış farkı kaydedildi."); };
PR.setRate = (c, v) => { PR.rates()[c] = +v || 1; return ok("Kur güncellendi."); };
PR.setComm = (buy, sell) => { const b = +buy, s = +sell; if (!(b >= 0 && b <= 10 && s >= 0 && s <= 10)) return no("0 ile 10 arasında bir oran girin."); db().cfg("apiComm", { buy: b, sell: s }); return ok("API komisyon oranları kaydedildi."); };
