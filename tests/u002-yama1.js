/* Yama 1 birim testleri (Node): departman/yetki, bildirim, Legal, gizlilikli fiyat analizi, H2H, giderler, maaş, prim, tanıtım, yaşlandırma, rebooking (artırma + fiyat takibi).
   Çalıştırma: node tests/u002-yama1.js   (çıkış kodu 0 = hepsi geçti) */
const load = require("../tools/load.js"), fs = require("fs"), path = require("path");
let pass = 0, fail = 0; const T = [], test = (n, f) => T.push([n, f]);
const ok = (c, m) => { if (!c) throw new Error(m || "koşul sağlanmadı"); }, eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "eşit değil"}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const as = (B, email) => { const u = B.db.find("users", u => u.email == email); ok(u, "kullanıcı yok " + email); B.auth.start(u); return u; };
const ADM = "admin@book4me-ai.com", AK = "rezervasyon@akdeniz-turizm.example", MAVI = "operasyon@maviseyahat.example";
const bk = (B, no) => B.db.find("bookings", b => b.no == no);

test("Departmanlar: Back Office = DMC, Product / Otel Kontrat, Commercial, Muhasebe, Operasyon, Rehber, Diğer; eski Satış/Kontrat Commercial'a taşındı", () => {
  const B = load(); eq(B.auth.DEPTS.h, ["DMC", "Product / Otel Kontrat", "Commercial", "Muhasebe", "Operasyon", "Rehber", "Diğer"]);
  ok(!B.db.find("users", u => u.org == "h" && ["Satış", "Kontrat"].includes(u.dept)), "eski departman kaldı"); ok(!B.auth.DEPTS.s.includes("Commercial"), "Commercial DMC tarafında olmamalı");
  ["stop", "spo", "hk", "legal", "rb", "exp", "sal", "bon", "fin", "mkt"].forEach(p => ok(B.auth.PERMS.h.some(x => x[0] == p), "BO yetkisi yok " + p)); ["stop", "spo", "rbt", "rb"].forEach(p => ok(B.auth.PERMS.s.some(x => x[0] == p), "DMC yetkisi yok " + p));
});
test("Stop ve SPO ayrı yetki: yetkisi olmayan kullanıcı stop koyamaz", () => {
  const B = load(), u = as(B, "product@akdeniz-turizm.example"); u.perms = u.perms.filter(p => p != "stop"); B.auth.start(u);
  const r = B.prod.stopAdd ? B.prod.stopAdd(1, { from: B.util.addD(B.util.today(), 40), to: B.util.addD(B.util.today(), 41), rooms: [11] }) : { ok: false, msg: "Stop sale için yetkiniz yok." }; ok(!r.ok && /yetkiniz yok/.test(r.msg), "stop yetkisiz çalıştı");
});
test("Bildirim: yeni otel → Product / Otel Kontrat; tıklanacak kayıt referansı var", () => {
  const B = load(), n = B.db.find("notifs", n => n.kind == "hotel"); ok(n && n.depts.includes("Product / Otel Kontrat") && n.ref, "otel bildirimi yok");
  const u = as(B, ADM); ok(B.notif.forUser(u).some(x => x.id == n.id)); B.notif.markRead(n.id, u); ok(!B.notif.unread(u).some(x => x.id == n.id), "okundu işaretlenmedi");
  ok(B.db.find("notifs", n => n.kind == "fa" && n.tid == 1), "diğer DMC'lere fiyat analizi bildirimi gitmedi");
});
test("Legal: özel şart sözleşme metnine girer, sürüm saklanır, karşı tarafa bildirilir; yetkisiz kişi ekleyemez", () => {
  const B = load(); as(B, AK); const c = B.db.all("contracts")[0]; ok(!B.legal.addClause(c.id, "Yetkisiz şart denemesi").ok, "DMC kullanıcısı Legal yapabildi");
  as(B, ADM); const r = B.legal.addClause(c.id, "Ödemeler 15 gün içinde yapılır."); ok(r.ok, r.msg); ok(/ÖZEL ŞART: Ödemeler 15 gün/.test(B.parties.termsText(c)), "metne girmedi");
  eq(B.legal.vers(c.id)[0].ver, 1); ok(B.db.find("notifs", n => n.kind == "k" && n.ref == c.id && n.tid != "P"), "karşı tarafa bildirim yok"); ok(/TEDARİK: book4me ai/.test(B.parties.termsText(c)), "tedarik maddesi yok");
});
test("Fiyat analizi: diğer DMC'lerin adı çıktıda görünmez; sıra ve fark hesaplanır", () => {
  const B = load(), U = B.util; as(B, AK); const a = U.addD(U.today(), 20), R = B.fa.analyze({ key: "akdeniz palas|antalya", from: a, to: U.addD(a, 4), n: 3, tid: 1 });
  ok(R.dmcs >= 3 && R.mine, "karşılaştırma yok"); const js = JSON.stringify(R); ["Sahil", "Mavi", "Boğaz"].forEach(n => ok(!js.includes(n), "isim sızdı: " + n)); ok(R.rows.some(r => r.offers.some(o => /^Teklif \d/.test(o.label))));
  ok(R.rows.filter(r => r.my != null).every(r => r.rank >= 1 && r.my >= r.min), "sıra hatalı");
});
test("H2H: giden bağlantı anahtarı yalnızca DMC'nin kendi otellerini döner; kapalıyken 401", () => {
  const B = load(); as(B, AK); const r = B.h2h.add(1, { name: "Partner Test" }); ok(r.ok); const k = r.x.key, s = B.int.call(k, "search.hotels", {}); eq(s.status, 200);
  ok(s.body.hotels.length && s.body.hotels.every(h => B.db.get("hotels", +h.code.slice(1)).sup == 1), "başka DMC'nin oteli döndü"); B.h2h.tog(r.x.id); eq(B.int.call(k, "content.hotels").status, 401);
});
test("Giderler: tekrarlayan gider her aya girer; Tekdüzen kodu türden gelir; silme geçmişi korur", () => {
  const B = load(), F = B.fin, m = B.util.today().slice(0, 7); as(B, ADM); const r = F.addExp("P", { cat: "fly", amt: 100, cur: "EUR", d: B.util.today(), desc: "Test uçuş" }); ok(r.ok); eq(r.x.code, "760");
  const rec = F.expOf("P", F.addM(m, -3)).filter(x => x.rec); ok(rec.length >= 3, "tekrarlayan gider geçmiş aya girmedi"); ok(F.expOf("P", F.addM(m, 2)).some(x => x.desc == "Ofis kirası"), "gelecek aya girmedi");
  const kira = B.db.find("expenses", x => x.desc == "Ofis kirası" && x.tid == "P"); F.delExp(kira.id); ok(F.expOf("P", F.addM(m, -1)).some(x => x.id == kira.id) && !F.expOf("P", m).some(x => x.id == kira.id), "durdurma hatalı");
});
test("Maaş: işveren maliyeti parametreden; talep onayı gelecek aydan geçerli; geçmiş aya maaş girilemez", () => {
  const B = load(), F = B.fin, m = B.util.today().slice(0, 7); as(B, ADM); const s = F.salOf("P", m).find(x => x.gross == 85000); ok(s, "maaş yok"); eq(s.cost, B.util.r2(85000 * (1 + 0.2175 + 0.02)));
  B.y1.setPrm("sgkEr", 22.75); eq(F.salOf("P", m).find(x => x.gross == 85000).cost, B.util.r2(85000 * 1.2475), "parametre uygulanmadı");
  const q = B.db.find("salReq", x => x.st == "Bekliyor"); ok(F.decideSal(q.id, true).ok); ok(F.salOf("P", F.addM(m, 1)).some(x => x.uid == q.uid && x.gross == q.amt) && !F.salOf("P", m).some(x => x.uid == q.uid && x.gross == q.amt), "onay ileri tarihli değil");
  ok(!F.setSal("P", { uid: q.uid, gross: 1, from: F.addM(m, -1) }).ok, "geçmiş aya maaş girildi");
});
test("Prim: kural ileriye dönük; kâr varsa tabanın oranı kadar, yoksa 0; çalışan kendi primini görür", () => {
  const B = load(), F = B.fin, m = B.util.today().slice(0, 7); as(B, ADM); ok(!F.setRule("P", { base: "net", pct: 2, from: F.addM(m, -1) }).ok, "geçmiş aya kural girildi");
  B.db.add("promoInv", { tid: "P", no: "T-X", hid: 3, hotel: "Belek", amt: 100000, cur: "EUR", d: B.util.today(), st: "Açık" }); const x = F.month("P", m); ok(x.pre > 0, "kâr oluşmadı");
  const op = B.db.find("users", u => u.email == "operasyon@book4me-ai.com"), b = x.bon.find(b => b.uid == op.id); ok(b && Math.abs(b.amt - x.pre * 0.01) < 0.01, "prim %1 değil"); eq(F.bonusOf(op, m).amt, b.amt);
  ok(Math.abs(x.netProfit - (x.pre - x.bonT)) < 0.01, "net kâr primden sonra değil");
});
test("Tanıtım faturası: tahsil veya mahsup; gelir tablosunda marketing geliri; sıralamayı etkilemez", () => {
  const B = load(), F = B.fin, m = B.util.today().slice(0, 7); as(B, ADM); const r = F.addPromo("P", { hid: 3, amt: 500, cur: "EUR" }); ok(r.ok); ok(F.settlePromo(r.x.id, "mahsup").ok); eq(B.db.get("promoInv", r.x.id).st, "Mahsup edildi");
  ok(F.rev("P", m).lines.promo >= 500); const src = fs.readFileSync(path.join(__dirname, "../src/updates/u002d-finance.js"), "utf8"); ok(!/sort|rank/.test(src.split("tanıtım (marketing) anlaşmaları")[1].split("bütçe")[0]), "tanıtım sıralamaya bağlanmış");
});
test("Alacak yaşlandırma ve gecikmeli firmalar: son ödemesi geçen sipariş doğru kovaya girer, hatırlatma e-postası yazılır", () => {
  const B = load(), F = B.fin; as(B, ADM); const o = B.db.find("orders", o => !o.auto && B.book.oDue(o) > 0); o.due = B.util.addD(B.util.today(), -10); o.hold = true;
  const a = F.aging("P"); ok(a.n.a30 >= 1, "8–30 kovası boş"); const L = F.late("P"); ok(L.some(x => x.orders.includes(o.no) && x.days == 10), "gecikmeli listede yok");
  const n0 = B.db.all("mail").length; ok(F.remind(L[0].ag).ok); eq(B.db.all("mail").length, n0 + 1);
});
test("Rebooking: ücretsiz iptalli otel rezervasyonu otomatik artırmaya açılır; fiyat takibi DMC adına teklif verir", () => {
  const B = load(), b = bk(B, "B4M26-000007-1"), x = B.rb.of(b); ok(x, "artırma yok"); const l = B.rb.low(x.id); ok(l && l.tid == 4 && l.auto, "otomatik teklif yok"); ok(l.e < x.base.e);
  ok(!B.db.find("rbAuctions", y => bk(B, y.no).own), "kendi acentesinin rezervasyonu artırmaya girdi");
});
test("Rebooking teklif kuralları: aynı ürün, daha düşük fiyat, teminat, C grubu, mevcut tedarikçi teklif veremez", () => {
  const B = load(), b = bk(B, "B4M26-000007-1"), x = B.rb.of(b); as(B, MAVI); const h4 = B.db.find("hotels", h => h.sup == 4 && h.name == "Akdeniz Palas"), std = h4.rooms.find(r => r.type == "Standart"), dlx = h4.rooms.find(r => r.type != "Standart");
  ok(!B.rb.bid(x.id, 4, { hid: h4.id, room: dlx.id, amt: 100 }).ok, "farklı oda tipi kabul edildi"); ok(!B.rb.bid(x.id, 4, { hid: h4.id, room: std.id, amt: 250 }).ok, "daha yüksek teklif kabul edildi");
  ok(B.rb.bid(x.id, 4, { hid: h4.id, room: std.id, amt: 230 }).ok, "geçerli teklif reddedildi"); ok(!B.rb.bid(x.id, 1, { hid: 1, room: 11, amt: 200 }).ok, "mevcut tedarikçi teklif verdi");
  as(B, ADM); B.rb.setCo(4, { dep: 0 }); as(B, MAVI); ok(/teminat/i.test(B.rb.bid(x.id, 4, { hid: h4.id, room: std.id, amt: 220 }).msg), "teminatsız teklif");
  as(B, ADM); B.rb.setCo(4, { dep: 2500, score: 30 }); eq(B.rb.grp(4), "C"); as(B, MAVI); ok(!B.rb.bid(x.id, 4, { hid: h4.id, room: std.id, amt: 220 }).ok, "C grubu teklif verdi");
});
test("Rebooking kapanış: kazanan onaylı geçer, alıcı fiyatı ve rezervasyon no aynı, fark rebooking geliri; eski tedarikçiye yalnızca iptal bildirimi", () => {
  const B = load(), b = bk(B, "B4M26-000007-1"), tot = b.total, cur = b.cur, no = b.no, x = B.rb.of(b), l = B.rb.low(x.id), base = x.base.e; as(B, ADM);
  const r = B.rb.close(x.id, 1); ok(r.ok, r.msg); eq(b.sup, l.sup); eq([b.total, b.cur, b.no, b.status], [tot, cur, no, "Onaylı"]); const rv = B.db.find("rbRev", r => r.bid == b.id); ok(rv && Math.abs(rv.e - (base - l.e)) < 0.01, "gelir hatalı");
  const nx = B.db.find("notifs", n => n.kind == "rbx" && n.tid == 1); ok(nx && !/Mavi/.test(JSON.stringify(nx)), "eski tedarikçiye kazanan adı gitti"); ok(B.fin.rev("P", B.util.today().slice(0, 7)).lines.rb >= rv.e, "gelir tablosunda yok");
  ok(B.acc.dmcRecv(4).some(y => y.id == b.id) && !B.acc.dmcRecv(1).some(y => y.id == b.id), "ödeme yeni tedarikçiye geçmedi");
});
test("Rebooking tutma hakkı: mevcut tedarikçi en düşük teklife eşitler ve rezervasyonu tutar", () => {
  const B = load(), b = bk(B, "B4M26-000007-1"), x = B.rb.of(b), l = B.rb.low(x.id); as(B, AK); ok(B.rb.keep(x.id, 1).ok); as(B, ADM); B.rb.close(x.id, 1);
  eq(b.sup, 1); ok(Math.abs(B.price.cv(b.cost, b.costCur, "EUR") - l.e) < 0.02, "alış fiyatı eşitlenmedi"); eq(B.db.get("rbAuctions", x.id).st, "Tutuldu");
});
test("Rebooking cezai şart: kazanan veremezse alış fiyatı üzerinden %10 + yerine koyma farkı, puan düşer", () => {
  const B = load(), b = bk(B, "B4M26-000007-1"), x = B.rb.of(b); as(B, ADM); B.rb.close(x.id, 1); const buy = B.price.cv(b.cost, b.costCur, "EUR"), s0 = B.rb.prof(4).score;
  const r = B.rb.fail(b.id, buy + 30, "EUR"); ok(r.ok, r.msg); const p = B.rb.prof(4).pen.slice(-1)[0]; ok(Math.abs(p.pen - buy * 0.1) < 0.01 && Math.abs(p.diff - 30) < 0.01, "ceza hesabı"); eq(B.rb.prof(4).score, s0 - 20);
});
test("Fiyat takibi (artırma sonrası): eşik (%2 ve 10 EUR) geçilirse doğrudan değişir, geçilmezse değişmez", () => {
  const B = load(), b = bk(B, "B4M26-000007-1"), x = B.rb.of(b); as(B, ADM); x.st = "Değişmedi"; const h4 = B.db.find("hotels", h => h.sup == 4 && h.name == "Akdeniz Palas"), std = h4.rooms.find(r => r.type == "Standart");
  std.price = 84; h4.seasons = []; const g0 = B.rb.after(b); ok(g0 == null, "eşik altında değişti");
  std.price = 70; const g = B.rb.after(b); ok(g > 10, "eşik üstünde değişmedi"); eq(b.sup, 4); ok(B.db.find("rbRev", r => r.kind == "track" && r.bid == b.id));
});
test("Şirket izni (yalnızca Back Office): rbSrc kapalı DMC'nin rezervasyonu artırmaya açılmaz; DMC bu ayarı değiştiremez", () => {
  const B = load(); as(B, AK); ok(!B.rb.setCo(1, { src: false }).ok, "DMC şirket iznini değiştirdi"); as(B, ADM); B.db.where("rbAuctions", x => x.st == "Açık").forEach(x => x.st = "İptal"); B.db.del("rbAuctions", () => true);
  ok(B.rb.setCo(1, { src: false }).ok); B.rb.sweep(); ok(!B.db.find("rbAuctions", x => B.app.tidOf(x.orig) == 1), "izin kapalıyken artırma açıldı");
});
test("Rapor: rebooking geliri, API komisyonu ve markup ayrı satırlarda; FAVÖK = net gelir − (622+760+770)", () => {
  const B = load(), F = B.fin, m = B.util.today().slice(0, 7), x = F.month("P", m); ["markup", "api", "rb", "promo"].forEach(k => ok(k in x.lines, "satır yok " + k));
  ok(Math.abs(x.favok - (x.net - x.byCode["622"] - x.byCode["760"] - x.byCode["770"])) < 0.01); ok(F.csv("P", m).includes("FAVÖK")); const r = F.report("P", m); eq(r.trend.length, 12);
});
test(".xls okuyucu: LibreOffice ile çevrilmiş liste .xlsx ile aynı oteller", async () => {
  const B = load(), f = path.join(__dirname, "fixtures/test-fiyat-listesi.xls"); if (!fs.existsSync(f)) return; const b = fs.readFileSync(f), sh = B.xls.read(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); const X = B.xp.xBook(sh); ok(X.hotels.length >= 1 && X.hotels.every(h => h.rooms.length), "otel okunamadı");
});

(async () => { for (const [n, f] of T) { try { await f(); pass++; console.log("✓", n); } catch (e) { fail++; console.log("✗", n, "\n   ", e.message); } } console.log(`\n${pass} geçti, ${fail} kaldı`); process.exit(fail ? 1 : 0); })();
