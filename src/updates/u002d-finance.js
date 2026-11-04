/* Yama 1 · Muhasebe: şirket giderleri, maaşlar ve maaş talepleri, çalışan primi, tanıtım (marketing) gelirleri, bütçe ve finans raporları.
   - Giderler Tekdüzen Hesap Planı gruplarıyla tutulur: 622 satılan hizmet maliyeti, 760 pazarlama-satış, 770 genel yönetim, 780 finansman.
   - Maaşlar işveren maliyetiyle gidere otomatik girer (SGK işveren payı ve işsizlik payı Parametreler'den değişir).
   - Prim her ay otomatik hesaplanır: kural "tüm giderler düştükten sonraki kârın %x'i" gibi; kural değişikliği yalnızca ileriye (bu ay ve sonrası) uygulanır.
   - Tanıtım faturası otele kesilir (platform veya DMC); tahsil edilir ya da otele yapılacak ödemeden mahsup edilir. Sıralamaya hiçbir etkisi yoktur: en iyi fiyat her zaman önde. */
const db = () => B4M.db, { ok, no } = B4M.res, PR = B4M.price, P = B4M.parties, RP = B4M.rep, AU = B4M.auth, NT = B4M.notif, Y1 = B4M.y1;
const FN = B4M.fin = {};
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5), E = (v, c) => PR.cv(+v || 0, c || "EUR", "EUR"), ym = d => String(d || "").slice(0, 7), thisM = () => U.today().slice(0, 7);
const can = k => { const u = B4M.app.user(); return !!u.id && (u.role == "admin" || AU.can(k)); };
/* kiracı koruması: herkes yalnızca kendi şirketinin muhasebesine yazar */
const mine = tid => String(FN.myTid()) == String(tid);
FN.addM = (m, n) => { let [y, mo] = m.split("-").map(Number); mo += n; while (mo > 12) { mo -= 12; y++; } while (mo < 1) { mo += 12; y--; } return y + "-" + U.pad(mo, 2); };
FN.months = (a, b) => { const L = []; let m = a; while (m <= b && L.length < 60) { L.push(m); m = FN.addM(m, 1); } return L; };
/* ---- hesap grupları ve gider türleri ---- */
FN.GRP = { "622": "Satılan hizmet maliyeti", "760": "Pazarlama, satış ve dağıtım giderleri", "770": "Genel yönetim giderleri", "780": "Finansman giderleri" };
FN.CATS = [["sys", "Sistem ve yazılım (sunucu, lisans, API)", "770"], ["sal", "Maaş ve personel (işveren maliyeti)", "770"], ["ins", "Sigorta", "770"], ["fly", "Uçak ve seyahat", "760"], ["mkt", "Pazarlama ve reklam", "760"],
  ["rent", "Kira ve ofis", "770"], ["prof", "Muhasebe, hukuk, danışmanlık", "770"], ["opx", "Operasyon maliyeti (araç, rehber, transfer)", "622"], ["bank", "Banka, POS ve kur farkı", "780"], ["tax", "Vergi, harç ve aidat", "770"], ["oth", "Diğer", "770"]];
FN.cat = k => FN.CATS.find(c => c[0] == k) || FN.CATS[FN.CATS.length - 1];
FN.deptCode = d => /Operasyon|Rehber/.test(d || "") ? "622" : /Commercial|Satış|Pazarlama/.test(d || "") ? "760" : "770";
FN.tidOf = u => NT.tidOfUser(u);
FN.myTid = () => B4M.ctx.org == "h" ? "P" : B4M.app.tidOf(B4M.ctx.dmc);
/* ---- giderler ---- */
FN.addExp = (tid, o) => { if (!mine(tid)) return no("Bu şirketin kayıtlarına erişiminiz yok."); if (!can("exp")) return no("Gider girmek için yetkiniz yok."); const amt = +o.amt; if (!(amt > 0)) return no("Tutarı girin."); if (!/^\d{4}-\d{2}-\d{2}$/.test(o.d || "")) return no("Tarihi girin.");
  const c = FN.cat(o.cat), x = db().add("expenses", { tid, cat: c[0], code: o.code && FN.GRP[o.code] ? o.code : c[2], dept: o.dept || "", amt: U.r2(amt), cur: o.cur || "EUR", d: o.d, desc: String(o.desc || "").trim() || t(c[1]), rec: !!o.rec, end: o.end || "", by: B4M.app.user().name, at: U.now() });
  B4M.audit.log("expense.created", x.id, x.desc, tid); return ok(x.rec ? "Tekrarlayan gider kaydedildi; her ay otomatik eklenir." : "Gider kaydedildi.", {}, { x }); };
