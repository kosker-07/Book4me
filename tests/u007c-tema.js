/* Koyu mod: üst bant düğmesi Otomatik → Koyu → Açık; kullanıcı bazında saklanır; giriş ekranında son seçim; koyu temada okunabilir renkler. */
const { chromium } = require("playwright"), path = require("path");
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "✓" : "✗", m); };
(async () => {
  const br = await chromium.launch(), pg = await br.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "light" }), errs = []; pg.on("pageerror", e => errs.push(e.message)); await pg.route(/^https?:\/\//, r => r.abort());
  const URL = "file://" + path.join(__dirname, "../dist/index.html"), th = () => pg.evaluate(() => document.documentElement.getAttribute("data-theme")), bg = () => pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await pg.goto(URL); await pg.evaluate(() => localStorage.clear()); await pg.reload();
  ok(await th() == null && /244, 245, 247/.test(await bg()), "varsayılan: otomatik (cihaz açık temada)"); ok(!!(await pg.$("button[data-a=theme]")), "giriş ekranında tema düğmesi");
  await pg.click("button[data-a=theme]"); ok(await th() == "dark" && /11, 13, 18/.test(await bg()), "koyu tema");
  await pg.fill("#lg_e", "admin@book4me-ai.com"); await pg.fill("#lg_p", "book4me"); await pg.click("button[data-a=login]"); ok(await th() == "dark", "girişten sonra koyu kaldı");
  await pg.click("button[data-a=theme]"); ok(await th() == "light", "açık tema"); await pg.click("button[data-a=theme]"); ok(await th() == null, "otomatiğe döndü"); await pg.click("button[data-a=theme]");
  ok(await pg.evaluate(() => B4M.pref.get(B4M.ctx.uid, "theme")) == "dark", "seçim kullanıcı bazında saklandı");
  await pg.evaluate(() => { localStorage.setItem("b4m-theme", "light"); document.querySelector("button[data-a=logout]").click(); });
  await pg.fill("#lg_e", "admin@book4me-ai.com"); await pg.fill("#lg_p", "book4me"); await pg.click("button[data-a=login]"); ok(await th() == "dark", "yeniden girişte kullanıcının seçimi geri geldi");
  const contrast = await pg.evaluate(() => { const L = c => { const m = c.match(/\d+/g).map(Number).slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * m[0] + .7152 * m[1] + .0722 * m[2]; }, r = (a, b) => (Math.max(L(a), L(b)) + .05) / (Math.min(L(a), L(b)) + .05), b = getComputedStyle(document.body);
    return [r(b.color, b.backgroundColor), r(getComputedStyle(document.querySelector(".box")).color, getComputedStyle(document.querySelector(".box")).backgroundColor)]; });
  ok(contrast.every(x => x >= 7), "koyu temada metin kontrastı ≥ 7:1 (" + contrast.map(x => x.toFixed(1)).join(", ") + ")");
  for (const k of ["res", "acc", "e", "o"]) await pg.evaluate(k => B4M.ui.run("hTab", k), k); await pg.evaluate(() => B4M.ui.run("bxOpen", B4M.db.all("bookings")[0].id));
  ok(!errs.length, "sayfa hatası yok " + errs.join(" | ")); await br.close(); console.log(`\n${pass} geçti, ${fail} kaldı`); process.exit(fail ? 1 : 0);
})();
