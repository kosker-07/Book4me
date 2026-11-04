/* u004 testi (Yama 2a): menü sadeleştirme, tam ekran düzenleri, tek arama, tek rezervasyon ekranı, oluşturma/seyahat tarihi, tek/çift tık,
   Benim işlerim, hatırlanan filtre ve sütunlar, Yama 1'den 2a'ya alınan 17 madde. Önce iş kuralları (Node), sonra tarayıcı. */
const { chromium } = require("playwright"), path = require("path"), load = require("../tools/load.js");
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "✓" : "✗", m); };
const as = (B, id) => { B.auth.logout(); B.auth.start(B.db.get("users", id)); };
(async () => {
  /* ---- iş kuralları ---- */
  { const B = load(), m = B.util.today().slice(0, 7);
    as(B, 230); B.parties.newAccount("Yeni Acente Test", "yeni@acente.example"); as(B, 232); ok(B.notif.forUser().some(n => n.kind == "acct"), "C: yeni satış hesabı bildirimi DMC departmanına da gidiyor");
    as(B, 228); const p = B.fin.addPromo("P", { hid: 1, amt: 100, cur: "EUR", d: B.util.today() }); as(B, 229); ok(B.notif.forUser().some(n => n.kind == "promo"), "C: tanıtım faturası bildirimi Muhasebe'ye gidiyor");
    as(B, 228); const r0 = B.acc.recvOpenE(1); B.fin.settlePromo(p.x.id, "mahsup"); ok(Math.abs(B.acc.recvOpenE(1) - (r0 - 100)) < 0.01, "K: mahsup platformun DMC'ye ödeyeceği tutardan düşüyor");
    ok(["tpay", "stamp", "dep"].every(k => B.fin.CATS.some(c => c[0] == k)), "I: turizm payı, damga vergisi, amortisman gider türü");
    as(B, 233); const q = B.fin.reqSal({ amt: 90000, cur: "TRY" }); ok(q.x.st == "Yönetici onayında", "I: maaş talebi önce yöneticiye gidiyor");
    as(B, 229); ok(!B.fin.decideSal(q.x.id, true).ok, "I: Muhasebe yönetici onayından önce onaylayamaz");
    as(B, 228); ok(B.salFlow.decide(q.x.id, true).ok && q.x.st == "Bekliyor", "I: yönetici onayı → Muhasebe'ye geçti");
    as(B, 229); ok(B.fin.decideSal(q.x.id, true).ok && q.x.st == "Onaylandı", "I: Muhasebe onayı");
    as(B, 233); ok(B.notif.forUser().some(n => n.kind == "salme"), "kişiye özel bildirim (karar) yalnızca talep edene gidiyor"); as(B, 230); ok(!B.notif.forUser().some(n => n.kind == "salme"), "başka kullanıcı kişiye özel bildirimi görmüyor");
    as(B, 228); const rr = B.fin.setRule("P", { pct: 1, base: "net", name: "Kâr primi testi" }); ok(rr.x && rr.x.name == "Kâr primi testi", "H: prim kuralına ad");
    const x = B.fin.extra("P", m); ok(x.perBk > 0 && x.collected >= 0 && x.payable >= 0 && x.staff.length > 0, "J: rezervasyon başına gelir, tahsil edilen, ödenecek, çalışan kârlılığı");
    as(B, 234); ok(B.fin.setBudget(1, m, "770", 1000).ok, "J: DMC bütçesi kaydediliyor");
    B.pref.set(234, "x", 5); ok(B.pref.get(234, "x") == 5 && B.pref.get(228, "x") == null, "tercihler kullanıcı bazında");
    const b = B.db.find("bookings", y => y.no == "B4M26-000007-1"); as(B, 237); ok(B.bkx.side(b) == "buy", "rezervasyon tarafı: alıcı DMC"); as(B, 234); ok(B.bkx.side(b) == "sup", "rezervasyon tarafı: tedarikçi DMC"); as(B, 238); ok(!B.bkx.canSee(b), "ilgisiz DMC rezervasyonu göremez"); }
  /* ---- tarayıcı ---- */
  const br = await chromium.launch(), pg = await br.newPage({ viewport: { width: 1280, height: 900 } }), errs = []; await pg.route(/^https?:\/\//, r => r.abort()); pg.on("pageerror", e => errs.push(e.message));
  const URL = "file://" + path.join(__dirname, "../dist/index.html"); await pg.goto(URL); await pg.evaluate(() => localStorage.clear()); await pg.reload();
  const ev = f => pg.evaluate(f), run = (a, p) => pg.evaluate(([a, p]) => B4M.ui.run(a, p), [a, p]), txt = () => pg.textContent("#app");
  const login = async e => { await pg.evaluate(() => { const b = document.querySelector("button[data-a=logout]"); if (b) b.click(); }); await pg.fill("#lg_e", e); await pg.fill("#lg_p", "book4me"); await pg.click("button[data-a=login]"); };
  await login("admin@book4me-ai.com");
  ok(await ev(() => document.querySelectorAll(".sidenav .gh").length) == 7, "Back Office menüsü 7 başlık");
  const reach = await ev(() => { const T = B4M.vHQ.tabs().map(x => x[0]).filter(k => k != "pw"), seen = new Set(); B4M.vNav.H.forEach(g => g[1].forEach(l => l[1].forEach(sb => seen.add(sb[0])))); return T.filter(k => !seen.has(k)); });
  ok(!reach.length, "eski 21 sekmenin hepsine menüden ulaşılıyor " + reach.join(","));
  ok(await ev(() => B4M.vNav.S.reduce((s, g) => s + g[1].length, 0)) == 30, "DMC menüsü 30 giriş (6 grup; 41 ekranın hepsi korunuyor)");
  ok(await ev(() => !!document.querySelector("#hdr button.usr") && !document.querySelector('.sidenav button[data-p=\'"pw"\']')), "Hesabım üst bantta");
  await run("hTab", "res"); ok(await ev(() => document.querySelector("main").getBoundingClientRect().width) >= 1270, "1040 px sınırı kalktı (tam genişlik)");
  /* tek kullanıcılık yetki: menü yok */
  await ev(() => { const u = B4M.auth.addUserRaw({ org: "h", oid: 0, name: "Tek Yetki", email: "tek@book4me-ai.com", perms: ["log"], dept: "Diğer", tid: "P" }); B4M.db.commit(); });
  await login("tek@book4me-ai.com"); ok(await ev(() => !document.querySelector(".sidenav") && !document.querySelector("nav.tabs")), "tek ekrana yetkili kullanıcı menü görmüyor, doğrudan ekranına düşüyor");
  await login("admin@book4me-ai.com"); await run("hTab", "res");
  /* tek arama */
  for (const [q, w] of [["B4M26-000007", "Rezervasyon"], ["Deniz Aksoy", "Rezervasyon"], ["VCH-B4M26-000004", "Rezervasyon"], ["Belek", "Otel"], ["Mavi", "DMC"], ["K-2026", "Sözleşme"]]) { await pg.fill("#hs_q", q); await pg.waitForTimeout(50); ok(await ev(w => [...document.querySelectorAll("#hs_r .hsg")].some(x => x.textContent.includes(B4M.t(w))), w), `arama "${q}" → ${w}`); }
  await pg.fill("#hs_q", "B4M26-000007"); await pg.press("#hs_q", "ArrowDown"); await pg.keyboard.press("Enter"); ok(await pg.isVisible(".bxw"), "arama sonucundan tek tıkla rezervasyon ekranı");
  const t7 = await pg.textContent(".bxw"); ok(["Misafirler", "Hizmet", "Fiyat", "Ödeme ve son ödeme", "İptal koşulları", "Belgeler", "Notlar", "Geçmiş"].every(s => t7.includes(s)) && /Oluşturma/.test(t7) && /Seyahat/.test(t7), "rezervasyon ekranı: tüm bölümler, oluşturma ve seyahat tarihi");
  await run("bxClose");
  /* tek / çift tık */
  const row = 'tr[data-bx]'; await pg.click(`${row} >> nth=0`, { position: { x: 30, y: 10 } }); ok(await pg.isVisible("tr.bqr"), "tek tık: satırın altında özet"); ok(!(await pg.$(".bxw")), "tek tık tam ayrıntıyı açmıyor");
  await pg.dblclick(`${row} >> nth=1`, { position: { x: 30, y: 10 } }); ok(await pg.isVisible(".bxw"), "çift tık: tam ayrıntı"); await run("bxClose");
  await pg.click(`${row} >> nth=0 >> button[data-a=bxOpen]`); ok(await pg.isVisible(".bxw"), "“Aç” düğmesi"); await run("bxClose");
  /* tarih filtreleri ve sıralama */
  const n0 = await ev(() => document.querySelectorAll("tr[data-bx]").length);
  await ev(() => { const f = { bs: "t", a: "2026-11-20", b: "2026-11-30" }; Object.entries(f).forEach(([k, v]) => { B4M.pref.set(B4M.ctx.uid, "lf_hres", { ...B4M.vRez.lf("hres"), [k]: v }); }); B4M.ui.render(); });
  const n1 = await ev(() => [...document.querySelectorAll("tr[data-bx]")].map(r => B4M.db.get("bookings", +r.dataset.bx).a)); ok(n1.length < n0 && n1.every(a => a >= "2026-11-20" && a <= "2026-11-30"), "seyahat tarihi aralığı filtresi");
  await run("lfClr", "hres"); await ev(() => { B4M.pref.set(B4M.ctx.uid, "lf_hres", { ...B4M.vRez.lf("hres"), o: "tr" }); B4M.ui.render(); });
  const ord = await ev(() => [...document.querySelectorAll("tr[data-bx]")].map(r => B4M.db.get("bookings", +r.dataset.bx).a)); ok(ord.join() == ord.slice().sort().join(), "seyahat tarihine göre sıralama");
  /* sütunlar ve filtre kalıcı */
  await run("lcOpen", "hres"); await pg.click('input[data-c=lcTog][data-p=\'["hres","sup"]\']'); ok(await ev(() => [...document.querySelectorAll("th")].some(x => x.textContent == B4M.t("Tedarikçi"))), "sütun eklendi");
  await login("admin@book4me-ai.com"); await run("hTab", "res"); ok(await ev(() => [...document.querySelectorAll("th")].some(x => x.textContent == B4M.t("Tedarikçi")) && B4M.vRez.lf("hres").o == "tr"), "sütun ve filtre yeniden girişte korunuyor");
  await run("lcDef", "hres"); await run("lfClr", "hres");
  /* Benim işlerim + dashboard */
  await run("hTab", "o"); await run("dbp", "30"); ok(await pg.isVisible("#mywork"), "Benim işlerim (Dashboard'un üstünde)");
  ok(await ev(() => document.querySelectorAll(".kpi .dlt").length) >= 3, "B4: kartlarda önceki döneme göre değişim");
  const dt = await txt(); ok(dt.includes("Alacak yaşlandırma · firma bazında") && dt.includes("Ödenmediği için otomatik iptal edilenler"), "B2: firma × kova ve otomatik iptal edilenler");
  await pg.selectOption("select[data-c=dbB]", "t"); ok(await ev(() => B4M.ui.S.dbB == "t") && (await txt()).includes("Satış trendi"), "dashboard seyahat tarihine göre çalışıyor"); await pg.selectOption("select[data-c=dbB]", "c");
  /* Yama 1 eksikleri: ekranlar */
  await run("hTab", "pr"); const pr = await txt(); ok(pr.includes("DMC profitleri") && pr.includes("Acente profitleri"), "A5: v40 kutu adları");
  await run("hTab", "fa"); ok(!!(await pg.$("button[data-a=faCsv]")), "D: fiyat analizinde CSV kopyalama");
  await run("nv", ["cm", { cmT: "legal" }]); ok(!!(await pg.$("button[data-a=lgTerms]")), "F: Legal'de şart değiştirme");
  await pg.fill("#lg_x", "Test ek şartı"); await pg.click("button[data-a=lgTerms]"); ok(await ev(() => B4M.legal.vers(B4M.db.all("contracts")[0].id).some(v => /Şartlar/.test(v.what))), "F: şart değişikliği sürüm olarak kaydedildi");
  await run("nv", ["acc", { acT: "fbon" }]); ok(!!(await pg.$("#bn_n")), "H: prim kuralı ad alanı");
  await run("nv", ["acc", { acT: "fr" }]); const fr = await txt(); ok(fr.includes("Rezervasyon başına net gelir") && fr.includes("Çalışan kârlılığı"), "J: ek finans göstergeleri");
  await run("nv", ["acc", { acT: "dp" }]); ok(!errs.length, "DMC ödemeleri çizildi");
  /* DMC */
  await login("rezervasyon@akdeniz-turizm.example"); ok(await ev(() => document.querySelectorAll(".sidenav .gh").length) == 6, "DMC menüsü 6 grup");
  await run("dTab", "mbd"); ok((await txt()).includes("Bütçe"), "J: DMC bütçesi");
  await run("dTab", "r"); ok(await ev(() => document.querySelectorAll("tr[data-bx]").length) > 0, "DMC rezervasyon işlemleri birleşik listede");
  await login("operasyon@maviseyahat.example"); await ev(() => B4M.ui.run("bxOpen", B4M.db.find("bookings", b => b.no == "B4M26-000007-1").id));
  const mv = await pg.textContent(".bxw"); ok(!mv.includes("Akdeniz Turizm") && !mv.includes(B4M_t_tedarikci()), "alıcı tarafında tedarikçi adı görünmüyor");
  /* taşma */
  for (const w of [375, 1280, 1920]) { await pg.setViewportSize({ width: w, height: 900 }); await login("admin@book4me-ai.com"); await run("hTab", "res"); const o1 = await ev(() => document.documentElement.scrollWidth <= innerWidth + 1); await ev(() => B4M.ui.run("bxOpen", B4M.db.all("bookings")[0].id)); const o2 = await ev(() => document.documentElement.scrollWidth <= innerWidth + 1); ok(o1 && o2, `${w} px: yatay taşma yok`); }
  await pg.setViewportSize({ width: 1920, height: 900 }); ok(await ev(() => { const l = document.querySelector(".lay"); return l.classList.contains("hasdet") && getComputedStyle(l.querySelector(".cnt")).display != "none"; }), "geniş ekran: liste ve ayrıntı yan yana (üç panel)");
  await pg.setViewportSize({ width: 375, height: 800 }); await run("bxClose"); await run("navTog"); ok(await ev(() => getComputedStyle(document.querySelector(".side")).display != "none"), "telefon: menü çekmece olarak açılıyor");
  ok(await ev(() => !!document.querySelector(".tw td[data-label]")), "telefon: tablolar kart görünümü");
  ok(!errs.length, "sayfa hatası yok " + errs.join(" | ")); await br.close(); console.log(`\n${pass} geçti, ${fail} kaldı`); process.exit(fail ? 1 : 0);
})();
function B4M_t_tedarikci() { return "Tedarikçi"; }