FN.delExp = id => { if (!can("exp")) return no("Gider silmek için yetkiniz yok."); const x = db().get("expenses", id); if (!x || !mine(x.tid)) return no(""); if (x.rec && ym(x.d) < thisM()) { x.end = FN.addM(thisM(), -1); return ok("Tekrarlayan gider bu aydan itibaren durduruldu; geçmiş aylar korunur."); } db().del("expenses", id); return ok("Gider silindi."); };
/* bir aydaki giderler: tek seferlikler + tekrarlayanlar (başlangıç ayından bitişe kadar) */
FN.expOf = (tid, m) => db().where("expenses", x => x.tid == tid && (x.rec ? ym(x.d) <= m && (!x.end || m <= x.end) : ym(x.d) == m)).map(x => ({ ...x, e: U.r2(E(x.amt, x.cur)) }));
/* ---- maaşlar (işveren maliyeti) ---- */
FN.erRate = () => 1 + (Y1.prm("sgkEr") + Y1.prm("unempEr")) / 100;
FN.setSal = (tid, o) => { if (!mine(tid)) return no("Bu şirketin kayıtlarına erişiminiz yok."); if (!can("sal")) return no("Maaş kaydı için yetkiniz yok."); const g = +o.gross; if (!(g > 0)) return no("Brüt maaşı girin."); const from = o.from || thisM(); if (from < thisM()) return no("Maaş değişikliği geçmiş aya uygulanamaz.");
  const u = o.uid ? db().get("users", +o.uid) : null, name = u ? u.name : String(o.name || "").trim(); if (!name) return no("Çalışanı seçin.");
  const x = db().add("salaries", { tid, uid: u ? u.id : 0, name, dept: u ? u.dept : o.dept || "", gross: U.r2(g), cur: o.cur || "TRY", from, to: o.to || "", by: B4M.app.user().name, at: U.now() }); B4M.audit.log("salary.set", x.id, name, tid); return ok("Maaş kaydedildi; {m} ayından itibaren gidere işlenir.", { m: from }, { x }); };
FN.salOf = (tid, m) => { const by = {}; db().where("salaries", s => s.tid == tid && s.from <= m && (!s.to || m <= s.to)).sort((a, b) => a.from.localeCompare(b.from) || a.id - b.id).forEach(s => by[s.uid || "n:" + s.name] = s);
  return Object.values(by).map(s => ({ ...s, cost: U.r2(s.gross * FN.erRate()), e: U.r2(E(s.gross * FN.erRate(), s.cur)), code: FN.deptCode(s.dept) })); };
/* maaş talepleri: çalışan ister, yetkili onaylar; onay sonraki aydan geçerli olur */
FN.reqSal = (o) => { const u = B4M.app.user(); if (!u.id) return no(""); const amt = +o.amt; if (!(amt > 0)) return no("Talep edilen tutarı girin.");
  const x = db().add("salReq", { tid: FN.tidOf(u), uid: u.id, name: u.name, dept: u.dept, amt: U.r2(amt), cur: o.cur || "TRY", note: String(o.note || "").trim(), st: "Bekliyor", at: U.now() });
  NT.push({ tid: x.tid, depts: ["Muhasebe"], perms: ["sal"], title: "Yeni maaş talebi: {n}", tp: { n: u.name }, kind: "sal", ref: x.id }); return ok("Maaş talebiniz iletildi.", {}, { x }); };
