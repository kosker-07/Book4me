/* u005 testi (Yama 2b): rezervasyona müdahale yetkisi (üstlenme, düzeltme, fiyat ve ceza, tedarikçi değiştirme), kapsam, gerekçe, kayıtlar,
   muhasebe etkisi; Yama 1'den 2b'ye alınan maddeler (gelen H2H → API, test konsolu, tanıtım anlaşması, otomatik puan). */
const { chromium } = require("playwright"), path = require("path"), load = require("../tools/load.js");
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "✓" : "✗", m); };
const as = (B, id) => { B.auth.logout(); B.auth.start(B.db.get("users", id)); };
const ADM = 228, MUH = 229, DMC1 = 234, DMC2 = 238, MAVI = 237, DENIZ = 244;
(async () => {
  { const B = load(), bk = no => B.db.find("bookings", b => b.no == no), b = bk("B4M26-000007-1"), o = B.db.get("orders", b.oid), IV = B.iv;
    as(B, DENIZ); ok(!IV.claim(b.id).ok, "yetkisi olmayan kullanıcı üstlenemez");
    as(B, DMC2); ok(!IV.fix(b.id, { names: ["X Y"] }, "otel overbooking yaptı").ok, "DMC başka DMC'nin rezervasyonuna müdahale edemez");
    as(B, MAVI); ok(!IV.side(b), "alıcı DMC (satış hesabı tarafı) müdahale edemez");
    as(B, DMC1); ok(!IV.can(b, "mudt"), "DMC tedarikçi değiştiremez (yalnızca Back Office)");
    ok(IV.claim(b.id).ok && b.owner && b.owner.uid == DMC1, "DMC yöneticisi kendi rezervasyonunu üstlendi");
    as(B, ADM); ok(!IV.claim(b.id).ok, "başkası üstlenmişse onaysız devralınamaz"); ok(IV.claim(b.id, true).ok && b.owner.uid == ADM, "Back Office devraldı");
    ok(!IV.fix(b.id, { names: ["Deniz Aksoy"] }, "kısa").ok, "gerekçesiz / kısa gerekçeyle kayıt reddedilir");
    const L0 = B.db.all("ledger").length, t0 = b.total;
    const r = IV.fix(b.id, { names: ["Deniz Aksoy", "Can Aksoy", "Ece Aksoy"], note: "geç giriş", a: b.a, b: B.util.addD(b.b, 1), rid: b.room, rt: "r" }, "Otel overbooking yaptı, bir gece uzatıldı"); ok(r.ok, "düzeltme: misafir, kişi sayısı, tarih " + (r.msg || ""));
    ok(b.guests.length == 3 && b.note == "geç giriş" && b.total > t0, "düzeltme uygulandı ve fiyat yeniden hesaplandı");
    ok(B.db.all("ledger").length > L0 && Math.abs(o.total - (o.total)) < 1e-9, "fark cariye işlendi");
    const au = B.db.where("audit", a => a.action == "booking.intervene" && a.ref == b.no); ok(au.length >= 1 && /before/.test(au[0].detail) && /after/.test(au[0].detail) && /overbooking/.test(au[0].detail), "işlem kaydında öncesi, sonrası, gerekçe");
    ok((b.mods || []).some(m => m.iv), "rezervasyon geçmişinde müdahale etiketi");
    as(B, DMC1); ok(B.notif.forUser().some(n => n.kind == "iv"), "tedarikçiye bildirim"); as(B, MAVI); const nm = B.notif.forUser().filter(n => n.kind == "iv"); ok(nm.length && nm.every(n => !JSON.stringify(n).includes("Akdeniz Turizm")), "alıcıya bildirim (tedarikçi adı yok)");
    as(B, ADM); const due0 = B.book.oDue(o), t1 = b.total;
    ok(IV.price(b.id, { total: t1 + 50, cost: b.cost }, "Anlaşma gereği fiyat düzeltmesi").ok, "fiyat düzeltme (Back Office)"); ok(Math.abs(b.total - (t1 + 50)) < 0.01 && Math.abs(B.book.oDue(o) - (due0 + 50)) < 0.01, "fark ödenecek tutara eklendi");
    ok(Math.abs((b.mg.hq) - (b.total - B.price.cv(b.cost + (b.mg.ps || 0), b.costCur, b.cur) - (b.mg.pa || 0))) < 0.02, "platform markup'ı yeni fiyata göre");
    as(B, DMC1); const c0 = b.cost, tt = b.total; ok(IV.price(b.id, { cost: c0 + 10 }, "Otel fiyatı güncelledi, düzeltme").ok && Math.abs(b.total - tt * (c0 + 10) / c0) < 0.02, "DMC kendi fiyatını düzeltince alıcı fiyatı orantılı güncellenir");
    /* tedarikçi değiştirme */
    as(B, ADM); const h2 = B.db.find("hotels", h => h.sup != b.sup && (h.rooms || []).length), rm = h2.rooms[0], tot = b.total, no = b.no, sup0 = b.sup;
    ok(!IV.move(b.id, { hid: h2.id, rid: rm.id, amt: 0 }, "Otel kapandı, misafir taşındı").ok, "tutarsız tedarikçi değişimi reddedildi");
    const mv = IV.move(b.id, { hid: h2.id, rid: rm.id, amt: 150, cur: "EUR" }, "Otel kapandı, misafir başka otele taşındı"); ok(mv.ok, "tedarikçi değiştirme " + (mv.msg || ""));
    ok(b.sup == h2.sup && b.total == tot && b.no == no && b.desc.includes(h2.name), "yeni tedarikçi; satış fiyatı ve no aynı, hizmet adı yeni otel");
    ok(B.db.all("rbRev").some(x => x.no == no && x.kind == "manual"), "alış farkı rebooking gelirine yazıldı");
    as(B, DMC1); ok(B.notif.forUser().some(n => n.kind == "rbx"), "eski tedarikçiye ücretsiz iptal bildirimi");
    /* ceza kaldırma */
    as(B, ADM); const c = B.db.find("bookings", x => x.status == "Onaylı" && x.no != no && x.oid && x.kind == "h"); c.dl = B.util.addD(B.util.today(), -1); as(B, MAVI); const cx = B.book.cancel(c.id); as(B, ADM); ok(c.status == "İptal (cezalı)", "test için cezalı iptal");
    const oc = B.db.get("orders", c.oid), rf0 = B.book.oRef(oc); as(B, MUH); ok(!IV.waive(c.id, "Misafir hastalandı, belge var").ok, "yetkisi olmayan ceza kaldıramaz");
    as(B, ADM); ok(IV.waive(c.id, "Misafir hastalandı, belge sunuldu").ok && c.status == "İptal", "iptal cezası kaldırıldı");
    ok(B.db.all("ledger").some(l => /İptal cezası kaldırıldı/.test(l.t) && l.cr > 0), "iade cariye işlendi");
    /* bekleyen talep kapanır, fatura uyarısı */
    const d = B.db.find("bookings", x => x.status == "Onaylı" && x.kind == "h" && x.oid && x.id != b.id && x.id != c.id); d.cxd = -1; d.dl = null; as(B, MAVI); const mr = B.book.mdSubmit(d.id, { ...B.book.mdInit(d), note: "talep" }, "Ayşe"); as(B, ADM);
    const od = B.db.get("orders", d.oid); od.inv = od.inv || { no: "FTR-TEST" }; ok(IV.fix(d.id, { names: d.guests, note: "müdahale notu" }, "Tedarikçi yanıt vermedi, düzeltildi").ok && !d.pendingMod, "müdahale bekleyen değişiklik talebini kapattı");
    ok(d.ivInv && B.notif.forUser(B.db.get("users", MUH)).some(n => n.kind == "ivinv"), "fatura varsa fark faturası uyarısı ve Muhasebe'ye bildirim");
    /* 2b Yama 1 maddeleri */
    as(B, DMC1); const h = B.h2h.add(1, { name: "Gelen Partner", dir: "gelen", env: "Test", url: "https://api.partner.example/v1" }); ok(h.ok && h.api && h.x.api == h.api.id && h.api.url == "https://api.partner.example/v1", "E: gelen H2H tedarikçi API'ye otomatik bağlandı");
    const g = B.h2h.add(1, { name: "Giden Partner", dir: "giden", env: "Test" }); const res = B.int.call(g.x.key, "content.hotels", {}); ok(res.status == 200 && res.body.hotels.length > 0, "E: test konsolu çağrısı (content.hotels)");
    as(B, ADM); const ag = B.fin.addAgr("P", { hid: 1, from: "2026-11-01", to: "2027-01-31", amt: 400, cur: "EUR", svc: "Bülten" }); ok(ag.ok, "K: tanıtım anlaşması"); const iv = B.fin.invAgr(ag.x.id); ok(iv.ok && iv.x.agr == ag.x.id && ag.x.inv.includes(iv.x.id), "K: anlaşmadan fatura kesildi");
    const sc = B.rb.calcScore(1); ok(sc && sc.score >= 0 && sc.score <= 100 && "del" in sc.parts, "L: otomatik puan hesaplanıyor");
    B.rb.prof(4).wins = 2; B.rb.prof(4).fails = 2; const s4 = B.rb.calcScore(4); ok(s4.n.del == 50 && !s4.fresh, "L: teslim oranı puana giriyor");
    B.y1.setPrm("rbAuto", 1); B.jobs.nightly("test"); ok(B.rb.prof(4).score == B.rb.calcScore(4).score, "L: gece işinde puan güncellendi"); }
  /* ---- arayüz ---- */
  const br = await chromium.launch(), pg = await br.newPage({ viewport: { width: 1440, height: 900 } }), errs = []; await pg.route(/^https?:\/\//, r => r.abort()); pg.on("pageerror", e => errs.push(e.message));
  const URL = "file://" + path.join(__dirname, "../dist/index.html"); await pg.goto(URL); await pg.evaluate(() => localStorage.clear()); await pg.reload();
  const ev = (f, a) => pg.evaluate(f, a), login = async e => { await ev(() => { const b = document.querySelector("button[data-a=logout]"); if (b) b.click(); }); await pg.fill("#lg_e", e); await pg.fill("#lg_p", "bed4book"); await pg.click("button[data-a=login]"); };
  const open = no => ev(n => B4M.ui.run("bxOpen", B4M.db.find("bookings", b => b.no == n).id), no);
  await login("deniz@akdeniz-turizm.example"); await open("B4M26-000007-1"); ok(!(await pg.$("button[data-a=ivOpen]")) && !(await pg.$("button[data-a=ivClaim]")), "yetkisi olmayan kullanıcıda müdahale düğmeleri görünmüyor");
  await login("admin@bed4book.com"); await open("B4M26-000007-1"); ok(!!(await pg.$("button[data-a=ivClaim]")) && !!(await pg.$("button[data-a=ivOpen]")), "Back Office yöneticisinde Üstlen ve Müdahale et");
  await pg.click("button[data-a=ivClaim]"); ok((await pg.textContent(".bxw")).includes("Back Office Yöneticisi") && !!(await pg.$("button[data-a=ivRel]")), "üstlenen kişi ekranda görünüyor");
  await pg.click("button[data-a=ivOpen]"); const t = await pg.textContent(".bxw"); ok(t.includes("Düzeltme") && t.includes("Fiyat ve ceza") && t.includes("Tedarikçi değiştirme"), "müdahale paneli: üç bölüm");
  await pg.click("button[data-a=ivFix]"); ok(/Gerekçe/.test(await pg.textContent("#toast")), "gerekçe zorunlu uyarısı");
  await pg.fill("#iv_r", "Misafir isim düzeltmesi istedi"); await pg.fill("input[data-i=ivN] >> nth=0", "Deniz Aksoy Yılmaz"); await pg.click("button[data-a=ivFix]");
  ok(await ev(() => B4M.db.find("bookings", b => b.no == "B4M26-000007-1").guests[0] == "Deniz Aksoy Yılmaz"), "arayüzden düzeltme kaydedildi");
  ok((await pg.textContent(".bxw")).includes("Müdahale"), "geçmişte müdahale satırı");
  await login("rezervasyon@akdeniz-turizm.example"); await open("B4M26-000007-1"); ok(!!(await pg.$("button[data-a=ivOpen]")), "DMC yöneticisi kendi rezervasyonunda müdahale edebiliyor"); await pg.click("button[data-a=ivOpen]"); ok(!(await pg.textContent(".bxw")).includes("Tedarikçi değiştirme"), "DMC'de tedarikçi değiştirme yok");
  await ev(() => B4M.ui.run("dTab", "int")); await pg.fill("#h2_n", "Test Partner"); await pg.click("button[data-a=h2Add]"); ok((await pg.textContent("#app")).includes("H2H test konsolu"), "E: H2H test konsolu ekranı");
  await pg.click("button[data-a=h2Send]"); ok(/200/.test(await pg.textContent("#app")), "E: test konsolu yanıtı");
  await ev(() => B4M.ui.run("dTab", "mtn")); ok((await pg.textContent("#app")).includes("Tanıtım anlaşmaları"), "K: tanıtım anlaşması ekranı (DMC)");
  await login("admin@bed4book.com"); await ev(() => { B4M.ui.run("hTab", "rbo"); B4M.ui.run("rbT", "co"); }); ok((await pg.textContent("#app")).includes("Otomatik puan"), "L: otomatik puan tablosu"); await pg.click("button[data-a=rbCalc]"); ok(/puanı güncellendi/.test(await pg.textContent("#toast")), "L: puanları şimdi hesapla");
  await ev(() => B4M.ui.run("nv", ["acc", { acT: "fprm" }])); ok((await pg.textContent("#app")).includes("Puan · teslim oranı ağırlığı"), "L: ağırlıklar Parametreler'de");
  await ev(() => B4M.ui.run("hTab", "res")); await ev(() => B4M.ui.run("rpSave", "hres")); await pg.fill("#dlg_in", "Kasım girişleri"); await pg.click("button[data-a=dlgYes]"); ok(await ev(() => (B4M.pref.get(B4M.ctx.uid, "rp_hres") || []).length == 1) && !!(await pg.$("select[data-c=rpUse]")), "B3: kayıtlı raporlarım");
  await ev(() => B4M.ui.run("hTab", "lic")); const tc = await pg.$(".tcb button[data-a=tcOpen]"); ok(!!tc, "diğer listelerde sütun seçimi"); if (tc) { await tc.click(); await pg.click(".tcp input >> nth=1"); ok(await ev(() => [...document.querySelectorAll(".cnt .tw table")].some(tb => [...tb.rows[0].cells].some(c => c.style.display == "none"))), "sütun gizlendi"); }
  const r = await pg.$("tr[data-go]"); ok(!!r, "diğer listelerde satır tıklanabilir"); if (r) { await r.click({ position: { x: 5, y: 5 } }); ok(await pg.isVisible("tr.qsum"), "tek tık: özet"); await pg.dblclick("tr[data-go] >> nth=0", { position: { x: 5, y: 5 } }); ok((await pg.textContent("#app")).includes("Lisans yönetimi"), "çift tık: ayrıntı"); }
  ok(!errs.length, "sayfa hatası yok " + errs.join(" | ")); await br.close(); console.log(`\n${pass} geçti, ${fail} kaldı`); process.exit(fail ? 1 : 0);
})();
