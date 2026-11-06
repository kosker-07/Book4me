/* u006 testi: yeni Excel biçimi (Crystal tipi; oda adı ayrı başlık satırında) okunur, eski biçim aynen kalır,
   erken rezervasyon sayfası SPO olur, şüpheli düşük fiyat uyarılır, tarayıcıdan yükleme çalışır. */
const { chromium } = require("playwright"), path = require("path"), fs = require("fs"), load = require("../tools/load.js");
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "✓" : "✗", m); };
const F = path.join(__dirname, "fixtures/crystal-s27-europe-uk.xlsx");
(async () => {
  const B = load(), sh = await B.xlsx.read(new Uint8Array(fs.readFileSync(F))), X = B.xp.xBook(sh), H = X.hotels;
  ok(H.length == 13, `13 otel okundu (${H.length})`); ok(H.filter(h => h.st == "e").length == 0, "okunamayan otel yok");
  const d = H.find(h => /De Luxe/.test(h.name)); ok(d && d.name == "Crystal De Luxe Comfort Collection" && d.zone == "Kemer" && d.city == "Antalya", "otel adı ve bölgesi başlıktan");
  ok(d.board == "Ultra her şey dahil" && d.cur == "EUR" && d.season == "Summer 2027 · Europe & UK", "pansiyon, para birimi, sezon (pazarıyla)");
  ok(d.periods.length == 14 && d.periods[0].name == "A" && d.periods[0].from == "2027-03-05" && d.periods[13].to == "2027-11-14", "14 periyot, adları ve tarihleri");
  ok(d.periods.every(p => p.rel != null && p.min != null), "release ve minimum konaklama");
  ok(d.rooms.length == 6 && d.rooms[0].type == "Standard Room Land View", "oda başlıkları (6 oda)");
  const lv = d.rooms[0]; ok(lv.occ.length == 6 && !lv.occ.some(c => /PER PERSON/i.test(c.lbl)), "kombinasyonlar; “per person in DBL” fiyat sayılmadı");
  ok(lv.occ.find(c => c.lbl == "DBL+EXB").alts[0].ad == 3 && lv.occ.find(c => /1 ADL \+ 1 CHD/.test(c.lbl)).alts[0].ch.length == 1, "DBL+EXB = 3 yetişkin, 1 ADL + 1 CHD = 1 çocuk");
  ok(lv.occ.find(c => c.lbl == "DBL").v[0] == 120, "fiyat doğru hücreden (DBL A = 120)");
  ok(d.W.some(w => /şüpheli/.test(w[1]) && w[2].v == 52.31), "şüpheli düşük fiyat uyarısı (52,311)"); ok(d.st == "w", "o otel “kontrol gerekli”");
  ok(H.reduce((s, h) => s + h.rooms.reduce((a, r) => a + r.occ.filter(c => c.alts.length).length, 0), 0) >= 360, "toplam kombinasyon ≥ 360");
  ok(!H.some(h => h.rooms.some(r => /Privilege/i.test(r.type))), "“Special Privileges” oda sayılmadı");
  ok(d.notes.some(n => /kontenjan 3 DBL \/ 1 SGL/.test(n)) && d.notes.some(n => /Ekonomi oda/.test(n)) && d.notes.some(n => /Pazar tanımı/.test(n)), "kontenjan, ekonomi oda ve pazar notları");
  const eb = d.eb; ok(eb && eb.length == 5 && eb[1].bf == "2026-11-01" && eb[1].bt == "2027-01-05" && eb[1].rows.length == 5 && eb[1].rows[0].pct == 25, "erken rezervasyon: 5 dönem, satış ve konaklama tarihleri, oranlar");
  /* eski biçim değişmedi */
  const A0 = load({ noUpd: true }), sig = Y => JSON.stringify(Y.hotels.map(h => [h.name, h.st, h.periods, h.rooms.map(r => [r.type, r.occ.map(c => [c.lbl, c.alts, c.v])])]));
  ok(sig(A0.xp.xBook(JSON.parse(JSON.stringify(A0.data.XDEMO)))) == sig(B.xp.xBook(JSON.parse(JSON.stringify(B.data.XDEMO)))), "eski biçim (2023_SUMMER_PRICE) birebir aynı okunuyor");
  /* kayıt */
  B.auth.start(B.db.get("users", 234)); const S = B.imp.blank(); B.imp.load(S, sh, "crystal.xlsx"); const n0 = B.db.all("hotels").length, r = B.imp.save(S, 1);
  ok(r.ok && B.db.all("hotels").length == n0 + 13, "13 otel kaydedildi");
  const a = B.db.find("hotels", h => h.name == "Crystal Aura Aqua Collection"); ok(a.rooms.length == 7 && a.seasons[0].periods.length == 13 && a.board == "Ultra her şey dahil", "kontrat: oda, sezon, periyot");
  ok(a.spo.length > 0 && a.spo.every(s => s.type == "Erken rezervasyon" && s.bt >= B.util.today() && s.pct > 0) && a.spo.some(s => /%50/.test(s.name)), "erken rezervasyon SPO'ları eklendi (süresi geçmiş EB1 hariç, ödeme şartı adında)");
  const n1 = a.spo.length; B.imp.load(S, sh, "crystal.xlsx"); B.imp.save(S, 1); ok(a.spo.length == n1, "yeniden yükleme SPO'ları çoğaltmıyor");
  { const C = load(); C.auth.start(C.db.get("users", 244)); const S2 = C.imp.blank(); C.imp.load(S2, sh, "x"); C.imp.save(S2, 1); ok(S2.done && S2.done.sk.some(x => /SPO yetkiniz/.test(x[0])) && !C.db.all("hotels").some(h => /^Crystal/.test(h.name) && (h.spo || []).length), "SPO yetkisi olmayan kullanıcıda SPO atlanır ve söylenir"); }
  /* tarayıcı */
  const br = await chromium.launch(), pg = await br.newPage({ viewport: { width: 1440, height: 1000 } }), errs = []; pg.on("pageerror", e => errs.push(e.message)); await pg.route(/^https?:\/\//, r => r.abort());
  await pg.goto("file://" + path.join(__dirname, "../dist/index.html")); await pg.evaluate(() => localStorage.clear()); await pg.reload();
  await pg.fill("#lg_e", "rezervasyon@akdeniz-turizm.example"); await pg.fill("#lg_p", "bed4book"); await pg.click("button[data-a=login]");
  await pg.evaluate(() => B4M.ui.run("dTab", "h")); await pg.click("button[data-a=hsImp]"); await (await pg.$("input[type=file][accept*=xls]")).setInputFiles(F);
  await pg.waitForFunction(() => B4M.ui.S.imp && (B4M.ui.S.imp.hotels || []).length > 0, null, { timeout: 20000 });
  ok(await pg.evaluate(() => B4M.ui.S.imp.hotels.length) == 13, "arayüzden yükleme: 13 otel"); ok((await pg.textContent("#app")).includes("Ek sayfalar"), "ek sayfalar bilgi olarak gösteriliyor");
  await pg.click("button[data-a=ixSave]"); await pg.waitForTimeout(300); ok(await pg.evaluate(() => B4M.db.all("hotels").filter(h => /^Crystal/.test(h.name)).length) == 13, "arayüzden kayıt");
  ok(!errs.length, "sayfa hatası yok " + errs.join(" | ")); await br.close(); console.log(`\n${pass} geçti, ${fail} kaldı`); process.exit(fail ? 1 : 0);
})();