FN.decideSal = (id, yes, note) => { if (!can("sal")) return no("Maaş taleplerini yalnızca yetkili kişi onaylar."); const x = db().get("salReq", id); if (!x || x.st != "Bekliyor" || !mine(x.tid)) return no("");
  x.st = yes ? "Onaylandı" : "Reddedildi"; x.dec = { by: B4M.app.user().name, at: U.now(), note: note || "" };
  if (yes) db().add("salaries", { tid: x.tid, uid: x.uid, name: x.name, dept: x.dept, gross: x.amt, cur: x.cur, from: FN.addM(thisM(), 1), to: "", by: B4M.app.user().name, at: U.now(), req: x.id });
  NT.push({ tid: x.tid, depts: [], perms: [], uid: x.uid, title: yes ? "Maaş talebiniz onaylandı" : "Maaş talebiniz reddedildi", tp: {}, kind: "salme", ref: x.id }); return ok(yes ? "Talep onaylandı; yeni maaş gelecek aydan geçerli." : "Talep reddedildi."); };
/* ---- tanıtım (marketing) anlaşmaları ve faturaları ---- */
FN.addPromo = (tid, o) => { if (!mine(tid)) return no("Bu şirketin kayıtlarına erişiminiz yok."); if (!can("mkt")) return no("Tanıtım faturası için yetkiniz yok."); const h = o.hid ? db().get("hotels", +o.hid) : null, amt = +o.amt; if (!h && !String(o.hotel || "").trim()) return no("Oteli seçin."); if (!(amt > 0)) return no("Tutarı girin.");
  const no2 = (tid == "P" ? "TNT-" : "TNT" + tid + "-") + U.today().slice(0, 4) + "-" + U.pad(db().where("promoInv", x => x.tid == tid).length + 1, 4);
  const x = db().add("promoInv", { tid, no: no2, hid: h ? h.id : 0, hotel: h ? h.name : String(o.hotel).trim(), amt: U.r2(amt), cur: o.cur || "EUR", d: o.d || U.today(), period: o.period || "", desc: String(o.desc || "").trim() || t("Tanıtım hizmeti"), st: "Açık", by: B4M.app.user().name, at: U.now() });
  B4M.audit.log("promo.invoiced", x.no, x.hotel, tid); return ok("Tanıtım faturası {no} kesildi. Sıralamaya etkisi yoktur.", { no: x.no }, { x }); };
FN.settlePromo = (id, mode) => { if (!can("mkt") && !can("mkti")) return no("Bu işlem için yetkiniz yok."); const x = db().get("promoInv", id); if (!x || x.st != "Açık" || !mine(x.tid)) return no("");
  x.st = mode == "mahsup" ? "Mahsup edildi" : "Tahsil edildi"; x.set = { by: B4M.app.user().name, at: U.now(), mode };
  return ok(mode == "mahsup" ? "Tutar otele yapılacak ödemeden mahsup edildi." : "Tahsilat kaydedildi."); };
/* ---- bütçe ---- */
FN.setBudget = (tid, m, code, amt) => { if (!mine(tid)) return no("Bu şirketin kayıtlarına erişiminiz yok."); if (!can("fin")) return no("Bütçe için finans yetkisi gerekir."); if (!FN.GRP[code] && code != "rev") return no(""); const v = +amt; if (!(v >= 0)) return no("Geçerli bir tutar girin.");
  const x = db().find("budgets", b => b.tid == tid && b.m == m && b.code == code); if (x) x.amt = v; else db().add("budgets", { tid, m, code, amt: v }); return ok("Bütçe kaydedildi."); };
