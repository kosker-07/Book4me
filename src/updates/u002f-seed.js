/* Yama 1 · örnek veriler (yalnızca ilk açılışta bir kez; mevcut veriye dokunmaz, yanına ekler)
   Giderler, maaşlar, prim kuralları, maaş talebi, tanıtım faturaları, bütçe, rebooking teminatları ve puanları, H2H bağlantısı ve karşılaştırma için bir otel daha. */
const db = () => B4M.db, Y1 = B4M.y1, FN = B4M.fin;
Y1.hooks.unshift({ seed() {
  const d = db(), m0 = U.today().slice(0, 7), M = n => FN.addM(m0, n), D = (n, day) => M(n) + "-" + U.pad(day, 2), sys = "Sistem";
  /* rebooking profilleri: teminat ve puan → risk grubu */
  [[1, 5000, 86], [3, 3000, 72], [4, 2500, 68], [2, 1500, 45]].forEach(([id, dep, score]) => { const x = d.get("dmcs", id); if (x) x.rb = { score, dep, depCur: "EUR", wins: 0, fails: 0, src: true, bid: true, auto: true, pen: [] }; });
  /* karşılaştırma için: aynı otel başka bir DMC'de (Mavi Seyahat), tüm pazarlara açık */
  if (d.get("dmcs", 4) && !d.find("hotels", h => h.sup == 4 && h.name == "Akdeniz Palas")) {
    const h = d.add("hotels", { sup: 4, tid: 4, name: "Akdeniz Palas", country: "TR", city: "Antalya", zone: "Lara", stars: 5, board: "Her şey dahil", cur: "EUR", cxd: 5, addr: { line: "", zip: "", phone: "", email: "", lat: "", lng: "" },
      rooms: [{ id: d.seq(), type: "Standart", cap: 2, ma: 2, mc: 1, bed: "Çift kişilik", view: "Kara", size: 24, price: 80, nrp: 72, allot: 5, stop: [] }, { id: d.seq(), type: "Deluxe Deniz", cap: 3, ma: 3, mc: 2, bed: "Çift kişilik + tek", view: "Deniz", size: 32, price: 128, nrp: 0, allot: 2, stop: [] }], spo: [], stops: [] });
    B4M.events.emit("hotel.created", h.id, 0, "EUR", 4); }
  /* giderler: platform */
  const X = (tid, cat, amt, cur, dd, desc, rec, dept) => d.add("expenses", { tid, cat, code: FN.cat(cat)[2], dept: dept || "", amt, cur, d: dd, desc, rec: !!rec, end: "", by: sys, at: dd + " 09:00" });
  X("P", "sys", 1200, "EUR", D(-5, 1), "Sunucu ve yazılım lisansları", 1); X("P", "rent", 45000, "TRY", D(-5, 1), "Ofis kirası", 1); X("P", "bank", 120, "EUR", D(-5, 1), "POS ve banka masrafları", 1); X("P", "prof", 18000, "TRY", D(-5, 1), "Mali müşavirlik", 1);
  X("P", "ins", 900, "EUR", D(-2, 10), "İşyeri ve mesleki sorumluluk sigortası"); X("P", "fly", 640, "EUR", D(-1, 14), "Fuar seyahati (uçak + otel)", 0, "Commercial"); X("P", "mkt", 1500, "EUR", D(0, 3), "Dijital reklam (marka bilinirliği)", 0, "Commercial"); X("P", "fly", 380, "EUR", D(0, 2), "Otel ziyaretleri", 0, "Product / Otel Kontrat");
  /* giderler: Akdeniz Turizm */
  X(1, "sys", 250, "EUR", D(-5, 1), "Yazılım ve iletişim", 1); X(1, "rent", 30000, "TRY", D(-5, 1), "Ofis kirası", 1); X(1, "opx", 22000, "TRY", D(-5, 1), "Transfer araç kiralama", 1, "Operasyon"); X(1, "ins", 400, "EUR", D(-1, 5), "Seyahat acentası sorumluluk sigortası"); X(1, "mkt", 300, "EUR", D(0, 1), "Sosyal medya reklamı");
  /* maaşlar (brüt, TRY) → işveren maliyetiyle gidere girer */
  const S = (tid, email, gross) => { const u = d.find("users", u => u.email == email); if (u) d.add("salaries", { tid, uid: u.id, name: u.name, dept: u.dept, gross, cur: "TRY", from: M(-5), to: "", by: sys, at: D(-5, 1) + " 09:00" }); };
  S("P", "muhasebe@bed4book.com", 85000); S("P", "satis@bed4book.com", 80000); S("P", "kontrat@bed4book.com", 78000); S("P", "dmc@bed4book.com", 75000); S("P", "operasyon@bed4book.com", 70000);
  S(1, "mehmet@akdeniz-turizm.example", 60000); S(1, "operasyon@akdeniz-turizm.example", 52000); S(1, "deniz@akdeniz-turizm.example", 50000); S(1, "muhasebe@akdeniz-turizm.example", 58000);
  /* prim kuralları: tüm giderler düştükten sonraki kârın %1'i (herkes); satışçıya kendi satış kârının %2'si */
  d.add("bonusRules", { tid: "P", uid: 0, dept: "", base: "net", pct: 1, from: M(-5), by: sys, at: D(-5, 1) + " 09:00" }); d.add("bonusRules", { tid: 1, uid: 0, dept: "", base: "net", pct: 1, from: M(-5), by: sys, at: D(-5, 1) + " 09:00" });
  const dz = d.find("users", u => u.email == "deniz@akdeniz-turizm.example"); if (dz) d.add("bonusRules", { tid: 1, uid: dz.id, dept: "", base: "own", pct: 2, from: M(-5), by: sys, at: D(-5, 1) + " 09:00" });
  if (dz) d.where("bookings", b => b.own == 1).forEach(b => { b.by = dz.name; });
  /* maaş talebi (bekliyor) */
  const op = d.find("users", u => u.email == "operasyon@bed4book.com"); if (op) { const x = d.add("salReq", { tid: "P", uid: op.id, name: op.name, dept: op.dept, amt: 78000, cur: "TRY", note: "Yıllık değerlendirme sonrası artış talebi", st: "Bekliyor", at: D(0, 2) + " 10:30" });
    B4M.notif.push({ tid: "P", depts: ["Muhasebe"], perms: ["sal"], title: "Yeni maaş talebi: {n}", tp: { n: op.name }, kind: "sal", ref: x.id }); }
  /* tanıtım faturaları: otellere; sıralamaya etkisi yok */
  const P1 = (tid, hid, hotel, amt, dd, st, desc) => d.add("promoInv", { tid, no: (tid == "P" ? "TNT-" : "TNT" + tid + "-") + dd.slice(0, 4) + "-" + U.pad(d.where("promoInv", x => x.tid == tid).length + 1, 4), hid, hotel, amt, cur: "EUR", d: dd, period: dd.slice(0, 7), desc, st, by: sys, at: dd + " 11:00", set: st != "Açık" ? { by: sys, at: dd + " 12:00", mode: st == "Mahsup edildi" ? "mahsup" : "tahsil" } : undefined });
  P1("P", 3, "Belek Golf Resort", 600, D(-1, 20), "Tahsil edildi", "Bülten ve ana sayfa tanıtım paketi"); P1("P", 3, "Belek Golf Resort", 750, D(0, 1), "Açık", "Sezon açılış tanıtımı"); P1(1, 1, "Akdeniz Palas", 400, D(0, 2), "Mahsup edildi", "Acente sunumu ve e-bülten");
  /* bütçe (bu ay, platform) */
  [["rev", 6000], ["622", 0], ["760", 2500], ["770", 9500], ["780", 200]].forEach(([code, amt]) => d.add("budgets", { tid: "P", m: m0, code, amt }));
  /* H2H örneği */
  d.add("h2h", { tid: 1, name: "Riviera Partners (Almanya)", dir: "gelen", env: "Test", limit: 60, on: true, at: D(0, 1) + " 09:00", key: "" });
} });
