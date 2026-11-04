/* u005 testi (Yama 2b · çift ekran): kayıt adresleri, yeni sekmede aynı oturum, sekmeler arası eşitleme, eski veriyle yazmanın reddi,
   Çıkış'ın tüm sekmeleri kapatması, 8 saat sınırı, marka değişince oturumun kapanması, geri düğmesi. */
const { chromium } = require("playwright"), path = require("path");
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "✓" : "✗", m); };
(async () => {
  const br = await chromium.launch(), ctx = await br.newContext({ viewport: { width: 1440, height: 900 } }), errs = [];
  await ctx.route(/^https?:\/\//, r => r.abort()); const URL = "file://" + path.join(__dirname, "../dist/index.html");
  const A = await ctx.newPage(); A.on("pageerror", e => errs.push("A " + e.message)); await A.goto(URL); await A.evaluate(() => localStorage.clear()); await A.reload();
  await A.goto(URL + "#backoffice"); await A.fill("#lg_e", "admin@book4me-ai.com"); await A.fill("#lg_p", "book4me"); await A.click("button[data-a=login]");
  await A.evaluate(() => B4M.ui.run("hTab", "res")); ok(/#backoffice\/e\/res$/.test(A.url()), "ekranın kendi adresi var (#backoffice/e/res)");
  await A.evaluate(() => B4M.ui.run("bxOpen", B4M.db.find("bookings", b => b.no == "B4M26-000007-1").id)); ok(/#backoffice\/rez\/B4M26-000007-1$/.test(A.url()), "rezervasyonun kendi adresi var");
  await A.goBack(); await A.waitForTimeout(150); ok(await A.evaluate(() => !B4M.ui.S.bx && !!B4M.ctx.uid), "geri düğmesi listeye döner, oturum açık kalır");
  /* yeni sekme: aynı oturum ve doğrudan kayıt */
  const B = await ctx.newPage(); B.on("pageerror", e => errs.push("B " + e.message)); await B.goto(URL + "#backoffice/rez/B4M26-000009-1"); await B.waitForTimeout(150);
  ok(await B.evaluate(() => B4M.ctx.uid == 228), "yeni sekmede yeniden giriş istenmedi"); ok(await B.isVisible(".bxw") && (await B.textContent(".bxno")).includes("B4M26-000009-1"), "yeni sekme doğrudan kaydı açtı");
  /* eşitleme */
  await A.evaluate(() => { const b = B4M.db.find("bookings", x => x.no == "B4M26-000009-1"); B4M.ui.run("bxOpen", b.id); B4M.ui.run("bxNote", b.id); }); await A.fill("#bx_note", "A sekmesinden not"); await A.click("button[data-a=bxNoteSave]");
  await B.waitForTimeout(300); ok(await B.evaluate(() => (B4M.db.find("bookings", x => x.no == "B4M26-000009-1").inotes || []).some(n => n.txt == "A sekmesinden not")), "A'daki değişiklik B'ye anında geldi");
  ok((await B.textContent(".bxw")).includes("A sekmesinden not"), "B'nin ekranı yenilendi");
  /* eski veriyle yazma reddedilir */
  const before = await A.evaluate(() => B4M.db.all("ledger").length);
  await B.evaluate(() => B4M.ui.run("bxNote", B4M.ui.S.bx)); await B.fill("#bx_note", "eski veriyle not"); await B.evaluate(() => { B4M.route.rev -= 1; }); await B.click("button[data-a=bxNoteSave]"); await B.waitForTimeout(200);
  ok(/başka bir pencerede değişti/.test(await B.textContent("#toast")), "eski veriyle yazma reddedildi, uyarı gösterildi");
  ok(await A.evaluate(() => !(B4M.db.find("bookings", x => x.no == "B4M26-000009-1").inotes || []).some(n => n.txt == "eski veriyle not")) && await B.evaluate(() => JSON.parse(localStorage.getItem("book4me-ai-v41")).c.bookings.find(x => x.no == "B4M26-000009-1").inotes.some(n => n.txt == "A sekmesinden not")), "veri sessizce ezilmedi");
  ok(await A.evaluate(() => B4M.db.all("ledger").length) == before, "diğer veriler değişmedi");
  /* ekran değişimi oturumu kapatmaz, marka değişimi kapatır */
  await B.evaluate(() => { location.hash = "#backoffice/e/o"; }); await B.waitForTimeout(150); ok(await B.evaluate(() => !!B4M.ctx.uid && B4M.ui.S.tab == "o"), "ekran adresi değişince oturum açık, ekran açıldı");
  await B.evaluate(() => { location.hash = "#akdeniz"; }); await B.waitForTimeout(200); ok(await B.evaluate(() => !B4M.ctx.uid), "marka değişince oturum kapandı (eski kural)");
  await A.waitForTimeout(300); ok(await A.evaluate(() => !B4M.ctx.uid) && !!(await A.$("#lg_e")), "çıkış diğer sekmeyi de kapattı");
  /* 8 saat sınırı */
  await A.goto(URL + "#backoffice"); await A.fill("#lg_e", "admin@book4me-ai.com"); await A.fill("#lg_p", "book4me"); await A.click("button[data-a=login]");
  const exp = await A.evaluate(() => JSON.parse(localStorage.getItem("b4m-sess")).exp - Date.now()); ok(exp > 7.9 * 36e5 && exp <= 8 * 36e5, "oturum süresi 8 saat");
  await A.evaluate(() => { const x = JSON.parse(localStorage.getItem("b4m-sess")); x.exp = Date.now() - 1; localStorage.setItem("b4m-sess", JSON.stringify(x)); B4M.route.checkExp(); }); ok(await A.evaluate(() => !B4M.ctx.uid), "süre dolunca oturum düştü");
  const C = await ctx.newPage(); await C.goto(URL + "#backoffice/rez/B4M26-000009-1"); await C.waitForTimeout(150); ok(await C.evaluate(() => !B4M.ctx.uid) && !!(await C.$("#lg_e")), "süresi dolmuş oturumla yeni sekme giriş ister");
  await C.goto(URL); await C.waitForTimeout(100); ok(!!(await C.$("#lg_e")), "yalın adres her zaman giriş ekranı");
  /* Ctrl + tık yeni sekme */
  await A.fill("#lg_e", "admin@book4me-ai.com"); await A.fill("#lg_p", "book4me"); await A.click("button[data-a=login]"); await A.evaluate(() => B4M.ui.run("hTab", "res"));
  const [P2] = await Promise.all([ctx.waitForEvent("page"), A.click("tr[data-bx] >> nth=0", { modifiers: ["Control"], position: { x: 30, y: 10 } })]); await P2.waitForLoadState(); await P2.waitForTimeout(150);
  ok(/\/rez\//.test(P2.url()) && await P2.evaluate(() => !!B4M.ctx.uid && !!B4M.ui.S.bx), "Ctrl + tık: kayıt yeni sekmede, aynı oturumla");
  ok(!errs.length, "sayfa hatası yok " + errs.join(" | ")); await br.close(); console.log(`\n${pass} geçti, ${fail} kaldı`); process.exit(fail ? 1 : 0);
})();