FN.budget = (tid, m) => { const o = {}; db().where("budgets", b => b.tid == tid && b.m == m).forEach(b => o[b.code] = b.amt); return o; };
/* ---- gelir (aylık, EUR) ---- */
const ordAt = b => ((db().get("orders", b.oid) || {}).at || b.at || "");
FN.rev = (tid, m) => {
  const promo = db().where("promoInv", x => x.tid == tid && ym(x.d) == m).reduce((s, x) => s + E(x.amt, x.cur), 0);
  if (tid == "P") { const B = db().where("bookings", b => b.oid && b.status == "Onaylı" && ym(ordAt(b)) == m), ttv = B.reduce((s, b) => s + E(b.total, b.cur), 0), mk = B.reduce((s, b) => s + E((b.mg || {}).hq, b.cur), 0);
    const pa = B.reduce((s, b) => s + E((b.mg || {}).pa, b.cur), 0), ps = B.reduce((s, b) => s + E((b.mg || {}).ps, (b.mg || {}).psCur || b.costCur), 0);
    const api = db().where("commissions", c => c.month == m).reduce((s, c) => s + (c.totalE || 0), 0), rb = db().where("rbRev", r => ym(r.at) == m).reduce((s, r) => s + (r.e || 0), 0);
    const byDept = { "Product / Otel Kontrat": B.filter(b => b.kind == "h").reduce((s, b) => s + E((b.mg || {}).hq, b.cur), 0) + rb, Operasyon: B.filter(b => b.kind != "h").reduce((s, b) => s + E((b.mg || {}).hq, b.cur), 0), Commercial: api + promo };
    const L = { markup: mk, api, rb, promo }; return { ttv, n: B.length, lines: L, net: mk + api + rb + promo, pa, ps, byDept, bySeller: {} }; }
  const R = RP.rsRows(tid).filter(r => r.act && ym(r.at) == m), ttv = R.filter(r => r.sell).reduce((s, r) => s + E(r.sell.amt, r.sell.cur), 0), gp = R.reduce((s, r) => s + (r.prE || 0), 0);
  const byDept = { Product: R.filter(r => r.sv == "h").reduce((s, r) => s + (r.prE || 0), 0), Operasyon: R.filter(r => r.sv != "h" && r.ch != "Rehber").reduce((s, r) => s + (r.prE || 0), 0), Rehber: R.filter(r => r.ch == "Rehber").reduce((s, r) => s + (r.prE || 0), 0) };
  const bySeller = {}; R.forEach(r => { const k = (r.ref && r.ref.by) || "—"; bySeller[k] = (bySeller[k] || 0) + (r.prE || 0); });
  const api = db().where("commissions", c => c.dmc == tid && c.month == m).reduce((s, c) => s + (c.totalE || 0), 0);
  return { ttv, n: R.length, lines: { gp, promo }, net: gp + promo, api, byDept, bySeller };
};
/* ---- prim kuralları ---- */
FN.BASES = { net: "Tüm giderler düştükten sonraki kâr", gp: "Brüt kâr (net gelir)", dept: "Kendi departmanının kârı", own: "Kendi satışlarının kârı" };
FN.setRule = (tid, o) => { if (!mine(tid)) return no("Bu şirketin kayıtlarına erişiminiz yok."); if (!can("bon")) return no("Prim kuralı için yetkiniz yok."); const pct = +o.pct; if (!(pct >= 0 && pct <= 50)) return no("0 ile 50 arasında bir oran girin."); const from = o.from || thisM(); if (from < thisM()) return no("Prim kuralı geçmiş aya uygulanamaz; değişiklik yalnızca ileriye dönüktür.");
  const base = FN.BASES[o.base] ? o.base : "net", uid = o.uid ? +o.uid : 0; const x = db().add("bonusRules", { tid, uid, dept: uid ? "" : o.dept || "", base, pct, from, by: B4M.app.user().name, at: U.now() });
  B4M.audit.log("bonus.rule", x.id, `${base} %${pct} ${from}`, tid); return ok("Prim kuralı kaydedildi; {m} ayından itibaren uygulanır.", { m: from }, { x }); };
FN.ruleFor = (tid, u, m) => { const L = db().where("bonusRules", r => r.tid == tid && r.from <= m && (r.uid == u.id || (!r.uid && (!r.dept || r.dept == u.dept)))).sort((a, b) => a.from.localeCompare(b.from) || a.id - b.id);
  const own = L.filter(r => r.uid == u.id); return (own.length ? own : L).slice(-1)[0] || null; };
