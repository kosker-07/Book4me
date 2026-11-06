/* Entegrasyon katmanı: sistem standart olaylar üretir, her dış sistem için bir adaptör olayları o sistemin diline çevirir,
   aktarımlar kuyruktan yeniden denenerek gerçekleşir. İlk sürümde tüm adaptörler simülasyon modunda hazır durur ve tek tıkla açılır. */
const IN = B4M.int = {};
const db = () => B4M.db, { ok, no } = B4M.res, PR = B4M.price, P = B4M.parties, BK = B4M.book, AC = B4M.acc;
const now = () => U.now(), today = () => U.today();
const ACC_EV = /^(invoice\.issued|payment\.|booking\.cancelled|commission\.invoice|dmc\.collection|supplier\.paid|customer\.invoice|dmc\.created|account\.created|balance\.topup\.confirmed)/;
/* katalog: kapsam p = platform, d = DMC */
IN.CAT = [
  { k: "sup_rest", g: "Tedarikçi API (gelen)", n: "Standart REST/JSON", sc: "pd", ev: null, f: ["url", "key"], d: "Otel, uçak, transfer, tur: arama, fiyat teyidi, rezervasyon, iptal" },
  { k: "sup_ota", g: "Tedarikçi API (gelen)", n: "OTA XML (OpenTravel)", sc: "pd", ev: null, f: ["url", "user", "pass"], d: "OTA_HotelAvailRQ / OTA_HotelResRQ mesajları" },
  { k: "apiout", g: "API Out (giden)", n: "bed4book API", sc: "p", ev: null, f: ["limit"], d: "Arama, fiyat teyidi, rezervasyon, iptal, sorgu, sabit içerik; test ve canlı anahtar" },
  { k: "acc_logo", g: "Muhasebe", n: "Logo", sc: "pd", ev: ACC_EV, f: ["url", "user", "pass", "firm"], d: "Fatura, tahsilat, ödeme, cari açma, iptal/iade" },
  { k: "acc_luca", g: "Muhasebe", n: "Luca", sc: "pd", ev: ACC_EV, f: ["user", "pass", "firm"], d: "Fiş ve cari aktarımı" },
  { k: "acc_mikro", g: "Muhasebe", n: "Mikro", sc: "pd", ev: ACC_EV, f: ["url", "key", "firm"], d: "Fatura ve cari hareket" },
  { k: "acc_netsis", g: "Muhasebe", n: "Netsis", sc: "pd", ev: ACC_EV, f: ["url", "user", "pass", "firm"], d: "Fatura, cari, kasa" },
  { k: "acc_parasut", g: "Muhasebe", n: "Paraşüt", sc: "pd", ev: ACC_EV, f: ["key", "firm"], d: "Satış faturası, tahsilat, müşteri" },
  { k: "acc_sap", g: "Muhasebe", n: "SAP", sc: "pd", ev: ACC_EV, f: ["url", "user", "pass", "firm"], d: "FI belgeleri (IDoc / API)" },
  { k: "bank_api", g: "Banka", n: "Banka API", sc: "pd", ev: /^payment\.transfer\.notified/, f: ["url", "key", "iban"], d: "Hesap hareketlerini çekme, havale/EFT eşleştirme" },
  { k: "bank_open", g: "Banka", n: "Açık bankacılık", sc: "pd", ev: /^payment\.transfer\.notified/, f: ["key", "iban"], d: "Hesap bilgisi ve hareket servisi" },
  { k: "bank_file", g: "Banka", n: "Ekstre dosyası", sc: "pd", ev: null, f: [], d: "CSV ekstre yükleme ve otomatik eşleştirme" },
  { k: "pos", g: "Sanal POS", n: "Sanal POS (3D Secure)", sc: "pd", ev: /^payment\.card|^booking\.cancelled/, f: ["merchant", "key", "inst"], d: "3D Secure, taksit, ön provizyon, iade; kart verisi sistemde tutulmaz" },
  { k: "efatura", g: "e-Fatura / e-Arşiv", n: "Entegratör", sc: "pd", ev: /^invoice\.issued|^commission\.invoice\.issued/, f: ["user", "pass", "vkn"], d: "Muhasebe olaylarından beslenir; UBL-TR" },
  { k: "tcmb", g: "Döviz kuru", n: "TCMB günlük kur", sc: "p", ev: null, f: [], d: "Günlük kur, platform geneli" },
  { k: "smtp", g: "E-posta", n: "SMTP / e-posta servisi", sc: "pd", ev: null, f: ["host", "user", "pass"], d: "Rezervasyon, tedarikçi ve sözleşme bildirimleri" }
];
IN.FL = { url: "Adres (https://…)", key: "API anahtarı", user: "Kullanıcı", pass: "Şifre", firm: "Firma / şirket kodu", iban: "IBAN", merchant: "Üye işyeri no", inst: "Taksit seçenekleri", vkn: "VKN / TCKN", host: "Sunucu", limit: "İstek sınırı / dk" };
IN.def = k => IN.CAT.find(c => c.k == k);
IN.list = tid => IN.CAT.filter(c => tid == "P" ? c.sc.includes("p") : c.sc.includes("d")).map(c => ({ c, r: IN.rec(tid, c.k, false) }));
IN.rec = (tid, k, create = true) => { let r = db().find("integrations", x => x.tid == tid && x.k == k); if (!r && create) r = db().add("integrations", { tid, k, on: false, mode: "Simülasyon", cfg: { map: { sales: "600", recv: "120", pay: "320", vat: "391", kdv: 20, cari: "120.01." } }, test: "", log: [], at: now() }); return r; };
IN.isOn = (tid, k) => { const r = IN.rec(tid, k, false); return !!(r && r.on); };
IN.log = (r, tt, p, st) => { r.log.unshift({ at: now(), t: tt, p: p || {}, st: st || "ok" }); if (r.log.length > 60) r.log.length = 60; };
IN.toggle = (tid, k) => {
  if (tid != "P" && !B4M.lic.has(tid, "int")) return no("Entegrasyon merkezi paketinizde yok.");
  const r = IN.rec(tid, k); r.on = !r.on; IN.log(r, r.on ? "Bağlantı açıldı (simülasyon modu)" : "Bağlantı kapatıldı");
  B4M.audit.log(r.on ? "integration.on" : "integration.off", k, "", tid);
  if (r.on && (k == "sup_rest" || k == "sup_ota") && tid != "P") IN.syncCatalog(tid, k);
  if (r.on && k == "tcmb") IN.tcmbPull();
  return ok(r.on ? "{n} açıldı. Simülasyon modunda çalışır; gerçek bağlantı bilgileri girildiğinde canlıya alınır." : "{n} kapatıldı.", { n: t(IN.def(k).n) });
};
IN.save = (tid, k, cfg) => { const r = IN.rec(tid, k); if (cfg.url && !/^https:\/\//.test(cfg.url)) return no("Adres https:// ile başlamalı."); r.cfg = { ...r.cfg, ...cfg, map: { ...(r.cfg.map || {}), ...(cfg.map || {}) } }; IN.log(r, "Ayarlar kaydedildi"); return ok("Ayarlar kaydedildi."); };
IN.test = (tid, k) => { const r = IN.rec(tid, k), d = IN.def(k), miss = d.f.filter(f => f != "inst" && f != "limit" && !String((r.cfg || {})[f] || "").trim()); r.test = miss.length ? `${now()} · ${t("Simülasyon testi geçti; canlı için eksik alanlar")}: ${miss.map(f => t(IN.FL[f])).join(", ")}` : `${now()} · ${t("Yapılandırma geçerli; simülasyon yanıtı alındı")}`; IN.log(r, "Test çalıştırıldı", {}, miss.length ? "warn" : "ok"); return ok(miss.length ? "Simülasyon testi geçti. Canlı bağlantı için eksik alanlar: {f}" : "Test başarılı (simülasyon).", { f: miss.map(f => t(IN.FL[f])).join(", ") }); };
/* olay yönlendirme: açık adaptörler olayı kuyruğa alır */
IN.route = e => { const tids = U.uniq([e.tid, "P"]); db().where("integrations", r => r.on && tids.includes(r.tid)).forEach(r => { const d = IN.def(r.k); if (d && d.ev && d.ev.test(e.ev)) e.out[r.id] = { st: "Kuyrukta", tries: 0 }; }); };
/* sistem olayını hedef sistemin diline çevir (önizleme) */
IN.translate = (k, e, map) => {
  map = map || {}; const a = U.r2(e.amt), c = e.cur, ref = e.ref, d = e.at.slice(0, 10);
  switch (k) {
    case "acc_logo": return `<INVOICE><EVENT>${e.ev}</EVENT><NUMBER>${ref}</NUMBER><DATE>${d}</DATE><ARP_CODE>${map.cari || ""}${e.dmc || ""}</ARP_CODE><GL_CODE>${map.sales}</GL_CODE><TOTAL>${a}</TOTAL><CURR_CODE>${c}</CURR_CODE><VAT_RATE>${map.kdv}</VAT_RATE></INVOICE>`;
    case "acc_luca": return [d, e.ev, ref, map.recv, map.sales, a, c, map.kdv].join(";");
    case "acc_mikro": return JSON.stringify({ evrak: ref, tarih: d, tip: e.ev, cari: (map.cari || "") + (e.dmc || ""), tutar: a, doviz: c, kdv: map.kdv });
    case "acc_netsis": return `<Fatura Tip="${e.ev}" No="${ref}" Tarih="${d}"><Cari>${map.cari || ""}${e.dmc || ""}</Cari><Tutar Doviz="${c}">${a}</Tutar><Hesap>${map.sales}</Hesap></Fatura>`;
    case "acc_parasut": return JSON.stringify({ data: { type: e.ev.startsWith("payment") ? "payments" : "sales_invoices", attributes: { description: ref, issue_date: d, currency: c, net_total: a, vat_rate: map.kdv } } });
    case "acc_sap": return `E1BPACHE09|${d}|${ref}|${e.ev}\nE1BPACGL09|${map.sales}|${a}|${c}\nE1BPACAR09|${map.recv}|${-a}|${c}`;
    case "efatura": return `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><cbc:ProfileID>TICARIFATURA</cbc:ProfileID><cbc:ID>${ref}</cbc:ID><cbc:IssueDate>${d}</cbc:IssueDate><cbc:DocumentCurrencyCode>${c}</cbc:DocumentCurrencyCode><cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="${c}">${a}</cbc:PayableAmount></cac:LegalMonetaryTotal></Invoice>`;
    case "pos": return JSON.stringify({ op: e.ev.startsWith("booking.cancelled") ? "refund" : "sale", orderId: ref, amount: a, currency: c, secure3d: true, cardData: "tutulmaz" });
    case "bank_api": case "bank_open": return JSON.stringify({ match: ref, amount: a, currency: c });
    default: return JSON.stringify({ ev: e.ev, ref, amt: a, cur: c });
  }
};
/* kuyruğu işle: simülasyon başarı; bağlantı bilgisi eksikse "simülasyon" olarak teslim edilir, hata için 5 deneme */
IN.deliver = tid => {
  let n = 0, er = 0; const R = db().where("integrations", r => r.on && (!tid || r.tid == tid || r.tid == "P"));
  db().all("events").forEach(e => Object.entries(e.out || {}).forEach(([rid, o]) => {
    if (o.st == "Gönderildi") return; const r = R.find(x => x.id == +rid); if (!r) return; o.tries++;
    if (r.cfg.fail && o.tries < 5) { o.st = "Hata"; o.next = now(); er++; IN.log(r, "Aktarım hatası, yeniden denenecek: {e} {r}", { e: e.ev, r: e.ref }, "err"); return; }
    o.st = "Gönderildi"; o.at = now(); o.payload = IN.translate(r.k, e, r.cfg.map); n++; IN.log(r, "Aktarıldı: {e} {r}", { e: e.ev, r: e.ref });
  }));
  db().all("events").forEach(e => { const v = Object.values(e.out || {}); if (v.length && v.every(o => o.st == "Gönderildi")) e.state = "Gönderildi"; });
  return ok(er ? "{n} kayıt aktarıldı, {e} kayıt hatada (yeniden denenecek)." : "{n} kayıt dış sisteme iletildi (simülasyon).", { n, e: er });
};
IN.queue = tid => db().where("events", e => (e.tid == tid || tid == "P") && Object.values(e.out || {}).some(o => o.st != "Gönderildi"));
IN.failed = tid => db().where("events", e => (e.tid == tid || tid == "P") && Object.values(e.out || {}).some(o => o.st == "Hata"));
/* ---- TCMB kuru (çevrimdışı modelde günlük simülasyon) ---- */
IN.tcmbPull = () => {
  const R = PR.rates(), base = PR.DEF_RATES, d = today(), out = {};
  Object.keys(base).forEach(c => { if (c == "TRY") return; const k = (parseInt(U.hsh(d + c), 16) % 300 - 150) / 10000; R[c] = +(base[c] * (1 + k)).toFixed(4); out[c] = R[c]; });
  db().cfg("ratesAt", now()); const r = IN.rec("P", "tcmb"); IN.log(r, "Günlük kurlar güncellendi (simülasyon): {r}", { r: Object.entries(out).slice(0, 4).map(([c, v]) => c + " " + v).join(" · ") }); B4M.events.emit("rates.updated", d, 0, "TRY");
  return ok("Kurlar güncellendi ({d}).", { d: I.fd(d) });
};
/* ---- tedarikçi API simülasyonu: DMC'nin kendi bağlantısından gelen otel kataloğu ---- */
IN.SIMH = { sup_rest: [["API Lara Beach Resort", "Antalya", "Lara", 5, "Her şey dahil"], ["API Kemer Garden", "Antalya", "Kemer", 4, "Her şey dahil"], ["API Old Town Suites", "İstanbul", "Sultanahmet", 4, "Oda kahvaltı"]], sup_ota: [["OTA Side Palace", "Antalya", "Side", 5, "Ultra her şey dahil"], ["OTA Bodrum Bay", "Muğla", "Bodrum", 4, "Yarım pansiyon"]] };
IN.syncCatalog = (dmc, k) => {
  const L = IN.SIMH[k] || [], cur = (P.activeC("s", dmc) || { curs: ["EUR"] }).curs.includes("EUR") ? "EUR" : (P.activeC("s", dmc) || { curs: ["EUR"] }).curs[0], Y0 = today(), Y1 = U.addD(Y0, 365); let n = 0;
  L.forEach(([name, city, zone, stars, board], i) => {
    let h = db().find("hotels", x => x.sup == dmc && x.name == name); if (h) return;
    const base = 60 + (parseInt(U.hsh(name), 16) % 60), r1 = { id: db().seq(), type: "Standart", cap: 3, ma: 2, mc: 1, price: base, nrp: U.r2(base * .9), allot: 20, stop: [] }, r2 = { id: db().seq(), type: "Deluxe", cap: 4, ma: 3, mc: 2, price: U.r2(base * 1.35), nrp: 0, allot: 10, stop: [] };
    h = db().add("hotels", { sup: dmc, tid: B4M.app.tidOf(dmc), name, country: "TR", city, zone, stars, board, cur, cxd: 3, addr: { line: "API" }, rooms: [r1, r2], spo: [], stops: [], src: "api", conn: k });
    h.seasons = [{ id: db().seq(), name: "API " + Y0.slice(0, 4), type: "Yaz", from: Y0, to: Y1, periods: [{ id: db().seq(), name: "P1", from: Y0, to: Y1, prices: { [r1.id]: { price: r1.price, nrp: r1.nrp }, [r2.id]: { price: r2.price, nrp: 0 } } }] }];
    PR.setMg(dmc, "h", PR.dmcMg(dmc, "h") ?? 10); n++;
  });
  const r = IN.rec(dmc, k); IN.log(r, "Katalog eşitlendi: {n} otel", { n }); return n;
};
/* ---- banka ekstresi: CSV yükleme ve rezervasyonla eşleştirme ---- */
IN.bankImport = (tid, text) => {
  const rows = B4M.xlsx.csv(text); if (rows.length < 2) return no("Ekstrede satır bulunamadı. Beklenen sütunlar: tarih; açıklama; tutar; para birimi");
  const h = rows[0].map(x => U.norm(x)), ix = k => h.findIndex(x => k.some(y => x.includes(y))), iD = ix(["tarih", "date"]), iA = ix(["aciklama", "desc"]), iT = ix(["tutar", "amount"]), iC = ix(["para", "cur"]);
  let n = 0, m = 0; rows.slice(1).forEach(r => { const amt = +String(r[iT] || "").replace(/\./g, "").replace(",", "."), desc = r[iA] || "", cur = (r[iC] || "TRY").toUpperCase(); if (!(amt > 0)) return; const no2 = (desc.match(/B4M\d{2}-\d{6}/) || [])[0] || ""; const o = no2 && db().find("orders", x => x.no == no2); const st = o && BK.oDue(o) && Math.abs(BK.oDue(o) - amt) < .01 && o.cur == cur ? "Eşleşti" : o ? "Tutar farklı" : "Eşleşmedi"; if (st == "Eşleşti") m++; db().add("bankTx", { tid, d: PD_parse(r[iD]), desc, amt, cur, ref: no2, oid: o ? o.id : 0, st, at: now() }); n++; });
  return ok("{n} hareket okundu, {m} rezervasyonla eşleşti.", { n, m });
};
const PD_parse = s => B4M.prod.parseD(String(s || "")) || today();
IN.bankApply = id => { const x = db().get("bankTx", id), o = db().get("orders", x.oid); if (!o || x.st != "Eşleşti") return no("Bu hareket eşleşmedi."); let r; if (o.pay && o.pay.state == "Onay bekliyor") r = AC.bankOk(o.id); else { const dc = AC.doPay(o, "Havale/EFT", BK.oDue(o)); r = ok(dc ? "Havale onaylandı. Voucher ve fatura oluşturuldu." : "Havale onaylandı."); } x.st = "İşlendi"; return r; };
/* ---- API Out: anahtarlar, istek sınırı, kayıt ve test konsolu ---- */
IN.keyNew = (ag, env) => { if (!IN.isOn("P", "apiout")) return no("Önce Entegrasyon merkezinden API Out'u açın."); const k = (env == "Canlı" ? "live_" : "test_") + U.sha256(ag + "|" + Math.random()).slice(0, 24); const x = db().add("apiKeys", { ag, env, key: k, on: true, at: now(), tid: "P", limit: +(IN.rec("P", "apiout").cfg.limit || 60) }); return ok("{e} anahtarı oluşturuldu: {k}", { e: t(env), k }, { x }); };
IN.keyTog = id => { const x = db().get("apiKeys", id); x.on = !x.on; return ok(x.on ? "Anahtar açıldı." : "Anahtar kapatıldı."); };
IN.EPS = ["search.hotels", "search.transfers", "search.tours", "search.flights", "price.confirm", "book", "cancel", "booking.get", "content.hotels"];
IN.call = (key, ep, body) => {
  const k = db().find("apiKeys", x => x.key == key && x.on); const lg = (st, res) => { db().add("apiLog", { tid: "P", at: now(), key: key ? key.slice(0, 9) + "…" : "", ep, st, ms: 20 + (parseInt(U.hsh(ep + now()), 16) % 80) }); return { status: st, body: res }; };
  if (!IN.isOn("P", "apiout")) return lg(503, { error: "api_out_disabled" }); if (!k) return lg(401, { error: "invalid_key" });
  const minute = now(), used = db().where("apiLog", x => x.key == key.slice(0, 9) + "…" && x.at == minute).length; if (used >= (k.limit || 60)) return lg(429, { error: "rate_limited", limit: k.limit });
  const SR = B4M.search, q = SR.q({ ag: k.ag, ...(body || {}) });
  try {
    if (ep == "search.hotels") { const r = SR.hotels(q); return lg(200, { nights: r.ns.length, currency: q.cur, hotels: r.L.slice(0, 20).map(o => ({ code: "H" + o.f.id, name: o.f.name, city: o.f.city, zone: o.f.zone, stars: o.f.stars, board: o.f.board, rooms: o.rows.map(x => ({ room: x.n, total: U.r2(x.tot), perNight: U.r2(x.p), refundable: !!x.cx, specialOffer: x.own })) })) }); }
    if (ep == "search.transfers") return lg(200, { offers: SR.transfers(q).map(x => ({ code: "T" + x.id, vehicle: x.veh, capacity: U.VEH[x.veh], price: x.price, currency: x.cur })) });
    if (ep == "search.tours") return lg(200, { offers: SR.tours(q, Math.max(1, +q.pax || 1)).map(x => ({ code: "U" + x.id, name: x.name, city: x.city, price: x.price, currency: x.cur, availability: x.free })) });
    if (ep == "search.flights") return lg(200, { offers: SR.apiFlights(q.ff, q.ft, q.d, Math.max(1, +q.pax || 1), q).map(o => ({ offerId: o.key, flightNo: o.no, carrier: o.airline, time: o.time, fare: { amount: o.price, currency: o.cur }, refundable: o.cxd >= 0, seats: o.seats })) });
    if (ep == "content.hotels") return lg(200, { hotels: db().all("hotels").filter(h => PR.supOK(h.sup, "h", k.ag)).map(h => ({ code: "H" + h.id, name: h.name, country: h.country, city: h.city, zone: h.zone, stars: h.stars, board: h.board, rooms: h.rooms.map(r => r.type) })) });
    if (ep == "booking.get") { const o = db().find("orders", x => x.no == (body || {}).no && x.ag == k.ag); return o ? lg(200, { no: o.no, status: BK.oSt(o), total: o.total, currency: o.cur, items: BK.oBks(o).map(b => ({ no: b.no, desc: b.desc, status: b.status })) }) : lg(404, { error: "not_found" }); }
    if (ep == "price.confirm" || ep == "book") {
      const tf = db().get("transfers", +String((body || {}).code || "").slice(1)); if (!tf) return lg(400, { error: "code_required", hint: "search.transfers sonucundaki code (T…)" });
      const it = { ...SR.trItem(tf, 1, q.d, "", q), guests: (body || {}).guests || ["API Guest"] }, price = U.r2(PR.cv(it.total, it.cur, q.cur));
      if (ep == "price.confirm") return lg(200, { code: body.code, price, currency: q.cur, refundable: (tf.cxd ?? 1) >= 0 });
      if (k.env != "Canlı") return lg(200, { test: true, confirmationNo: "TEST-" + U.hsh(JSON.stringify(body)).slice(0, 8), price, currency: q.cur });
      const r = BK.place({ ag: k.ag, items: [it], label: "API Out", cur: q.cur, nat: q.nat, by: "API", noResale: true }); return r.ok ? lg(200, { confirmationNo: r.order.no, status: "confirmed", price, currency: q.cur }) : lg(422, { error: t(r.msg, r.p) });
    }
    if (ep == "cancel") { const o = db().find("orders", x => x.no == (body || {}).no && x.ag == k.ag); if (!o) return lg(404, { error: "not_found" }); if (k.env != "Canlı") return lg(200, { test: true, status: "cancelled" }); BK.oBks(o).forEach(b => BK.cancel(b.id)); return lg(200, { status: BK.oSt(o) }); }
    return lg(404, { error: "unknown_endpoint" });
  } catch (e) { return lg(500, { error: String(e.message || e) }); }
};
/* ---- platform tedarikçi API bağlantıları (Back Office) ---- */
IN.APS = { h: "Otel", f: "Uçak", t: "Transfer", u: "Tur" }; IN.APP = ["REST / JSON", "SOAP / XML", "OTA XML (OpenTravel)", "GraphQL"]; IN.APA = ["API anahtarı", "Kullanıcı adı / şifre", "OAuth 2.0 (client credentials)"];
IN.apiAdd = o => { if (!o.name) return no("Sağlayıcı adını girin."); if (!/^https:\/\/[^\s]+\.[^\s]+/.test(o.url || "")) return no("Endpoint https:// ile başlayan geçerli bir adres olmalı."); db().add("apis", { sv: o.sv, name: o.name, proto: o.proto, url: o.url, auth: o.auth, key: o.key ? "••••" + o.key.slice(-4) : "", cur: o.cur, env: o.env, mk: +o.mk || 0, timeout: +o.timeout || 8, cache: +o.cache || 0, on: false, search: false, test: "Test edilmedi", map: [] }); B4M.events.emit("api.created", o.name, 0); return ok("API bağlantısı eklendi; test edip açabilirsiniz."); };
IN.apiSet = (id, k, v) => { const a = db().get("apis", id); if (k == "on" && v && !/^ok/.test(a.testSt || "")) return no("Önce bağlantıyı test edin."); if (k == "search" && v && !a.on) return no("Aramaya eklemek için önce bağlantıyı açın."); a[k] = v; return ok(""); };
IN.apiTest = id => { const a = db().get("apis", id), err = []; if (!/^https:\/\//.test(a.url)) err.push("https gerekli"); if (!a.key) err.push("kimlik bilgisi eksik"); if (!(a.timeout > 0)) err.push("zaman aşımı geçersiz"); a.testSt = err.length ? "err" : "ok"; a.test = err.length ? `${t("Hata")}: ${err.map(x => t(x)).join(", ")} · ${now()}` : `${t("Yapılandırma geçerli")} · ${now()} · ${t("canlı adaptör geliştirme bekliyor")}`; return err.length ? no("Test başarısız: {e}", { e: err.map(x => t(x)).join(", ") }) : ok("Yapılandırma geçerli. Canlı bağlantı, adaptör geliştirildiğinde etkinleşir."); };
IN.apiMapAdd = (id, code, ref) => { const a = db().get("apis", id); if (!code || !ref) return no("Kod ve karşılığını seçin."); a.map = (a.map || []).filter(m => m.code != code); a.map.push({ code, ref }); return ok("Eşleştirildi."); };
IN.apiUnmap = (id, i) => { db().get("apis", id).map.splice(i, 1); return ok(""); };
IN.ADAPTERS = {}; IN.apiOffers = (sv, q) => db().where("apis", a => a.sv == sv && a.on && a.search && a.env == "Canlı" && IN.ADAPTERS[a.proto]).flatMap(a => IN.ADAPTERS[a.proto](a, q) || []);
IN.SPEC = { h: { req: { destination: "Antalya/Lara", checkIn: "2027-07-10", checkOut: "2027-07-14", nationality: "TR", currency: "EUR", rooms: [{ adults: 2, childAges: [5] }] }, res: { hotelCode: "PRV-12345", rooms: [{ roomCode: "STD", board: "AI", price: { amount: 812.4, currency: "EUR" }, refundable: true, cancelPolicy: [{ until: "2027-07-03", penalty: 0 }], allotment: 3, rateKey: "…" }] }, book: "POST /book {rateKey, guests[], reference} → {confirmationNo, status}", cancel: "POST /cancel {confirmationNo} → {status, penalty}" },
  f: { req: { from: "IST", to: "AYT", date: "2027-07-10", adults: 2, currency: "EUR" }, res: { offers: [{ offerId: "…", carrier: "TK", flightNo: "TK2410", fare: { amount: 112.5, currency: "EUR" }, refundable: false, seats: 9 }] }, book: "POST /order {offerId, passengers[]} → {pnr, ticketNos[]}", cancel: "POST /void {pnr} → {status, refund}" },
  t: { req: { from: "AYT", to: "Kemer", date: "2027-07-10T14:35", pax: 3, currency: "EUR" }, res: { offers: [{ offerId: "…", vehicle: "Minivan", capacity: 7, price: { amount: 65, currency: "EUR" }, cancelUntilHours: 24 }] }, book: "POST /book {offerId, leadGuest, flightNo, pickupTime} → {confirmationNo}", cancel: "POST /cancel {confirmationNo} → {status}" },
  u: { req: { city: "Antalya", date: "2027-07-11", pax: { adults: 2, children: 1 }, currency: "EUR" }, res: { offers: [{ productCode: "BOAT-01", price: { adult: 35, child: 18, currency: "EUR" }, startTime: "09:30", availability: 40 }] }, book: "POST /book {productCode, date, guests[]} → {confirmationNo}", cancel: "POST /cancel {confirmationNo} → {status}" } };
