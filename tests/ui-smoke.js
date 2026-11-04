/* Tarayıcı duman testi: her rol ile giriş yapar, tüm sekmeleri ve alt sekmeleri açar, konsol hatalarını toplar. */
const { chromium } = require("playwright"), path = require("path");
(async () => {
  const br = await chromium.launch(), pg = await br.newPage({ viewport: { width: 1280, height: 900 } }), errs = [];
  await pg.route(/^https?:\/\//, r => r.abort());
  pg.on("pageerror", e => errs.push("pageerror: " + e.message)); pg.on("console", m => { if (m.type() == "error" || m.type() == "warning") errs.push(m.type() + ": " + m.text()); });
  await pg.goto("file://" + path.join(__dirname, "../dist/index.html"));
  if (process.env.LANG2) await pg.evaluate(l => B4M.i18n.set(l), process.env.LANG2);
  await pg.waitForSelector("#app");
  const users = await pg.evaluate(() => B4M.db.all("users").filter(u => u.active).map(u => ({ id: u.id, n: u.name, org: u.org })));
  const pick = process.argv[2] ? users.filter(u => process.argv[2].split(",").includes(String(u.id))) : users;
  let clicks = 0;
  for (const u of pick) {
    await pg.evaluate(id => { B4M.auth.logout(); const r = B4M.auth.start(B4M.db.get("users", id)); B4M.ui.S.tab = ""; B4M.ui.render(); return r; }, u.id);
    const seen = new Set(), queue = [[]];
    /* breadth: top tabs then sub tabs (nav.tabs buttons), depth 2 */
    const navBtns = async () => pg.$$eval("nav.tabs button[data-a]", bs => bs.map(b => [b.getAttribute("data-a"), b.getAttribute("data-p"), b.closest("nav").className]));
    const top = (await navBtns()).filter(b => b[2] == "tabs" || !b[2].includes("sm"));
    for (const [a, p] of top) {
      const before = errs.length;
      await pg.evaluate(([a, p]) => B4M.ui.run(a, p == null ? undefined : JSON.parse(p)), [a, p]); clicks++;
      const subs = (await navBtns()).filter(b => !top.some(x => x[0] == b[0] && x[1] == b[1]));
      for (const [a2, p2] of subs) { const k = a2 + p2; if (seen.has(k)) continue; seen.add(k); await pg.evaluate(([a, p]) => B4M.ui.run(a, p == null ? undefined : JSON.parse(p)), [a2, p2]); clicks++; if (errs.length > before) { errs.push(`  ^ at user ${u.id} ${u.n} tab ${a}:${p} sub ${a2}:${p2}`); break; } }
      await pg.evaluate(([a, p]) => B4M.ui.run(a, p == null ? undefined : JSON.parse(p)), [a, p]);
      if (errs.length > before && !errs[errs.length - 1].startsWith("  ^")) errs.push(`  ^ at user ${u.id} ${u.n} tab ${a}:${p}`);
    }
  }
  if (process.env.MISS) require("fs").writeFileSync(process.env.MISS, JSON.stringify(await pg.evaluate(() => [...B4M.i18n.missing]), null, 1));
  console.log("users", pick.length, "clicks", clicks, "errors", errs.length); console.log([...new Set(errs)].slice(0, 40).join("\n"));
  await br.close();
})();