FN.staff = tid => db().where("users", u => u.on !== false && u.org != "a" && FN.tidOf(u) == tid && (u.org == "h" || u.oid == tid));
/* ---- aylık sonuç: gelir − giderler − maaşlar = prim öncesi kâr; prim ayrıca gider olur ---- */
FN.month = (tid, m) => { const R = FN.rev(tid, m), X = FN.expOf(tid, m), S = FN.salOf(tid, m), byCode = { "622": 0, "760": 0, "770": 0, "780": 0 }, byDept = {};
  X.forEach(x => { byCode[x.code] += x.e; if (x.dept) byDept[x.dept] = (byDept[x.dept] || 0) + x.e; }); S.forEach(s => { byCode[s.code] += s.e; byDept[s.dept || "Diğer"] = (byDept[s.dept || "Diğer"] || 0) + s.e; });
  if (tid != "P") byCode["780"] += R.api || 0; /* DMC: platform API komisyonu finansman/komisyon gideri */
  const opex = byCode["622"] + byCode["760"] + byCode["770"], favok = R.net - opex, pre = favok - byCode["780"];
  const bon = FN.staff(tid).map(u => { const r = FN.ruleFor(tid, u, m); if (!r) return null; const base = r.base == "net" ? pre : r.base == "gp" ? R.net : r.base == "dept" ? (R.byDept[u.dept] || 0) - (byDept[u.dept] || 0) : R.bySeller[u.name] || 0;
    return { uid: u.id, name: u.name, dept: u.dept, rule: r, base: U.r2(base), amt: U.r2(Math.max(0, base) * r.pct / 100) }; }).filter(Boolean), bonT = bon.reduce((s, b) => s + b.amt, 0);
  const sal = S.reduce((s, x) => s + x.e, 0);
  return { m, ...R, revDept: R.byDept, costDept: byDept, X, S, sal, byCode, opex, favok, pre, bon, bonT, netProfit: pre - bonT, take: R.ttv ? (R.net - (R.lines.promo || 0)) / R.ttv * 100 : null };
};
FN.bonusOf = (u, m) => { u = u || B4M.app.user(); const tid = FN.tidOf(u); return (FN.month(tid, m || thisM()).bon.find(b => b.uid == u.id)) || null; };
FN.bonusHist = (u, n) => { u = u || B4M.app.user(); return FN.months(FN.addM(thisM(), -(n || 6) + 1), thisM()).reverse().map(m => ({ m, b: FN.bonusOf(u, m) })); };
/* ---- finans raporu: bu ay, önceki ay, geçen yıl aynı ay, bütçe ---- */
FN.report = (tid, m) => { m = m || thisM(); const cur = FN.month(tid, m), prev = FN.month(tid, FN.addM(m, -1)), ly = FN.month(tid, FN.addM(m, -12)), bud = FN.budget(tid, m);
  return { m, cur, prev, ly, bud, trend: FN.months(FN.addM(m, -11), m).map(k => { const x = FN.month(tid, k); return { k, byM: 1, v: x.net, n: x.n, p: x.netProfit }; }), cash: FN.cash(tid), aging: FN.aging(tid) }; };
FN.delta = (a, b) => b ? (a - b) / Math.abs(b) * 100 : null;
/* nakit ve avans: ön ödemeli hesap bakiyeleri (müşteri avansı) ve açık alacak */
FN.cash = tid => { const A = db().where("accounts", a => a.pre && a.pre.on && (tid == "P" ? !a.owner : a.owner == tid || P.rootOf("a", a.id) && (db().get("accounts", P.rootOf("a", a.id)) || {}).owner == tid));
  return { adv: A.reduce((s, a) => s + E(B4M.acc.balAv(a.id, a.pre.cur), a.pre.cur), 0), n: A.length, recv: tid == "P" ? 0 : B4M.acc.recvOpenE(tid) }; };
