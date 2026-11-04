/* EN/AR/RU ekranlarında Türkçe kalıntı taraması: her rol ve sekmede görünen metinde Türkçe'ye özgü harf geçen satırları toplar
   (veri olan firma/otel/kişi adları hariç). */
const { chromium } = require("playwright"), path = require("path");
(async () => {
  const lang = process.argv[2] || "en", br = await chromium.launch(), pg = await br.newPage({ viewport: { width: 1280, height: 900 } });
  await pg.route(/^https?:\/\//, r => r.abort());
  await pg.goto("file://" + path.join(__dirname, "../dist/index.html")); await pg.evaluate(l => B4M.i18n.set(l), lang);
  const names = await pg.evaluate(() => { const S = new Set(); ["dmcs", "accounts", "users", "hotels", "tours", "gproducts", "gsuppliers", "transfers", "apis", "contracts"].forEach(tb => (B4M.db.all(tb) || []).forEach(x => ["name", "email", "from", "to", "city", "zone", "title", "addr", "no", "hotel", "guest", "pick", "pickAt", "label", "desc", "dur"].forEach(k => { const v = x[k]; if (typeof v == "string") S.add(v); }))); B4M.db.all("orders").forEach(o => { S.add(o.label); o.items.forEach(i => { S.add(i.desc); (i.guests || []).forEach(g => S.add(g)); }); }); B4M.db.all("bookings").forEach(b => { S.add(b.desc); (b.guests || []).forEach(g => S.add(g)); }); return [...S].filter(Boolean); });
  const users = await pg.evaluate(() => B4M.db.all("users").filter(u => u.active).map(u => u.id)), hits = new Map();
  const scan = async where => { const txt = await pg.evaluate(() => document.body.innerText); txt.split("\n").forEach(l => { let s = l; names.forEach(n => { if (n.length > 2) s = s.split(n).join(""); }); if (/[çğışöüÇĞİŞÖÜ]/.test(s) && !/Türkçe|TÜRSAB/.test(s)) { if (!hits.has(l)) hits.set(l, where); } }); };
  for (const id of users) {
    await pg.evaluate(id => { B4M.auth.logout(); B4M.auth.start(B4M.db.get("users", id)); B4M.ui.S.tab = ""; B4M.ui.render(); }, id);
    const top = await pg.$$eval("nav.tabs:not(.sm) button[data-a]", bs => bs.map(b => [b.getAttribute("data-a"), b.getAttribute("data-p")]));
    for (const [a, p] of top) { await pg.evaluate(([a, p]) => B4M.ui.run(a, p == null ? undefined : JSON.parse(p)), [a, p]); await scan(`u${id} ${a}:${p}`);
      const subs = await pg.$$eval("nav.tabs.sm button[data-a]", bs => bs.map(b => [b.getAttribute("data-a"), b.getAttribute("data-p")]));
      for (const [a2, p2] of subs) { await pg.evaluate(([a, p]) => B4M.ui.run(a, p == null ? undefined : JSON.parse(p)), [a2, p2]); await scan(`u${id} ${a}:${p} ${a2}:${p2}`); } }
  }
  await pg.evaluate(() => { B4M.auth.logout(); B4M.ui.render(); }); await scan("login");
  console.log(lang, "leftover lines", hits.size); [...hits].slice(0, 80).forEach(([l, w]) => console.log(`${w} :: ${l.slice(0, 160)}`)); await br.close();
})();
