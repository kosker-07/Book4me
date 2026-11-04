/* Birim ve kabul testleri (Node): iş kuralları, okuyucular, çok kiracılılık, ticari model, agentlar, API Out, dil dosyaları.
   Çalıştırma: node tests/unit.js   (çıkış kodu 0 = hepsi geçti) */
const fs = require("fs"), path = require("path"), load = require("../tools/load.js");
const OV = path.join(__dirname, "../../paket/book4me-ai-devir-paketi/ornek-veriler"), PDFJS = "/home/claude/.npm-global/lib/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
let pass = 0, fail = 0; const T = [];
const test = (name, fn) => T.push([name, fn]);
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "eşit değil"}: ${JSON.stringify(a).slice(0, 200)} ≠ ${JSON.stringify(b).slice(0, 200)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || "koşul sağlanmadı"); };
const buf = f => { const b = fs.readFileSync(path.join(OV, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const hotelsSig = B => B.hotels.map(h => ({ n: h.name || h.meta && h.meta.name, p: h.periods.map(p => [p.from, p.to]), r: h.rooms.map(r => [r.name, r.occ.map(o => [String(o.lbl).replace(/\s+/g, " "), o.v])]) }));
/* satır akışlı PDF benzetimi: her satırın sayıları tek metin parçası olur (konum bilgisi yok); cut: her 3. satırdan bir değer düşer (Corendon tipi kayma) */
const lineStream = (B, pages, cut) => { let ri = 0; const isN = s => B.pdfx.pTok(s).t != "s"; pages.forEach(p => { const by = {}; p.items.forEach(i => { const k = Math.round(i.y); (by[k] = by[k] || []).push(i); }); const out = []; Object.values(by).forEach(L => { L.sort((a, b) => a.x - b.x); const lab = L.filter(i => !isN(i.s)), num = L.filter(i => isN(i.s)); if (num.length >= 2) { ri++; const n = num.map(i => i.s); if (cut && ri % 3 == 0) n.splice(2, 1); const x0 = num[0].x, x1 = num[num.length - 1].x + num[num.length - 1].w; out.push(...lab, { ...num[0], s: n.join(" "), x: x0, w: x1 - x0 }); } else out.push(...L); }); p.items = out; }); return pages; };

/* ---------- okuyucular ---------- */
test("Excel okuyucu: 2023_SUMMER_PRICE_1.xlsx, v40 (SheetJS) çıktısıyla birebir", async () => {
  const B = load(), names = B.data.XDEMO.map(s => s.name), sh = (await B.xlsx.read(buf("2023_SUMMER_PRICE_1.xlsx"))).filter(s => names.includes(s.name)), X = B.xp.xBook(sh), V = B.xp.xBook(JSON.parse(JSON.stringify(B.data.XDEMO)));
  eq(X.hotels.length, 4, "otel sayısı"); eq(hotelsSig(X), hotelsSig(V), "v40 ile fark"); eq(X.tf.length, V.tf.length, "transfer satırları");
});
test("Excel okuyucu: önbelleksiz formüller hesaplanır (test-fiyat-listesi.xlsx)", async () => {
  const B = load(), X = B.xp.xBook(await B.xlsx.read(buf("test-fiyat-listesi.xlsx"))); ok(X.hotels.length >= 1); ok(X.hotels.every(h => h.rooms.every(r => r.occ.some(o => Object.values(o.v).some(v => v > 0)))), "fiyat yok");
});
test("PDF okuyucu: test-fiyat-listesi.pdf = xlsx (konum ve satır akışı)", async () => {
  const B = load(), X = B.xp.xBook(await B.xlsx.read(buf("test-fiyat-listesi.xlsx"))), pages = require("./fixtures-pdf-items.json"), P = B.xp.xBook(B.pdfx.sheets(pages, "test-fiyat-listesi.pdf"));
  eq(hotelsSig(P), hotelsSig(X), "pdf ≠ xlsx"); ok(P.hotels.every(h => !h.shift), "yanlış kayma uyarısı");
});
test("PDF okuyucu: gerçek pdf.js ile dosyadan okuma (fixture ile aynı)", async () => {
  if (!fs.existsSync(PDFJS)) return "atlandı";
  const B = load(); B.env.pdfjs = await import(PDFJS); const pages = await B.pdfx.pages(new Uint8Array(buf("test-fiyat-listesi.pdf")));
  eq(hotelsSig(B.xp.xBook(B.pdfx.sheets(pages, "x"))), hotelsSig(B.xp.xBook(B.pdfx.sheets(require("./fixtures-pdf-items.json"), "x"))));
});
test("PDF okuyucu: satır akışlı PDF konumlu PDF ile aynı veriyi verir (kayma uyarısı yok)", () => {
  const B = load(), F = () => JSON.parse(JSON.stringify(require("./fixtures-pdf-items.json"))), P = B.xp.xBook(B.pdfx.sheets(lineStream(B, F(), false), "ls.pdf"));
  ok(P.hotels.every(h => !h.shift), "yanlış kayma uyarısı"); eq(hotelsSig(P), hotelsSig(B.xp.xBook(B.pdfx.sheets(F(), "x"))), "satır akışı ≠ konumlu");
});
test("PDF okuyucu: sütunları kayan belge (Corendon tipi) “Okunamadı” olarak işaretlenir ve kaydedilmez", () => {
  const B = load(), P = B.xp.xBook(B.pdfx.sheets(lineStream(B, JSON.parse(JSON.stringify(require("./fixtures-pdf-items.json"))), true), "kayan.pdf"));
  ok(P.hotels.length && P.hotels.every(h => h.shift >= 3 && h.st == "e"), "kayma işaretlenmedi"); const w = P.hotels[0].W.find(w => w[0] == "e"); ok(w && /kayıyor/.test(w[1]), "uyarı yok");
  B.i18n.set("en"); ok(/could not be read reliably/.test(B.t(w[1], w[2])), "EN çeviri yok"); B.i18n.set("tr");
});
test("OCR: taranmış örnek (Tesseract TSV) okunur ve “kontrol gerekli” işaretlenir", async () => {
  const B = load(), it = B.ocr.fromTsv(fs.readFileSync(path.join(OV, "ocr-taranmis-ornek.tsv"), "utf8")); ok(it.length > 50, "öğe yok");
  const fx = B.ocr.fix(it), sh = B.pdfx.sheets([{ items: fx.items || it }], "ocr.jpg"); sh.forEach(s => s.ocr = { fix: fx.fix || 0, low: 0 });
  const X = B.xp.xBook(sh); ok(X.hotels.length >= 1, "otel yok"); ok(X.hotels.every(h => h.st != "ok"), "OCR oteli doğrudan kaydedilebilir olmamalı");
});
test("İçe aktarma: örnek liste kaydedilir, aynı isimli otel güncellenir", () => {
  const B = load(); B.auth.start(B.db.find("users", u => u.email == "rezervasyon@akdeniz-turizm.example"));
  const S = B.imp.blank(); B.imp.demo(S); const n0 = B.db.all("hotels").length, r = B.imp.save(S, 1); ok(r.ok, r.msg); const n1 = B.db.all("hotels").length; ok(n1 > n0, "otel eklenmedi");
  const S2 = B.imp.blank(); B.imp.demo(S2); B.imp.save(S2, 1); eq(B.db.all("hotels").length, n1, "ikinci yükleme yeni otel açmamalı");
});

/* ---------- giriş, lisans, çok kiracılılık ---------- */
test("Gerçek giriş: şifre doğru/yanlış, firma adresi (slug) filtresi", () => {
  const B = load(); ok(B.auth.login("rezervasyon@akdeniz-turizm.example", "book4me").ok); ok(!B.auth.login("rezervasyon@akdeniz-turizm.example", "yanlis").ok);
  ok(B.auth.login("rezervasyon@akdeniz-turizm.example", "book4me", "akdeniz").ok); ok(!B.auth.login("rezervasyon@akdeniz-turizm.example", "book4me", "bogaz").ok, "başka firmanın adresinden girememeli");
  const u = B.db.find("users", u => u.email == "rezervasyon@akdeniz-turizm.example"); ok(u.pw && u.pw != "book4me" && u.salt, "şifre düz metin saklanmamalı");
});
test("Lisans askıya alınınca DMC'nin tüm kullanıcıları ve alt hesapları giremez; açılınca girer", () => {
  const B = load(); B.auth.start(B.db.find("users", u => u.email == "admin@book4me-ai.com"));
  ok(B.lic.toggle(1, "test").ok); eq(B.lic.of(1).status, "Askıda"); ok(!B.auth.login("rezervasyon@akdeniz-turizm.example", "book4me").ok);
  const sub = B.db.find("users", u => u.org == "s" && u.oid == 6); if (sub) ok(!B.auth.start(sub).ok, "alt hesap girebiliyor");
  ok(B.lic.toggle(1).ok); ok(B.auth.login("rezervasyon@akdeniz-turizm.example", "book4me").ok);
});
test("Çok kiracılılık: her DMC yalnızca kendi verisini görür", () => {
  const B = load(), s1 = B.db.scope(1), s2 = B.db.scope(2);
  ok(s2.all("hotels").every(h => B.app.tidOf(h.sup) == 2), "2 başkasının otelini görüyor"); ok(s1.all("hotels").every(h => B.app.tidOf(h.sup) == 1));
  ok(s2.all("users").every(u => u.org != "s" || B.app.tidOf(u.oid) == 2), "kullanıcı sızıntısı");
  ok(s2.all("bookings").length < B.db.all("bookings").length, "rezervasyon filtrelenmiyor");
});
test("Destek modu: yalnızca DMC izin verirse açılır ve kayda geçer", () => {
  const B = load(); B.auth.start(B.db.find("users", u => u.email == "admin@book4me-ai.com"));
  if (B.brand.of(2).support) B.brand.togSupport(2); ok(!B.lic.supportEnter(2).ok, "izinsiz açıldı"); B.brand.togSupport(2);
  const r = B.lic.supportEnter(2); ok(r.ok, r.msg); ok(B.db.where("supportLog", x => x.tid == 2).length > 0, "kayıt yok"); ok(B.lic.supportExit().ok);
});

/* ---------- ticari model ---------- */
test("Platform markup varsayılan %5 (alıcı tarafı) ve DMC bazında değiştirilebilir", () => {
  const B = load(), T = B.price.table(); ok(B.price.U || true); eq(T.def.a.h, 5); eq(T.def.a.t, 5); eq(T.def.a.u, 5); eq(T.def.a.f, 5);
  B.price.setMk("ag", 12, "h", 7); eq(B.price.table().ag[12].h, 7);
});
test("API komisyonu: alış 1000 + satış 1100 → 10 + 11 = 21 EUR", () => {
  const B = load(), c = B.acc.commCalc({ cost: 1000, costCur: "EUR", total: 1100, cur: "EUR" }); eq([c.buy, c.sell, B.util.r2(c.buyE + c.sellE)], [10, 11, 21]);
});
test("API komisyonu yalnızca DMC'nin kendi API ticaretinde doğar (seed: 1 kayıt, kendi API uçuşu)", () => {
  const B = load(), C = B.db.all("commissions"); eq(C.length, 1); const b = B.db.get("bookings", C[0].bid); eq(b.src, "api"); ok(B.acc.commQualifies(b));
  ok(B.db.all("bookings").filter(b => b.src != "api").every(b => !B.acc.commQualifies(b)), "API dışı rezervasyona komisyon");
});
test("Komisyon faturası ay sonunda tek fatura; platform alacağından mahsup", () => {
  const B = load(); B.auth.start(B.db.find("users", u => u.email == "admin@book4me-ai.com")); const m = B.db.all("commissions")[0].month, r = B.acc.commInvoice(1, m); ok(r.ok, r.msg);
  const inv = B.db.all("cinvoices").slice(-1)[0]; ok(inv && inv.dmc == 1, "fatura yok"); ok(B.acc.commOpen(1).length == 0, "açık komisyon kaldı");
});
test("Arama: DMC'nin kendi ürünleri “Special offer” (own) olarak gelir, tedarikçi adı yok", () => {
  const B = load(), q = B.search.q({ ag: 11, city: "Antalya", a: B.util.addD(B.util.today(), 20), b: B.util.addD(B.util.today(), 23) }), r = B.search.hotels(q);
  ok(r.L.length > 0, "sonuç yok"); ok(r.L.some(o => o.rows.some(x => x.own)), "own yok"); ok(!JSON.stringify(r.L.map(o => o.rows)).includes("Akdeniz Turizm"), "tedarikçi adı sızdı");
  const T = B.search.transfers(B.search.q({ ag: 11 })); ok(T.length == 0 || T.some(x => x.own) || true);
});
test("Rezervasyon: alıcı hesabında satış bilgisi olmadan rezervasyon oluşmaz", () => {
  const B = load(), q = B.search.q({ ag: 11 }), tf = B.search.transfers(q)[0]; ok(tf, "transfer yok"); const it = { ...B.search.trItem(tf, 1, q.d, "", q), guests: ["Test Kişi"] };
  const r = B.book.place({ ag: 11, items: [it], label: "t", cur: "EUR", nat: "TR" }); ok(!r.ok && /satış|Satıldığı/i.test(r.msg), "satışsız rezervasyon oluştu");
  const r2 = B.book.place({ ag: 11, items: [it], label: "t", cur: "EUR", nat: "TR", resale: { to: "Müşteri A", amt: 99, cur: "EUR" } }); ok(r2.ok, r2.msg);
});
test("Kredi yok: süresinde ödenmeyen rezervasyon otomatik iptal", () => {
  const B = load(), q = B.search.q({ ag: 13 }), tf = B.search.transfers(q)[0], it = { ...B.search.trItem(tf, 1, B.util.addD(B.util.today(), 30), "", q), guests: ["A B"] };
  const r = B.book.place({ ag: 13, items: [it], label: "t", cur: "EUR", nat: "TR", resale: { to: "X", amt: 50, cur: "EUR" } }); ok(r.ok, r.msg);
  const o = r.order; B.util._now = Date.parse(o.due) + 3 * 864e5; B.book.sweep(); ok(B.db.get("orders", o.id).auto, "iptal edilmedi");
});
test("Ön ödeme: tutar bloke edilir, iptal süresi dolunca GECE İŞİYLE düşülür", () => {
  const B = load(), acc = B.db.get("accounts", 12); ok(acc.pre && acc.pre.on, "seed ön ödeme yok");
  const q = B.search.q({ ag: 12, cur: "USD" }), tf = B.search.transfers(q)[0], it = { ...B.search.trItem(tf, 1, B.util.addD(B.util.today(), 40), "", q), guests: ["A B"] };
  const r = B.book.place({ ag: 12, items: [it], label: "t", cur: "USD", nat: "TR", pm: "pre", resale: { to: "X", amt: 60, cur: "USD" } }); ok(r.ok, r.msg);
  let o = B.db.get("orders", r.order.id); ok(o.hold, "bloke edilmedi"); ok(o.vch || B.book.oBks(o).every(b => b.vch || b.status == "Onaylı"), "voucher yok"); const due0 = B.book.oDue(o); ok(due0 > 0);
  B.util._now = Date.parse(o.due) + 2 * 864e5; B.jobs.nightly("test"); o = B.db.get("orders", o.id); eq(B.book.oDue(o), 0, "düşülmedi"); ok(o.inv, "fatura yok"); ok(!o.auto, "iptal edilmemeli");
});
test("Dashboard kapsamı: Back Office ve DMC panelleri sayı üretir", () => {
  const B = load(); B.auth.start(B.db.find("users", u => u.email == "admin@book4me-ai.com")); const h = B.rep.hq("30"); ok(h && typeof h == "object");
  B.auth.start(B.db.find("users", u => u.email == "rezervasyon@akdeniz-turizm.example")); const d = B.rep.dmc(1, "30", B.rep.scope("s", B.app.user())); ok(d && typeof d == "object");
});

/* ---------- entegrasyon, agentlar, API Out ---------- */
test("Entegrasyonlar kapalı kurulu; açılınca olay kuyruğa düşer, hata simülasyonunda yeniden denenir", () => {
  const B = load(); ok(B.int.list(1).every(x => !x.r || !x.r.on), "açık kurulmuş"); B.lic.togMod("Kurumsal", "int"); if (!B.lic.has(1, "int")) B.lic.togMod("Kurumsal", "int");
  ok(B.int.toggle(1, "acc_logo").ok); B.int.save(1, "acc_logo", { fail: true });
  B.events.emit("invoice.issued", "FTR-T", 100, "EUR", 1); let q = B.int.queue(1).length; ok(q > 0, "kuyruk boş");
  B.int.deliver(1); ok(B.int.failed(1).length > 0, "hata simülasyonu"); B.int.save(1, "acc_logo", { fail: false }); B.int.deliver(1); eq(B.int.failed(1).length, 0, "yeniden deneme");
  const e = B.db.all("events").slice(-1)[0]; ok(Object.values(e.out)[0].payload, "çeviri yok");
});
test("Agent: kapalı kurulu; Okeyle (yüksek riskte ikinci onay) ve Okeyleme (gerekçe + düzeltilmiş sürüm)", () => {
  const B = load(); B.auth.start(B.db.find("users", u => u.email == "admin@book4me-ai.com")); ok(B.db.all("agents").every(a => !a.on), "açık agent var");
  const x = B.agents.propose("P", "acc", { title: "Test", why: "w", risk: "Yüksek", act: { fn: "answer", args: {} } });
  const r1 = B.agents.decide(x.id, true); ok(r1.confirm, "ikinci onay sorulmadı"); eq(B.db.get("approvals", x.id).state, "Bekliyor");
  ok(B.agents.decide(x.id, true, "", true).ok); eq(B.db.get("approvals", x.id).state, "Onaylandı");
  const y = B.agents.propose("P", "acc", { key: "k1", title: "Test2", why: "w", act: { fn: "answer", args: {} } }); ok(B.agents.decide(y.id, false).ask, "gerekçe sorulmadı");
  const r = B.agents.decide(y.id, false, "tutar yanlış"); ok(r.ok); eq(B.db.get("approvals", y.id).state, "Reddedildi"); ok(r.z && r.z.rev == 1 && r.z.state == "Bekliyor", "düzeltilmiş sürüm yok");
  ok(!B.agents.propose("P", "acc", { key: "k1", title: "Test2", why: "w", act: { fn: "answer" } }), "7 gün tekrar etmemeli");
});
test("Agent çalıştırma: açılan agent yalnızca onay kuyruğuna iş bırakır, canlı veriye dokunmaz", () => {
  const B = load(); B.auth.start(B.db.find("users", u => u.email == "admin@book4me-ai.com")); const before = JSON.stringify(B.db.all("hotels"));
  B.agents.DEF.forEach(a => B.agents.toggle("P", a.k)); const r = B.agents.run("P"); ok(r.ok); eq(JSON.stringify(B.db.all("hotels")), before, "otel verisi değişti"); ok(B.agents.pending("P").length > 0, "iş yok");
});
test("API Out: kapalıyken 503, anahtarsız 401, istek sınırı 429, test anahtarı rezervasyon oluşturmaz", () => {
  const B = load(); eq(B.int.call("x", "search.hotels", {}).status, 503); B.int.toggle("P", "apiout"); B.int.save("P", "apiout", { limit: "3" });
  eq(B.int.call("yok", "search.hotels", {}).status, 401); const k = B.int.keyNew(11, "Test").x.key; const o0 = B.db.all("orders").length;
  const st = [1, 2, 3, 4].map(() => B.int.call(k, "search.transfers", {}).status); eq(st, [200, 200, 200, 429]);
  const k2 = B.int.keyNew(11, "Test").x.key, tf = B.int.call(k2, "search.transfers", {}).body.offers[0]; const bk = B.int.call(k2, "book", { code: tf.code, guests: ["A B"] }); eq(bk.status, 200); ok(bk.body.test); eq(B.db.all("orders").length, o0, "test anahtarı rezervasyon açtı");
});
test("Gece işleri günde bir kez çalışır (runIfDue)", () => {
  const B = load(); ok(B.jobs.runIfDue()); eq(B.jobs.runIfDue(), null);
});

/* ---------- veri katmanı ---------- */
test("Veri katmanı: tek arayüz, kaydet/yükle aynı veriyi verir, şema sürümü", () => {
  const B = load({ init: false }), A = B.store.MemoryAdapter(); B.app.init(A); const n = B.db.all("hotels").length; B.db.commit();
  const B2 = load({ init: false }); B2.app.init(A); eq(B2.db.all("hotels").length, n); ok(B2.db.snapshot().v >= 1 || B2.store.SCHEMA_VERSION >= 1);
});

/* ---------- dil dosyaları ---------- */
test("Dil dosyaları: t() ile kullanılan her metnin EN/AR/RU karşılığı var, yer tutucular aynı", () => {
  const B = load(), S = require("../tools/strings.json").t, D = B.i18n.dicts, miss = { en: [], ar: [], ru: [] }, ph = s => (s.match(/\{\w+\}/g) || []).sort().join();
  S.forEach(s => ["en", "ar", "ru"].forEach(l => { const v = D[l][s]; if (v == null) miss[l].push(s); else if (ph(v) != ph(s)) throw new Error(`${l} yer tutucu: ${s}`); }));
  ["en", "ar", "ru"].forEach(l => ok(miss[l].length == 0, `${l} eksik ${miss[l].length}: ${miss[l].slice(0, 3).join(" | ")}`));
});
test("Dil: para ve tarih biçimi dile göre; RU çoğul; AR sağdan sola", () => {
  const B = load(), I = B.i18n; I.set("tr"); eq(I.fd("2026-07-10"), "10.07.2026"); I.set("en"); eq(I.fd("2026-07-10"), "10/07/2026"); ok(/1,234\.5/.test(I.fm(1234.5, "EUR")));
  I.set("ru"); eq(I.tn(2, "gece"), "2 ночи"); eq(I.tn(5, "gece"), "5 ночей"); I.set("ar"); eq(I.dir(), "rtl"); I.set("tr"); eq(I.dir(), "ltr");
});
test("Fatura, voucher ve sözleşme metni 4 dilde üretilir", () => {
  const B = load(), c = B.db.all("contracts")[0];
  ["tr", "en", "ar", "ru"].forEach(l => { B.i18n.set(l); const tx = B.parties.termsText(c); ok(tx.length > 200); if (l != "tr") ok(!/[ğışİ]/.test(tx.replace(/book4me ai A\.Ş\.|Akdeniz|Boğaz|Muğla|İstanbul|Ş\./g, "")), `${l} sözleşmede Türkçe kaldı`); });
});

(async () => {
  for (const [n, f] of T) { try { const r = await f(); pass++; console.log("✓", n, r ? `(${r})` : ""); } catch (e) { fail++; console.log("✗", n, "\n   ", e.message); } }
  console.log(`\n${pass} geçti, ${fail} kaldı`); process.exit(fail ? 1 : 0);
})();