/* alacak yaşlandırma: açık siparişler son ödeme tarihine göre */
FN.AGE = [["nd", "Vadesi gelmemiş"], ["a7", "0–7 gün gecikmiş"], ["a30", "8–30 gün gecikmiş"], ["a99", "30+ gün gecikmiş"]];
FN.openOrders = tid => db().where("orders", o => !o.auto && B4M.book.oDue(o) > 0 && (tid == "P" ? true : B4M.book.oBks(o).some(b => b.own == tid)));
FN.aging = tid => { const R = { nd: 0, a7: 0, a30: 0, a99: 0 }, N = { nd: 0, a7: 0, a30: 0, a99: 0 }; FN.openOrders(tid).forEach(o => { const g = days(o.due, U.today()), k = o.due >= U.today() ? "nd" : g <= 7 ? "a7" : g <= 30 ? "a30" : "a99"; R[k] += E(B4M.book.oDue(o), o.cur); N[k]++; }); return { v: R, n: N }; };
/* gecikmeli firmalar (dashboard detay listesi) */
FN.late = tid => { const m = {}; FN.openOrders(tid).filter(o => o.due < U.today()).forEach(o => { const a = P.rootOf("a", o.ag), x = m[a] = m[a] || { ag: a, name: P.accName(a), amt: 0, due: o.due, n: 0, orders: [] }; x.amt += E(B4M.book.oDue(o), o.cur); x.n++; x.orders.push(o.no); if (o.due < x.due) x.due = o.due; });
  return Object.values(m).map(x => ({ ...x, amt: U.r2(x.amt), days: days(x.due, U.today()) })).sort((a, b) => b.days - a.days); };
FN.remind = ag => { const a = db().get("accounts", ag); if (!a) return no(""); const L = FN.late(FN.myTid()).find(x => x.ag == ag); if (!L) return no("Gecikmiş ödeme yok.");
  const tid = FN.myTid(); B4M.mail.send({ to: a.email || "", subj: t("Ödeme hatırlatması"), body: t("{n} rezervasyonun son ödeme tarihi geçti. Toplam {a}. Lütfen ödemeyi tamamlayın.", { n: L.n, a: I.fm(L.amt, "EUR") }) + " " + L.orders.join(", "), dmc: tid == "P" ? 0 : tid, tid }); B4M.audit.log("payment.reminder", ag, L.orders.join(","), "P"); return ok("Hatırlatma e-postası gönderildi."); };
/* CSV dışa aktarma: finans raporu */
FN.csv = (tid, m) => { const r = FN.report(tid, m), c = r.cur, q = v => `"${String(v ?? "").replace(/"/g, '""')}"`, n = v => v == null ? "" : String(U.r2(v)).replace(".", ","), rows = [[t("Kalem"), t("Bu ay"), t("Önceki ay"), t("Geçen yıl aynı ay")]];
  const add = (l, f) => rows.push([t(l), n(f(r.cur)), n(f(r.prev)), n(f(r.ly))]); add("İşlem hacmi (TTV)", x => x.ttv); Object.keys(c.lines).forEach(k => add(FN.LN[k], x => x.lines[k])); add("Net gelir", x => x.net);
  Object.keys(FN.GRP).forEach(k => add(k + " " + FN.GRP[k], x => x.byCode[k])); add("FAVÖK", x => x.favok); add("Prim öncesi kâr", x => x.pre); add("Çalışan primleri", x => x.bonT); add("Net kâr", x => x.netProfit);
  return "﻿" + rows.map(r => r.map(q).join(";")).join("\r\n"); };
FN.LN = { markup: "Platform markup geliri", api: "API komisyonu", rb: "Rebooking geliri", promo: "Tanıtım (marketing) geliri", gp: "Brüt kâr (alış-satış farkı)" };
/* bildirim: kullanıcıya özel (uid) */
const baseFor = NT.forUser; NT.forUser = u => { u = u || B4M.app.user(); return baseFor(u).filter(n => !n.uid || n.uid == u.id); };
