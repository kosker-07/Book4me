/* u007 testi: fiyat listesinin pazarı başlıktan ve "Ülke-Pazar Tanımları" sayfasından okunur; kontrat yalnızca o pazardaki milliyetlere satılır
   (arama, fiyat, değişiklik, API/H2H); aynı otelin farklı pazar listeleri ayrı kontrat olarak yan yana durur; elle düzenleme; arayüz. */
const { chromium } = require("playwright"), path = require("path"), fs = require("fs"), load = require("../tools/load.js");
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "✓" : "✗", m); };
const F = path.join(__dirname, "fixtures/crystal-s27-europe-uk.xlsx"), D = { city: "Antalya", a: "2027-07-10", b: "2027-07-17" };
(async () => {
  const B = load(), raw = await B.xlsx.read(new Uint8Array(fs.readFileSync(F))), clone = x => JSON.parse(JSON.stringify(x));
  B.auth.start(B.db.get("users", 234)); const S = B.imp.blank(); B.imp.load(S, clone(raw), "c");
  const h = S.hotels.find(x => /Aura/.test(x.name)); ok(h.mk2 && h.mk2.label == "Europe & UK" && h.season == "Summer 2027 · Europe & UK", "pazar başlıktan okundu (Europe & UK)");
  ["DE", "NL", "FR", "PL", "BG", "LV", "NO", "GB", "IE"].forEach(c => ok(h.mk2.list.includes(c), `Europe & UK içinde ${c}`)); ["RU", "TR", "AE", "IR", "CN", "US", "KZ"].forEach(c => ok(!h.mk2.list.includes(c), `Europe & UK dışında ${c}`));
  ok(S.mkSheet && S.mkSheet.rows.length >= 60 && !S.mkSheet.unknown.length, "Ülke-Pazar sayfası: tüm ülke adları tanındı");
  B.imp.save(S, 1); const x = B.db.find("hotels", y => /Aura/.test(y.name)); ok(x.seasons.length == 1 && x.seasons[0].mk && x.seasons[0].mk.mode == "only" && x.seasons[0].mk.list.length == h.mk2.list.length, "kontratta pazar kısıtı kaydedildi");
  ok(B.mkt.defs(1).length >= 60, "pazar tanımı DMC için saklandı");
  const sr = nat => B.search.hotels(B.search.q({ ag: 11, nat, ...D })).L.filter(o => /Crystal/.test(o.f.name));
  ok(sr("DE").length == 13 && sr("GB").length == 13 && sr("NO").length == 13, "pazardaki milliyetler arar ve bulur (DE, GB, NO)");
  ok(sr("RU").length == 0 && sr("TR").length == 0 && sr("AE").length == 0 && sr("").length == 0, "pazar dışı milliyetlerde (RU, TR, AE, boş) hiç görünmüyor");
  const r = x.rooms[1], ns = B.util.nights(D.a, D.b); ok(B.prod.stayT(x, r, ns, "r", { ag: 11, nat: "RU", ...D }, { ad: 2, ch: 0, ages: [] }) == null && B.prod.stayT(x, r, ns, "r", { ag: 11, nat: "DE", ...D }, { ad: 2, ch: 0, ages: [] }) > 0, "fiyat hesabı da milliyete göre kapanıyor");
  /* ikinci pazar: aynı otel, CIS listesi; ayrı kontrat, birbirini ezmez */
  const cis = clone(raw).map(s => { if (s.rows && s.rows[1] && /PRICE FOR/.test(String(s.rows[1][0]))) { s.rows[1][0] = "SUMMER 2027 PRICE FOR CIS"; s.rows = s.rows.map((row, i) => i < 5 ? row : (row || []).map(v => typeof v == "number" && v > 30 ? Math.round(v * 1.2) : v)); } return s; });
  const S2 = B.imp.blank(); B.imp.load(S2, cis, "cis"); B.imp.save(S2, 1); ok(x.seasons.length == 2 && x.seasons.some(s => /CIS$/.test(s.name)) && x.seasons.some(s => /Europe & UK$/.test(s.name)), "CIS listesi ayrı kontrat; Europe & UK kontratı duruyor");
  const pDE = sr("DE").find(o => /Aura/.test(o.f.name)), pRU = sr("RU").find(o => /Aura/.test(o.f.name)); ok(pDE && pRU && pRU.rows[0].p > pDE.rows[0].p * 1.1, "Rus misafir CIS fiyatını, Alman misafir Avrupa fiyatını görüyor");
  ok(sr("KZ").length > 0 && sr("TR").length == 0, "CIS kapsamında KZ satışta, TR hâlâ kapalı");
  /* API ve H2H */
  B.int.toggle("P", "apiout"); const k = B.int.keyNew(11, "T").x.key, api = b => B.int.call(k, "search.hotels", { ...D, ...b });
  ok(api({ nationality: "DE" }).body.hotels.some(o => /Crystal/.test(o.name)), "API: nationality=DE → var"); ok(!api({ nationality: "TR" }).body.hotels.some(o => /Crystal/.test(o.name)), "API: nationality=TR → yok");
  ok(api({ nationality: "Almanya" }).status == 200 && api({ nationality: "XYZ" }).status == 400, "API: ülke adı kabul, geçersiz milliyet 400");
  const nn = api({}); ok(!nn.body.hotels.some(o => /Crystal/.test(o.name)) && /nationality_missing/.test(nn.body.warning), "API: milliyet yoksa kısıtlı kontratlar dönmüyor ve uyarı veriyor");
  const hh = B.h2h.add(1, { name: "P", dir: "giden", env: "Test" }); const hs = n => B.int.call(hh.x.key, "search.hotels", { city: "Antalya", ci: D.a, co: D.b, ...(n ? { nationality: n } : {}) }); ok(hs("GB").status == 200 && hs("GB").body.hotels.some(o => /Crystal/.test(o.name)) && !hs("TR").body.hotels.some(o => /Crystal/.test(o.name)) && !hs("").body.hotels.some(o => /Crystal/.test(o.name)), "H2H: aynı kural (milliyetsiz sorguda da kapalı)");
  /* değişiklik: misafir milliyeti pazarda değilse fiyat çıkmaz */
  const q2 = B.book.mdQuote({ kind: "h", hid: x.id, guests: ["A", "B"], nat: "TR", ag: 11, cur: "EUR", total: 1, id: 0 }, { a: D.a, b: D.b, rid: r.id, rt: "r" }); ok(!q2.ok || !q2.total, "değişiklikte pazar dışı milliyete fiyat yok");
  /* elle düzenleme */
  const eu = x.seasons.find(s => /Europe/.test(s.name)); ok(B.mkt.setSeason(x.id, eu.id, { markets: ["WEST EUROPE"] }).ok && eu.mk.list.includes("DE") && !eu.mk.list.includes("GB"), "pazarı elle daraltma (yalnız West Europe)");
  ok(B.mkt.setSeason(x.id, eu.id, { all: true }).ok && B.prod.stayT(x, r, ns, "r", { ag: 11, nat: "TR", ...D }, { ad: 2, ch: 0, ages: [] }) > 0, "tüm pazarlara açınca TR de alabiliyor");
  /* eski biçim etkilenmedi */
  const L = load(); ok(L.xp.xBook(clone(L.data.XDEMO)).hotels.every(h => !h.mk2), "eski biçimde pazar kısıtı yok (önceki davranış)");
  /* arayüz */
  const br = await chromium.launch(), pg = await br.newPage({ viewport: { width: 1440, height: 1000 } }), errs = []; pg.on("pageerror", e => errs.push(e.message)); await pg.route(/^https?:\/\//, rr => rr.abort());
  await pg.goto("file://" + path.join(__dirname, "../dist/index.html")); await pg.evaluate(() => localStorage.clear()); await pg.reload();
  await pg.fill("#lg_e", "rezervasyon@akdeniz-turizm.example"); await pg.fill("#lg_p", "bed4book"); await pg.click("button[data-a=login]");
  await pg.evaluate(() => B4M.ui.run("dTab", "h")); await pg.click("button[data-a=hsImp]"); await (await pg.$("input[type=file][accept*=xls]")).setInputFiles(F); await pg.waitForFunction(() => (B4M.ui.S.imp.hotels || []).length > 0, null, { timeout: 20000 });
  ok((await pg.textContent("#app")).includes("pazara ayrıldı"), "yükleme ekranında pazar bilgisi"); await pg.click("button[data-a=ixSave]"); await pg.waitForTimeout(200);
  const hid = await pg.evaluate(() => B4M.db.find("hotels", h => /Aura/.test(h.name)).id); await pg.evaluate(id => { B4M.ui.run("ixBack"); B4M.ui.S.hs = id; B4M.ui.S.imp = null; B4M.ui.render(); }, hid);
  await pg.evaluate(() => B4M.ui.run("dTab", "h")); await pg.evaluate(id => { B4M.ui.S.hs = id; B4M.ui.S.ht = "p"; B4M.ui.render(); }, hid);
  const tx = await pg.textContent("#app"); ok(tx.includes("Pazar (satışa açık milliyetler)") && tx.includes("Europe & UK"), "kontrat ekranında pazar ve ülkeler");
  ok(await pg.evaluate(() => B4M.prod.NAT.some(n => n[0] == "NO") && B4M.prod.NAT.some(n => n[0] == "IE")), "arama milliyet listesinde yeni ülkeler");
  ok(!errs.length, "sayfa hatası yok " + errs.join(" | ")); await br.close(); console.log(`\n${pass} geçti, ${fail} kaldı`); process.exit(fail ? 1 : 0);
})();
