/* u001 testi: Back Office'ten logo yükleme; yeni logo eskisinin yerine geçer, eski saklanmaz; DMC markası etkilenmez. */
const { chromium } = require("playwright"), path = require("path");
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "✓" : "✗", m); };
(async () => {
  const br = await chromium.launch(), pg = await br.newPage({ viewport: { width: 1280, height: 900 } }), errs = []; await pg.route(/^https?:\/\//, r => r.abort()); pg.on("pageerror", e => errs.push(e.message));
  const URL = "file://" + path.join(__dirname, "../dist/index.html"); await pg.goto(URL); await pg.evaluate(() => localStorage.clear()); await pg.reload();
  await pg.fill("#lg_e", "admin@book4me-ai.com"); await pg.fill("#lg_p", "book4me"); await pg.click("button[data-a=login]");
  await pg.click('button[data-a=hTab][data-p=\'"br"\']'); ok(!!(await pg.$("input[data-c=pLogo]")), "Platform markası sekmesinde yükleme alanı");
  await pg.setInputFiles("input[data-c=pLogo]", "/tmp/logo1.png"); await pg.waitForFunction(() => !!B4M.db.cfg("platformLogo"));
  const l1 = await pg.evaluate(() => B4M.db.cfg("platformLogo")); ok(/^data:image\/png/.test(l1), "PNG olarak kaydedildi (şeffaflık korunur)");
  ok(await pg.evaluate(() => !!document.querySelector("#hdr img.plogo") && !document.querySelector("#hdr svg")), "üst bantta yeni logo, eski amblem yok");
  await pg.setInputFiles("input[data-c=pLogo]", "/tmp/logo2.png"); await pg.waitForFunction(l => B4M.db.cfg("platformLogo") != l, l1);
  ok(await pg.evaluate(l => !JSON.stringify(B4M.db.snapshot()).includes(l.slice(30, 90)), l1), "ilk logo veriden tamamen silindi");
  ok(await pg.evaluate(() => /plogo|<img/.test(B4M.uiBrand.docHead(0, "x", "y"))), "platform belgelerinde yeni logo");
  await pg.click("button[data-a=logout]"); ok(await pg.evaluate(() => !!document.querySelector("#hdr img.plogo")), "giriş ekranında yeni logo");
  await pg.reload(); ok(await pg.evaluate(() => !!document.querySelector("#hdr img.plogo")), "yeniden açılışta kalıcı");
  await pg.goto(URL + "#akdeniz"); ok(await pg.evaluate(() => !document.querySelector("#hdr img.plogo")), "DMC'nin kendi markası etkilenmedi");
  ok(!errs.length, "sayfa hatası yok " + errs.join("|")); await br.close(); console.log(`\n${pass} geçti, ${fail} kaldı`); process.exit(fail ? 1 : 0);
})();
