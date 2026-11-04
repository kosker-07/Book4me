/* Demo verisi: v40 prototipinin son durumuyla aynı firmalar, kullanıcılar, ürünler ve örnek rezervasyonlar. Tüm demo şifreleri: book4me */
const SD = B4M.seed = {};
SD.run = db => {
  B4M.db = db; const U2 = U, td = U.today(), ad = n => U.addD(td, n), P = B4M.parties, AU = B4M.auth, PR = B4M.price, now = U.now();
  db.cfg("rates", { ...PR.DEF_RATES }); db.cfg("rules", P.seedRules()); PR.table(); PR.comm(); B4M.lic.pkgs();
  ["Antalya Havalimanı (AYT)", "Lara", "Belek", "İstanbul Havalimanı (IST)", "Sultanahmet", "Beşiktaş"].forEach(z => db.add("zones", { name: z }));
  [["TRY", "01"], ["EUR", "02"], ["USD", "03"]].forEach(([c, n]) => db.add("banks", { cur: c, bank: "Örnek Bankası (demo)", holder: "book4me ai A.Ş.", iban: "TR00 0000 0000 0000 0000 0000 " + n }));
  const ch = { h: { hq: true, own: true }, t: { hq: true, own: true }, u: { hq: true, own: true } }, mgn = { h: 10, t: 15, u: 20, f: 5 };
  const D = (id, name, code, email, slug, x) => db.add("dmcs", { id, name, code, email, slug, tid: id, mgn: { ...mgn }, ch: U.clone(ch), ...(x || {}) });
  D(1, "Akdeniz Turizm", "1111", "rezervasyon@akdeniz-turizm.example", "akdeniz", { api: { name: "Akdeniz Uçuş API", url: "https://api.akdeniz-turizm.example/v1/flights", key: "demo-akd-7f3a", on: true, test: "" } });
  D(2, "Boğaz Otelcilik", "2222", "operasyon@bogaz-otelcilik.example", "bogaz");
  D(3, "Sahil Tedarik", "3333", "booking@sahil-tedarik.example", "sahil", { api: { name: "Sahil Air Connect", url: "https://connect.sahil-tedarik.example/air", key: "demo-shl-19c2", on: true, test: "" } });
  D(4, "Mavi Seyahat", "1234", "operasyon@maviseyahat.example", "mavi", { fromAg: 1 }); D(5, "Rota Tur", "5678", "info@rotatur.example", "rota", { fromAg: 2 });
  D(6, "Kemer Otelcilik", "", "rezervasyon@kemerotelcilik.example", "", { parent: 1, tid: 1, pp: { h: 6, t: 6, f: 0, u: 6 } });
  D(7, "Mavi Ankara Turizm", "", "ankara@maviseyahat.example", "", { parent: 4, tid: 4, pp: { h: 6, t: 6, f: 0, u: 6 } });
  D(8, "Kemer Holiday Travel", "", "info@kemerholiday.example", "", { parent: 1, tid: 1 });
  [[1, "Kurumsal"], [2, "Profesyonel"], [3, "Başlangıç"], [4, "Profesyonel"], [5, "Başlangıç"]].forEach(([id, pk]) => B4M.lic.create(id, pk));
  db.get("dmcs", 1).brand = { title: "Akdeniz Turizm", logo: "", icon: "A", ac: "#0E5A6E", gd: "#C77A1E", sender: "rezervasyon@akdeniz-turizm.example", lang: "tr", cur: "EUR", domain: { name: "www.akdeniz-turizm.example", status: "Doğrulandı", ssl: `Otomatik sertifika · ${td}`, mail: true, dns: true, at: now }, support: true };
  /* sözleşmeler */
  const full = (p, pid, pn, o) => P.mkK(p, pid, { ...o, start: ad(-60), sigM: { name: o.by ? P.name(o.by.p, o.by.id) + " Yetkilisi" : "Platform Yetkilisi", at: ad(-60) + " 10:00" }, sigP: { name: pn + " Yetkilisi", at: ad(-60) + " 10:00" }, docs: P.fullDocs(pn, "", ad(-59) + " 09:00"), ver: { at: ad(-59) + " 11:00", code: "" }, tid: o.tid });
  full("s", 1, "Akdeniz Turizm", { curs: ["EUR", "USD", "TRY"], services: ["h", "t", "f", "u"], end: ad(305), tid: 1 });
  full("s", 2, "Boğaz Otelcilik", { curs: ["EUR", "TRY", "USD"], services: ["h", "t", "u"], end: ad(305), tid: 2 });
  full("s", 3, "Sahil Tedarik", { curs: ["EUR"], services: ["h", "t", "f", "u"], end: ad(20), tid: 3 });
  full("s", 4, "Mavi Seyahat", { curs: ["EUR", "USD", "TRY"], services: ["h", "t", "f", "u"], end: ad(305), tid: 4 });
  P.mkK("s", 5, { curs: ["TRY", "EUR"], services: ["h", "t", "f", "u"], end: ad(365), sigM: { name: "Platform Yetkilisi", at: now }, tid: 5 });
  P.mkK("s", 6, { by: { p: "s", id: 1 }, curs: ["EUR", "TRY"], services: ["h", "t"], end: ad(305), sigM: { name: "Akdeniz Turizm Yöneticisi (Akdeniz Turizm)", at: td + " 09:00" }, tid: 1 });
  full("s", 7, "Mavi Ankara Turizm", { by: { p: "s", id: 4 }, curs: ["EUR", "TRY"], services: ["h", "t", "u"], end: ad(305), tid: 4 });
  full("s", 8, "Kemer Holiday Travel", { by: { p: "s", id: 1 }, curs: ["EUR", "USD", "TRY"], services: ["h", "t", "f", "u"], end: ad(305), tid: 1 });
  /* satış (alıcı) hesapları */
  const A = (id, name, email, x) => db.add("accounts", { id, name, email, code: "", ...x });
  A(11, "Akdeniz Turizm (alıcı)", "rezervasyon@akdeniz-turizm.example", { buyer: 1, tid: 1, mk: 10 });
  A(12, "Mavi Seyahat", "operasyon@maviseyahat.example", { buyer: 4, tid: 4, mk: 15, pre: { on: true, cur: "USD", amt: 10000 } });
  A(13, "Rota Tur", "info@rotatur.example", { buyer: 5, tid: 5, mk: 10 });
  A(14, "Mavi Ankara Turizm", "ankara@maviseyahat.example", { buyer: 7, parent: 12, tid: 4, mk: 12, pp: { h: 8, t: 10, f: 3, u: 8 } });
  A(15, "Kemer Holiday Travel", "info@kemerholiday.example", { owner: 1, buyer: 8, tid: 1, dmk: { h: 12, t: 10, u: 15 } });
  full("a", 11, "Akdeniz Turizm", { curs: ["EUR", "USD", "TRY"], services: ["h", "t", "f", "u"], end: ad(305), tid: 1 });
  full("a", 12, "Mavi Seyahat", { curs: ["EUR", "USD", "TRY"], services: ["h", "t", "f", "u"], end: ad(305), comm: 12, cancel: 3, tid: 4 });
  P.mkK("a", 13, { curs: ["TRY", "EUR"], services: ["h", "t", "f", "u"], end: ad(365), comm: 10, cancel: 7, sigM: { name: "Platform Yetkilisi", at: now }, tid: 5 });
  full("a", 14, "Mavi Ankara Turizm", { by: { p: "a", id: 12 }, curs: ["EUR", "TRY"], services: ["h", "t", "u"], end: ad(305), tid: 4 });
  full("a", 15, "Kemer Holiday Travel", { by: { p: "s", id: 1 }, curs: ["EUR", "USD", "TRY"], services: ["h", "t", "u"], end: ad(305), tid: 1 });
  db.all("contracts").forEach(c => { if (c.ver && !c.ver.code) c.ver.code = P.kCode(c); });
  /* kullanıcılar */
  const u = (org, oid, name, email, dept, x) => AU.addUserRaw({ org, oid, name, email, role: dept ? "user" : "admin", dept: dept || "", perms: dept ? [...AU.TPL[org][dept]] : [], unit: "", tid: org == "h" ? "P" : org == "s" ? B4M.app.tidOf(oid) : P.tidFor("a", oid), ...(x || {}) });
  u("h", 0, "Back Office Yöneticisi", "admin@book4me-ai.com");
  u("h", 0, "Selin Demir", "muhasebe@book4me-ai.com", "Muhasebe", { mgr: true }); u("h", 0, "Burak Şahin", "satis@book4me-ai.com", "Satış");
  u("h", 0, "Elif Arslan", "kontrat@book4me-ai.com", "Kontrat", { perms: [...AU.TPL.h.Kontrat, "dbf"] }); u("h", 0, "Kerem Aydın", "dmc@book4me-ai.com", "DMC"); u("h", 0, "Elif Demir", "operasyon@book4me-ai.com", "Operasyon");
  [[1, "Akdeniz Turizm", "rezervasyon@akdeniz-turizm.example"], [2, "Boğaz Otelcilik", "operasyon@bogaz-otelcilik.example"], [3, "Sahil Tedarik", "booking@sahil-tedarik.example"], [4, "Mavi Seyahat", "operasyon@maviseyahat.example"], [5, "Rota Tur", "info@rotatur.example"], [6, "Kemer Otelcilik", "rezervasyon@kemerotelcilik.example"], [7, "Mavi Ankara Turizm", "ankara@maviseyahat.example"], [8, "Kemer Holiday Travel", "info@kemerholiday.example"]].forEach(([id, n, e]) => u("s", id, n + " Yöneticisi", e));
  u("s", 1, "Mehmet Demir", "mehmet@akdeniz-turizm.example", "Product"); u("s", 1, "Can Aksoy", "operasyon@akdeniz-turizm.example", "Operasyon", { mgr: true, unit: "Operasyon" });
  u("s", 1, "Deniz Kurt", "deniz@akdeniz-turizm.example", "Rezervasyon", { mgr: true }); u("s", 1, "Mert Öz", "product@akdeniz-turizm.example", "Product"); u("s", 1, "Zeynep Ak", "muhasebe@akdeniz-turizm.example", "Muhasebe", { perms: [...AU.TPL.s.Muhasebe, "dbf"] });
  u("s", 4, "Ayşe Kaya", "ayse@maviseyahat.example", "Rezervasyon", { unit: "Kadıköy şubesi" });
  const G = [["Ahmet Yılmaz", "ahmet@rehber.example", "Kemer"], ["Zeynep Kara", "zeynep@rehber.example", "Lara / Belek"], ["Murat Öz", "murat@rehber.example", "Side"]].map(([n, e, r]) => u("s", 1, n, e, "Rehber", { unit: r }));
  /* oteller */
  const R = (id, type, cap, price, allot, x) => ({ id, type, cap, ma: Math.min(cap, cap > 2 ? 3 : 2), mc: Math.max(0, cap - 1), bed: cap > 2 ? "Çift kişilik + tek" : "Çift kişilik", view: "", size: cap > 3 ? 42 : cap > 2 ? 32 : 24, price, nrp: 0, allot, stop: [], ...(x || {}) });
  const H = (id, sup, name, city, zone, stars, board, cur, rooms, x) => db.add("hotels", { id, sup, tid: sup, name, country: "TR", city, zone, stars, board, cur, cxd: 7, addr: { line: "", zip: "", phone: "", email: "", lat: "", lng: "" }, rooms, spo: [], stops: [], ...(x || {}) });
  H(1, 1, "Akdeniz Palas", "Antalya", "Lara", 5, "Her şey dahil", "EUR", [R(11, "Standart", 2, 100, 10, { view: "Kara" }), R(12, "Deluxe Deniz", 3, 130, 4, { view: "Deniz" })], { cxd: 7, addr: { line: "Güzeloba Mah. Lara Cad. No:1 (demo)", zip: "07230", phone: "+90 242 000 00 01", email: "", lat: "", lng: "" }, mk: { mode: "all", list: [], adj: { GB: 10 } } });
  H(2, 3, "Akdeniz Palas", "Antalya", "Lara", 5, "Her şey dahil", "EUR", [R(21, "Standart", 2, 94, 6, { nrp: 85, view: "Kara" }), R(22, "Deluxe Deniz", 3, 135, 3, { view: "Deniz" })], { cxd: 3, mk: { mode: "only", list: ["DE", "NL", "PL", "GB"], adj: {} } });
  H(3, 1, "Belek Golf Resort", "Antalya", "Belek", 5, "Ultra her şey dahil", "USD", [R(31, "Standart", 2, 120, 8, { nrp: 105, view: "Bahçe" }), R(32, "Aile Odası", 4, 180, 6, { view: "Havuz" })], { cxd: 14, mk: { mode: "except", list: ["TR"], adj: {} } });
  H(4, 2, "Boğaz Butik", "İstanbul", "Beşiktaş", 4, "Oda kahvaltı", "EUR", [R(41, "Double", 2, 140, 6, { view: "Şehir" }), R(42, "Aile Süit", 4, 230, 3, { view: "Deniz" })], { cxd: 2 });
  H(5, 2, "Sultan Suites", "İstanbul", "Sultanahmet", 3, "Oda kahvaltı", "TRY", [R(51, "Twin", 2, 2800, 5, { nrp: 2500, view: "Şehir" }), R(52, "Aile Odası", 4, 3900, 3, { view: "Şehir" })], { cxd: 1 });
  H(9, 2, "Coral Bay Resort Hurghada", "Kızıldeniz", "Hurghada", 5, "Her şey dahil", "USD", [{ id: 91, type: "Superior", cap: 3, ma: 2, mc: 1, bed: "Çift kişilik", view: "Bahçe", size: 30, price: 85, nrp: 72, allot: 10, stop: [] }, { id: 92, type: "Deniz Manzaralı", cap: 3, ma: 3, mc: 1, bed: "King", view: "Deniz", size: 36, price: 110, nrp: 0, allot: 6, stop: [] }], { country: "EG", cxd: 3, addr: { line: "Village Road (demo)" } });
  const h1 = db.get("hotels", 1), Y = +td.slice(0, 4) - (+td.slice(5, 7) < 4 ? 1 : 0), se = (nm, ty, f, to, ps) => ({ id: db.seq(), name: nm, type: ty, from: f, to, periods: ps.map(([n, a, b, k]) => ({ id: db.seq(), name: n, from: a, to: b, prices: Object.fromEntries(h1.rooms.map(r => [r.id, { price: Math.round(r.price * k), nrp: 0 }])) })) });
  h1.seasons = [se(`Kış ${Y}-${String(Y + 1).slice(2)}`, "Kış", `${Y}-11-01`, `${Y + 1}-03-31`, [["P1 Kasım–Aralık", `${Y}-11-01`, `${Y}-12-20`, .95], ["P2 Yılbaşı", `${Y}-12-21`, `${Y + 1}-01-04`, 1.4], ["P3 Ocak–Mart", `${Y + 1}-01-05`, `${Y + 1}-03-31`, .9]]), se(`Yaz ${Y + 1}`, "Yaz", `${Y + 1}-04-01`, `${Y + 1}-10-31`, [["P1 Nisan–Mayıs", `${Y + 1}-04-01`, `${Y + 1}-05-31`, 1.1], ["P2 Haziran", `${Y + 1}-06-01`, `${Y + 1}-06-30`, 1.4], ["P3 Temmuz–Ağustos", `${Y + 1}-07-01`, `${Y + 1}-08-31`, 1.7], ["P4 Eylül–Ekim", `${Y + 1}-09-01`, `${Y + 1}-10-31`, 1.3]])];
  h1.spo = [{ id: db.seq(), name: "Erken rezervasyon", type: "Erken rezervasyon", pct: 10, sf: td, st: ad(180), bf: td, bt: ad(60), minN: 2, rooms: [], on: true }];
  db.get("hotels", 3).spo = [{ id: db.seq(), name: "Uzun konaklama", type: "Uzun konaklama", pct: 15, sf: td, st: ad(365), bf: td, bt: ad(365), minN: 7, rooms: [], on: true }];
  /* transferler ve turlar */
  const T = (id, sup, f, to, veh, price, x) => db.add("transfers", { id, sup, tid: sup, from: f, to, veh, price, cur: "EUR", cxd: 1, toIl: ["Lara", "Belek"].includes(to) ? "Antalya" : ["Sultanahmet", "Beşiktaş"].includes(to) ? "İstanbul" : "", country: "TR", ...(x || {}) });
  T(61, 1, U.AYT, "Lara", "Sedan", 25); T(62, 1, U.AYT, "Lara", "Minivan", 40); T(63, 1, U.AYT, "Lara", "Minibüs", 70); T(64, 1, U.AYT, "Belek", "Sedan", 30); T(65, 1, U.AYT, "Belek", "Minivan", 45); T(66, 3, U.AYT, "Lara", "Sedan", 22);
  T(67, 2, U.IST, "Sultanahmet", "Sedan", 30); T(68, 2, U.IST, "Sultanahmet", "Minivan", 50); T(69, 2, U.IST, "Beşiktaş", "Sedan", 28);
  T(70, 2, "Hurghada Havalimanı (HRG)", "Hurghada", "Sedan", 20, { cur: "USD", toIl: "Kızıldeniz", country: "EG" }); T(71, 2, "Hurghada Havalimanı (HRG)", "Hurghada", "Minivan", 32, { cur: "USD", toIl: "Kızıldeniz", country: "EG" });
  const Tu = (id, sup, name, city, dur, price, cur, quota, ds, cxd, x) => db.add("tours", { id, sup, tid: sup, name, city, dur, price, cur, quota, dates: ds.map(ad), cxd, ...(x || {}) });
  Tu(81, 1, "Kaleiçi ve Düden Şelalesi Turu", "Antalya", "1 gün", 45, "EUR", 20, [7, 8, 9, 10], 2); Tu(82, 3, "Kaleiçi ve Düden Şelalesi Turu", "Antalya", "1 gün", 41, "EUR", 15, [7, 9], 1, { mk: { mode: "only", list: ["DE", "GB", "NL"], adj: {} } });
  Tu(83, 2, "Boğaz Tekne Turu", "İstanbul", "4 saat", 35, "EUR", 25, [7, 8, 9, 10], 1); Tu(84, 2, "Kapadokya Balon Turu", "Nevşehir", "Sabah", 220, "USD", 12, [8, 12], -1);
  /* rehber ürünleri, hizmet tedarikçileri, rehber satışları */
  const OS = [["Kemer Tekne Turları", "rezervasyon@kemertekne.example", "+90 242 000 11 22", 0], ["Toros Rafting & Safari", "booking@torosrafting.example", "+90 242 000 33 44", 0], ["Sahil Tedarik", "booking@sahil-tedarik.example", "", 3], ["Pamukkale Express", "", "+90 258 000 55 66", 0]].map(([name, email, phone, sup]) => db.add("opSup", { dmc: 1, tid: 1, name, email, phone, sup }).id);
  const [kt, tr, sh, pe] = OS, GP = (kind, unit, name, region, time, days, sa, sc, buy, desc, max) => db.add("gprod", { dmc: 1, tid: 1, kind, unit, name, region, time, days, sale: { ad: sa, ch: sc, cur: "EUR" }, chAge: "3-11", max: max || 7, buy: buy.map(([sid, a, c]) => ({ sid, ad: a, ch: c, cur: "EUR" })), active: true, desc: desc || "" });
  const P0 = GP("u", "kişi", "Kemer Tekne Turu", "Kemer", "09:30", [1, 2, 3, 4, 5, 6, 7], 35, 18, [[kt, 22, 11], [sh, 24, 12]], "Öğle yemeği dahil, 3 koy molası"), P1 = GP("u", "kişi", "Köprülü Kanyon Rafting", "Antalya", "08:30", [1, 2, 3, 4, 5, 6, 7], 45, 25, [[tr, 28, 14]], "Öğle yemeği ve transfer dahil"), P2 = GP("u", "kişi", "Pamukkale Turu", "Antalya", "05:30", [2, 4, 6], 65, 35, [[pe, 40, 20], [sh, 42, 21]], "Hierapolis ve travertenler");
  GP("u", "kişi", "Jeep Safari", "Kemer", "09:00", [1, 3, 5, 7], 40, 20, [[tr, 25, 12]]); GP("t", "araç", "Havalimanı → Kemer özel transfer", "Kemer", "", [1, 2, 3, 4, 5, 6, 7], 70, 0, [[sh, 45, 0]], "1–7 kişi, araç başı", 7);
  P0.ch = { hq: true, own: true }; P0.net = { ad: 28 }; P0.quota = 40; B4M.ops.sync(P0); P1.ch = { hq: false, own: true }; P1.net = { ad: 36 }; B4M.ops.sync(P1);
  const OP = B4M.ops, mk = (gi, p, d, cust, hotel, a, c, paid, pm) => { const s = db.add("gsales", { dmc: 1, tid: 1, no: OP.nextNo(), gid: G[gi].id, pid: p.id, d: ad(d), cust, phone: "", hotel, room: "", ad: a, ch: c, inf: 0, sale: { ...p.sale }, paid, pm, note: "", at: now, st: "Yeni", sid: 0, buy: null, pick: p.time, pickAt: hotel, cashIn: false, log: [] }); const bb = OP.best(p, a, c); if (bb) { s.sid = bb.sid; s.buy = { ad: bb.ad, ch: bb.ch || 0, cur: bb.cur }; } s.total = OP.sale(s); OP.log(s, "Rehber {g} satışı girdi", { g: G[gi].name }); return s; };
  mk(0, P0, 2, "Hans Müller", "Rixos Sungate", 2, 1, true, "Nakit"); mk(1, P1, 3, "Olga Petrova", "Titanic Beach Lara", 2, 0, true, "Kredi kartı"); const s3 = mk(0, P2, 4, "Ali Rahman", "Kirman Sidemarin", 2, 2, false, "");
  const b0 = P2.buy[0]; s3.sid = b0.sid; s3.buy = { ad: b0.ad, ch: b0.ch, cur: b0.cur }; s3.st = "Düzenlendi"; s3.opBy = "Can Aksoy"; OP.log(s3, "{b} düzenledi: {s}, alış {a}", { b: "Can Aksoy", s: "Pamukkale Express", a: I.fm(OP.cost(s3), "EUR") });
  /* bakiye ve ön ödeme */
  const BK = B4M.book; db.add("topups", { ag: 12, cur: "USD", amt: 10000, m: "Havale/EFT", at: now, state: "Onaylandı", tid: 4 }); BK.ledger(12, "USD", "Ön ödeme yükleme (havale/EFT)", {}, 0, 10000); BK.ledger(12, "EUR", "Bakiye yükleme (havale/EFT)", {}, 0, 300);
  /* örnek rezervasyonlar */
  const SR = B4M.search, place = (ag, items, cur, x) => { const r = BK.place({ ag, items, label: items[0].desc, cur, nat: "TR", by: "Demo", resale: x && x.resale, noResale: !(x && x.resale), at: now }); return r.order ? BK.oBks(r.order) : []; };
  const tr1 = db.get("transfers", 61), tr3 = db.get("transfers", 66), q = ag => SR.q({ ag });
  place(15, [{ ...SR.trItem(tr1, 1, ad(9), "", q(15)), guests: ["Peter Wood", "Anne Wood"] }], "USD");
  const gt = db.find("tours", x => x.gp == P0.id); if (gt) place(15, [{ ...SR.tourItem(gt, gt.dates[4] || gt.dates[0], 3, ["Lena Fischer", "Jan Fischer", "Mia Fischer"], q(15)) }], "EUR");
  const [bm] = place(12, [{ ...SR.trItem(tr1, 2, ad(9), ad(16), q(12)), guests: ["Ayşe Yıldız"] }], "TRY"); if (bm) bm.dbuy = { amt: U.r2(bm.cost * .78), cur: "EUR" };
  place(11, [{ ...SR.trItem(tr3, 1, ad(12), "", q(11)), guests: ["Al Mansour grubu"] }], "USD", { resale: { to: "Al Mansour Travel (Dubai)", amt: 80, cur: "EUR" } });
  const ot = db.get("tours", 83); place(11, [{ ...SR.tourItem(ot, ot.dates[0], 2, ["Omar Saleh", "Lina Saleh"], q(11)) }], "USD", { resale: { to: "Gulf Holidays LLC", amt: 110, cur: "USD" } });
  const hb = (ag, hid, a, n, cur, guests, x) => { const h = db.get("hotels", hid), r = h.rooms[0], b = ad(a + n), qq = SR.q({ ag, a: ad(a), b }), ns = U.nights(ad(a), b), tot = B4M.prod.stayT(h, r, ns, "r", qq, null); if (tot == null) return; place(ag, [{ kind: "h", cxd: h.cxd ?? 7, hid: h.id, room: r.id, sup: h.sup, desc: `${h.name} – ${r.type} (oda 1)`, a: ad(a), b, ns, cur: h.cur, total: tot, guests, ages: [] }], cur, x); };
  hb(15, 1, 14, 4, "EUR", ["Mark Taylor", "Sue Taylor"]); hb(12, 1, 20, 3, "TRY", ["Deniz Aksoy", "Can Aksoy"]); hb(15, 3, 25, 5, "USD", ["John Miller", "Kate Miller"]); hb(12, 3, 30, 2, "EUR", ["Elena Rossi", "Marco Rossi"]);
  hb(12, 4, 10, 3, "EUR", ["Hans Becker"]); hb(14, 5, 18, 2, "TRY", ["Murat Ekinci", "Seda Ekinci"]);
  /* DMC'nin kendi uçuş API'sinden kendi alıcı hesabıyla satış: %1 + %1 komisyon */
  const fo = SR.apiFlights("İstanbul (IST)", "Antalya (AYT)", ad(15), 2, q(11)).find(o => o.sup == 1) || SR.apiFlights("İstanbul (IST)", "Antalya (AYT)", ad(15), 2, { ag: 0 }).map(o => ({ ...o, sup: 1, own: true }))[0];
  if (fo) place(11, [SR.flItem({ ...fo, sup: 1 }, 2, ["Kerem Uçar", "Ece Uçar"])], "EUR", { resale: { to: "Uçar Ailesi", amt: U.r2(fo.price * 2 * 1.12), cur: "EUR" } });
  /* ödemeler: bir kısmı ödenmiş, Mavi'nin EUR rezervasyonları ön ödemede bloke */
  const AC = B4M.acc; db.all("orders").forEach((o, i) => { if (o.ag == 12 && o.cur == "EUR") AC.preApply(o, false); else if (i % 3 == 0) AC.doPay(o, "Kredi kartı", BK.oDue(o)); });
  /* dashboard için oluşturma tarihlerini son 4 haftaya yay */
  const L = db.all("orders").slice().sort((a, b) => a.id - b.id); L.forEach((o, i) => { if (i < L.length - 2) { o.at = ad(-((i * 5 + 3) % 27) - 1) + " " + U.pad(9 + i % 8, 2) + ":" + U.pad(i * 7 % 60, 2); BK.oBks(o).forEach(b => b.at = o.at); } });
  db.all("commissions").forEach(c => { const b = db.get("bookings", c.bid); if (b) { c.at = b.at; c.month = b.at.slice(0, 7); } });
  B4M.lic.announce("book4me ai v41 yayında", "Yeni yapı: dil dosyaları, marka ayarları, Entegrasyon ve Agent merkezleri. Tüm entegrasyonlar ve agentlar kapalı kuruldu; hazır olduğunuzda tek tıkla açabilirsiniz.", "all");
  db.cfg("seededAt", now);
};
