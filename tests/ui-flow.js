/* Tarayıcı kabul testi: gerçek tıklama ve yazma ile uçtan uca akışlar.
   1) DMC kullanıcısı şifreyle girer, otel arar, rezervasyon formunu doldurur, satış bilgisi girer, kartla öder → voucher/fatura
   2) Back Office lisansı askıya alır → DMC giremez
   3) Dil değişimi: EN/AR/RU ekranları, AR sağdan sola
   4) Fiyat listesi içe aktarma (örnek liste) ve kaydetme
   5) Agent Okeyle / Okeyleme sayfa içi iletişim kutusuyla */
const { chromium } = require("playwright"), path = require("path");
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log("✓", m); } else { fail++; console.log("✗", m); } };
(async () => {
  const br = await chromium.launch(), pg = await br.newPage({ viewport: { width: 1280, height: 900 } }), errs = [];
  await pg.route(/^https?:\/\//, r => r.abort()); pg.on("pageerror", e => errs.push(e.message)); pg.on("dialog", d => { errs.push("native dialog: " + d.type()); d.dismiss(); });
  const URL = "file://" + path.join(__dirname, "../dist/index.html"), ev = (f, a) => pg.evaluate(f, a), txt = () => pg.evaluate(() => document.body.innerText);
  const login = async (e, p, hash = "") => { await pg.goto(URL + hash); await pg.fill("#lg_e", e); await pg.fill("#lg_p", p); await pg.click("button[data-a=login]"); };
  await pg.goto(URL); await ev(() => { localStorage.clear(); }); await pg.reload();

  /* 1 */
  await login("operasyon@maviseyahat.example", "yanlis"); ok(/E-posta veya şifre hatalı/.test(await txt()), "yanlış şifre reddedildi");
  await login("operasyon@maviseyahat.example", "book4me"); ok(await pg.$("button[data-a=logout]"), "şifreyle giriş");
  await pg.click('button[data-a=dTab][data-p=\'"rs"\']'); await pg.click('button[data-a=dTab][data-p=\'"by"\']');
  const o0 = await ev(() => B4M.db.all("orders").length);
  await pg.click("button[data-a=openBk]"); const names = await pg.$$("input[data-i=gName]"); for (const [i, n] of names.entries()) await n.fill(["Ali Veli", "Ayşe Veli"][i] || "Test Kişi");
  await pg.click("button[data-a=confirmBk]"); ok(/satış|Satıldığı/i.test(await txt()), "satış bilgisi zorunlu uyarısı");
  await pg.fill("input[data-i=qIn][data-p='\"rsTo\"']", "Müşteri Turizm"); await pg.fill("input[data-i=qIn][data-p='\"rsAmt\"']", "999"); await pg.click("button[data-a=confirmBk]");
  const oid = await ev(() => { const o = B4M.db.all("orders").slice(-1)[0]; return o.id; }); ok(await ev(() => B4M.db.all("orders").length) == o0 + 1, "rezervasyon oluştu (ödeme bekliyor)");
  const hold = await ev(id => !!B4M.db.get("orders", id).hold, oid);
  if (hold) ok(await ev(id => { const o = B4M.db.get("orders", id); return B4M.book.oBks(o).every(b => b.vch) && B4M.acc.preHeld(o.ag, o.cur) > 0; }, oid), "ön ödemeli hesap: tutar bloke, voucher hemen düzenlendi");
  await ev(() => { B4M.db.get("accounts", 12).pre.on = false; B4M.db.commit(); }); await pg.click('button[data-a=ab][data-p=\'"s"\']'); await pg.click("button[data-a=openBk]"); for (const n of await pg.$$("input[data-i=gName]")) await n.fill("Ali Veli");
  await pg.fill("input[data-i=qIn][data-p='\"rsTo\"']", "Müşteri Turizm"); await pg.fill("input[data-i=qIn][data-p='\"rsAmt\"']", "999"); await pg.click("button[data-a=confirmBk]").catch(() => {});
  if (!(await pg.$("button[data-a=confirmBk]")) && !(await pg.$("button[data-a=openBk]"))) await pg.click('button[data-a=ab][data-p=\'"s"\']');
  const oid2 = await ev(() => B4M.db.all("orders").slice(-1)[0].id); await pg.click('button[data-a=ab][data-p=\'"o"\']');
  const pay = await pg.$(`button[data-a=payCard][data-p="${oid2}"]`); ok(!!pay, "kartla ödeme düğmesi"); if (pay) await pay.click();
  const o1 = await ev(id => { const o = B4M.db.get("orders", id); return { inv: !!o.inv, due: B4M.book.oDue(o), vch: B4M.book.oBks(o).every(b => b.vch) }; }, oid2);
  ok(oid2 != oid && o1.inv && o1.due == 0, "kartla ödendi, fatura oluştu"); ok(o1.vch, "voucher düzenlendi");

  /* 2 */
  await login("admin@book4me-ai.com", "book4me", "#backoffice"); await pg.click('button[data-a=hTab][data-p=\'"lic"\']');
  await pg.click('button[data-a=licD][data-p="4"]'); await pg.click("button[data-a=licTog]"); ok(await pg.$(".dlg"), "askıya alma sayfa içi onay kutusu"); await pg.fill("#dlg_in", "test"); await pg.click("button[data-a=dlgYes]");
  ok(await ev(() => B4M.lic.of(4).status) == "Askıda", "lisans askıda");
  await login("operasyon@maviseyahat.example", "book4me"); ok(!(await pg.$("button[data-a=logout]")) && /askıya/i.test(await txt()), "askıdaki DMC giremedi");
  await ev(() => { B4M.lic.toggle(4); B4M.db.commit(); });

  /* 3 */
  await login("rezervasyon@akdeniz-turizm.example", "book4me", "#akdeniz"); await pg.selectOption("header select, #hdr select", "en"); ok(/Dashboard|Sales|Profit/.test(await txt()) && !/Çıkış yap/.test(await txt()), "EN arayüz");
  await pg.selectOption("#hdr select", "ar"); ok(await ev(() => document.documentElement.dir) == "rtl", "AR sağdan sola"); await pg.screenshot({ path: "/home/claude/shots/ar.png" });
  await pg.selectOption("#hdr select", "ru"); ok(/Выйти|Дашборд|Продажи/.test(await txt()), "RU arayüz"); await pg.selectOption("#hdr select", "tr");

  /* 4 */
  await pg.click('button[data-a=dTab][data-p=\'"h"\']'); await pg.click("button[data-a=hsImp]");
  const demo = await pg.$("button[data-a=ixDemo]"); ok(!!demo, "içe aktarma ekranı"); if (demo) { await demo.click(); ok(/4 otel|otel sayfası/i.test(await txt()), "örnek liste okundu");
    const sv = await pg.$("button[data-a=ixSave]"); if (sv) { const h0 = await ev(() => B4M.db.all("hotels").length); await sv.click(); ok(await ev(() => B4M.db.all("hotels").length) > h0, "oteller kaydedildi"); } else ok(false, "kaydet düğmesi"); }

  /* 5 */
  await login("admin@book4me-ai.com", "book4me", "#backoffice"); await pg.click('button[data-a=hTab][data-p=\'"ag"\']'); await pg.click('button[data-a=agt][data-p=\'"a"\']');
  await pg.click('button[data-a=agTog][data-p=\'["P","acc"]\']'); await pg.click('button[data-a=agTog][data-p=\'["P","kontrat"]\']'); await pg.click("button[data-a=agRun]");
  const y = await pg.$("button[data-a=agYes]"); ok(!!y, "onay kuyruğunda iş var"); if (y) { await pg.click("button[data-a=agNo]"); ok(await pg.$(".dlg"), "Okeyleme gerekçe kutusu"); await pg.fill("#dlg_in", "uygun değil"); await pg.click("button[data-a=dlgYes]"); ok(/Okeylenmedi/.test(await txt()), "Okeyleme kaydedildi");
    await pg.click("button[data-a=agYes]"); if (await pg.$(".dlg")) await pg.click("button[data-a=dlgYes]"); ok(/Okeylendi/.test(await txt()), "Okeyle uygulandı"); }

  /* kalıcılık: yeniden yüklemede veri durur */
  const n = await ev(() => B4M.db.all("orders").length); await pg.reload(); ok(await ev(() => B4M.db.all("orders").length) == n, "tarayıcı depolamasında kalıcı");
  ok(errs.length == 0, "sayfa hatası yok" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
  await br.close(); console.log(`\n${pass} geçti, ${fail} kaldı`); process.exit(fail ? 1 : 0);
})();
