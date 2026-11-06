/* Yama 1 arayüz testi (tarayıcı): yeni sekmeler açılır, bildirim zili çalışır, DMC arayüzden rebooking teklifi verir, Back Office artırmayı kapatır,
   finans ekranları hatasız çizilir, Transfer/Tur/Uçak Operasyon altında. Çalıştırma: node tests/u002-ui.js */
const { chromium } = require("playwright"), path = require("path");
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "✓" : "✗", m); };
(async () => {
  const br = await chromium.launch(), pg = await br.newPage({ viewport: { width: 1280, height: 900 } }), errs = []; await pg.route(/^https?:\/\//, r => r.abort()); pg.on("pageerror", e => errs.push(e.message));
  await pg.goto("file://" + path.join(__dirname, "../dist/index.html")); await pg.evaluate(() => localStorage.clear()); await pg.reload();
  const login = async e => { await pg.evaluate(() => { const b = document.querySelector("button[data-a=logout]"); if (b) b.click(); }); await pg.fill("#lg_e", e); await pg.fill("#lg_p", "bed4book"); await pg.click("button[data-a=login]"); };
  const run = (a, p) => pg.evaluate(([a, p]) => B4M.ui.run(a, p), [a, p]), txt = async () => (await pg.textContent("#app")).replace(/\s+/g, " ");
  await login("admin@bed4book.com");
  for (const [k, w] of [["hk", "Otel kontratları"], ["cm", "Sözleşme takibi"], ["fa", "Tarih bazında"], ["rbo", "Açık artırmalar"]]) { await run("hTab", k); ok((await txt()).includes(w), `Back Office · ${w}`); }
  await run("hTab", "acc"); for (const [k, w] of [["fr", "Gelir tablosu"], ["fx2", "Gider ekle"], ["fsal", "Maaş talepleri"], ["fbon", "Prim kuralları"], ["fpro", "Tanıtım (marketing) faturaları"], ["fbud", "Bütçe ve gerçekleşen"], ["fprm", "SGK işveren payı"], ["dp", "Üst tedarikçi kâr payı"]]) { await run("acT", k); ok((await txt()).includes(w), `Muhasebe · ${w}`); }
  await run("hTab", "pr"); const pr = await txt(); ok(pr.includes("Kâr özeti") && pr.includes("Kazancınız") && pr.includes("Üst tedarikçilerin alt tedarikçi kârı"), "Platform markup: v40 düzeni (Kazancınız + Kâr özeti)");
  await pg.click("button[data-a=ntfOpen]"); ok(await pg.isVisible("#ov [role=dialog] >> text=Bildirimler"), "bildirim paneli açılır"); await pg.click("#ov button[data-a=ntfGo] >> nth=0"); ok(!(await pg.$("#ov button[data-a=ntfGo]")), "bildirim kaydı açar");
  await run("hTab", "o"); const d = await txt(); ok(d.includes("Alacak yaşlandırma") && d.includes("Gecikmeli firmalar") && d.includes("Önceki dönemle karşılaştırma"), "Dashboard: yaşlandırma, gecikmeli firmalar, karşılaştırma");
  await login("operasyon@maviseyahat.example");
  const G = await pg.evaluate(() => B4M.vDMC.GRP.map(g => [g[0], g[1].map(x => x[0])])); ok(G.find(g => g[0] == "Operasyon")[1].slice(0, 3).join() == "t,u,f" && !G.find(g => g[0] == "Product")[1].includes("t"), "Transfer / Tur / Uçak Operasyon altında");
  await run("dTab", "rb"); ok((await txt()).includes("Rebooking teklifleri") && !(await txt()).includes("Deniz Aksoy"), "DMC teklif paneli: misafir adı görünmez");
  const aid = await pg.evaluate(() => B4M.db.find("rbAuctions", x => x.st == "Açık" && x.no == "B4M26-000007-1").id); await pg.fill(`#rba_${aid}`, "200"); await pg.click(`button[data-a=rbBid][data-p='${aid}']`);
  ok(await pg.evaluate(id => B4M.rb.low(id).amt == 200 && !B4M.rb.low(id).auto, aid), "arayüzden teklif verildi");
  await run("dTab", "rbt"); ok((await txt()).includes("Otomatik fiyat takibi"), "Fiyat takibi penceresi (Product)");
  for (const k of ["hk", "fa", "mfr", "mx", "msl", "mbn", "mtn", "pw"]) { await run("dTab", k); } ok(true, "DMC yeni sekmeleri çizildi");
  await login("admin@bed4book.com"); await run("hTab", "rbo"); await pg.click(`button[data-a=rbClose][data-p='${aid}']`);
  ok(await pg.evaluate(() => { const b = B4M.db.find("bookings", b => b.no == "B4M26-000007-1"); return b.sup == 4 && b.cost == 200 && b.status == "Onaylı"; }), "Back Office artırmayı kapattı; rezervasyon yeni tedarikçide");
  await pg.setViewportSize({ width: 390, height: 844 }); await run("hTab", "rbo"); ok(await pg.evaluate(() => document.documentElement.scrollWidth <= 400), "mobil: sayfa yatay taşmıyor");
  ok(!errs.length, "sayfa hatası yok " + errs.join(" | ")); await br.close(); console.log(`\n${pass} geçti, ${fail} kaldı`); process.exit(fail ? 1 : 0);
})();
