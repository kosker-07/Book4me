/* u003 testi: Dashboard kartları, kırılım satırları ve trend çubukları tıklanınca detay listesi açılır; rakamla liste tutarlı. */
const { chromium } = require("playwright"), path = require("path");
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "✓" : "✗", m); };
(async () => { const br = await chromium.launch(), pg = await br.newPage({ viewport: { width: 1280, height: 900 } }), errs = []; pg.on("pageerror", e => errs.push(e.message)); await pg.route(/^https?:\/\//, r => r.abort());
  await pg.goto("file://" + path.join(__dirname, "../dist/index.html")); await pg.evaluate(() => localStorage.clear()); await pg.reload();
  const login = async e => { await pg.evaluate(() => { const b = document.querySelector("button[data-a=logout]"); if (b) b.click(); }); await pg.fill("#lg_e", e); await pg.fill("#lg_p", "bed4book"); await pg.click("button[data-a=login]"); };
  const rows = async () => pg.$$eval("#dbdrill tr", r => r.filter(x => !x.querySelector("th") && !x.querySelector("td[colspan]")).length);
  await login("admin@bed4book.com"); await pg.evaluate(() => B4M.ui.run("dbp", "all"));
  const K = await pg.$$eval(".kpi.y1c", L => L.map(x => JSON.parse(x.dataset.p))); ok(K.length >= 11, `Back Office: ${K.length} kart tıklanabilir`);
  for (const k of K) { await pg.click(`.kpi.y1c[data-p='"${k}"']`); ok(await pg.isVisible("#dbdrill"), `kart ${k} → detay listesi`); }
  await pg.click(`.kpi.y1c[data-p='"gmv"']`); const n = await rows(), g = await pg.evaluate(() => B4M.rep.hq("all").okB.length); ok(n == g, `GMV listesi kart rakamıyla aynı (${n}/${g})`);
  await pg.click(`.kpi.y1c[data-p='"gmv"']`); ok(!(await pg.$("#dbdrill")), "ikinci tıklama kapatır");
  await pg.click(`div.y1c[data-p='"sv|h"']`); ok((await rows()) == (await pg.evaluate(() => B4M.rep.hq("all").bySv.h.n)), "hizmet kırılımı satırı → otel rezervasyonları");
  await pg.click(`div.y1c[data-p^='"sup|']`); ok(await pg.isVisible("#dbdrill"), "DMC satırı → o DMC'nin satışları");
  const bars = await pg.$$("svg g[role=button]"); await bars[bars.length - 1].click(); ok(await pg.isVisible("#dbdrill"), "trend çubuğu → o dönemin rezervasyonları");
  await pg.click(`.kpi.y1c[data-p='"due"']`); ok(!!(await pg.$("#dbdrill button[data-a=rv]")), "tahsilat listesinden rezervasyon detayına gidilir");
  await pg.focus(`.kpi.y1c[data-p='"k"']`); await pg.keyboard.press("Enter"); ok((await pg.textContent("#dbdrill")).includes("K-2026"), "klavye (Enter) ile açılır");
  await pg.evaluate(() => B4M.ui.run("dbp", "7")); ok(!(await pg.$("#dbdrill")), "dönem değişince detay kapanır");
  await login("rezervasyon@akdeniz-turizm.example"); await pg.evaluate(() => { B4M.ui.run("dTab", "db"); B4M.ui.run("dbp", "all"); });
  const K2 = await pg.$$eval(".kpi.y1c", L => L.map(x => JSON.parse(x.dataset.p))); ok(K2.length >= 6, `DMC: ${K2.length} kart tıklanabilir`);
  for (const k of K2) { await pg.click(`.kpi.y1c[data-p='"${k}"']`); ok(await pg.isVisible("#dbdrill"), `DMC kart ${k} → detay`); }
  await pg.click(`.kpi.y1c[data-p='"sales"']`); ok((await rows()) == (await pg.evaluate(() => B4M.rep.dmc(B4M.ctx.dmc, "all", B4M.rep.scope("s")).R.length)), "DMC satış listesi kart rakamıyla aynı");
  await pg.click(`div.y1c[data-p^='"ch|']`); ok(await pg.isVisible("#dbdrill"), "kanal satırı → detay");
  await pg.evaluate(() => B4M.i18n.set("en")); await pg.click(`.kpi.y1c[data-p='"profit"']`); ok(/details/.test(await pg.textContent("#dbdrill")), "İngilizce çalışır");
  ok(!errs.length, "sayfa hatası yok " + errs.join("|")); await br.close(); console.log(`\n${pass} geçti, ${fail} kaldı`); process.exit(fail ? 1 : 0); })();
