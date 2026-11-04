/* Agent katmanı: 9 agent hazır ve kapalı kurulur; açıldığında kurallarla çalışır (yapay zekâ en alt seviyede), işi hazırlar,
   canlı veriye dokunmadan onay kuyruğuna bırakır. Okeyle / Okeyleme; yüksek riskte ikinci onay; cevap yoksa hiçbir şey canlıya geçmez. */
const AG = B4M.agents = {};
const db = () => B4M.db, { ok, no } = B4M.res, PR = B4M.price, P = B4M.parties, BK = B4M.book, AC = B4M.acc, OP = B4M.ops, IN = B4M.int, RP = B4M.rep, PD = B4M.prod;
const now = () => U.now(), today = () => U.today();
AG.DEF = [
  { k: "yazilim", n: "Yazılım", where: "Kod deposu, testler, yayın", appr: "Her yayın", dept: "Diğer" },
  { k: "product", n: "Product", where: "Fiyat listesi yükleme, otel eşleştirme", appr: "\"Kontrol gerekli\" satırlar", dept: "Product" },
  { k: "rez", n: "Rezervasyon", where: "Açık alış/satış, değişiklik, iptal, otel teyidi", appr: "Cezalı iptal ve iade", dept: "Rezervasyon" },
  { k: "ops", n: "Operasyon", where: "Tedarikçi atama, pickup listesi", appr: "Tedarikçi değişikliği", dept: "Operasyon" },
  { k: "acc", n: "Muhasebe", where: "Banka hareketi eşleştirme, hatırlatma, komisyon faturası", appr: "Her para hareketi", dept: "Muhasebe" },
  { k: "destek", n: "Destek", where: "DMC ve acente soruları, 4 dil", appr: "Şikayet ve tazminat", dept: "Diğer" },
  { k: "kontrat", n: "Kontrat", where: "Belge kontrolü, sözleşme bitişi", appr: "İmza ve panel açılışı", dept: "Kontrat" },
  { k: "fiyat", n: "Fiyat ve profit", where: "Marj ve fiyat anomalisi", appr: "Markup değişikliği", dept: "Satış" },
  { k: "entg", n: "Entegrasyon", where: "API sağlığı, hata kuyruğu, OCR kuyruğu", appr: "Bağlantıyı kapatma", dept: "Diğer" }
];
AG.rec = (tid, k) => { let r = db().find("agents", x => x.tid == tid && x.k == k); if (!r) r = db().add("agents", { tid, k, on: false, runs: 0, last: "", skip: {} }); return r; };
AG.isOn = (tid, k) => { const r = db().find("agents", x => x.tid == tid && x.k == k); return !!(r && r.on); };
AG.toggle = (tid, k) => { if (tid != "P" && !B4M.lic.has(tid, "agent")) return no("Agent merkezi paketinizde yok."); const r = AG.rec(tid, k); r.on = !r.on; B4M.audit.log(r.on ? "agent.on" : "agent.off", k, "", tid); return ok(r.on ? "{n} agent açıldı; işleri onay kuyruğuna düşer." : "{n} agent kapatıldı.", { n: t(AG.DEF.find(a => a.k == k).n) }); };
AG.queue = tid => db().where("approvals", x => x.tid == tid).sort((a, b) => b.id - a.id);
AG.pending = tid => AG.queue(tid).filter(x => x.state == "Bekliyor");
/* öneri ekle (aynı anahtar bekliyorsa veya reddedilip atlanıyorsa tekrar eklenmez) */
AG.propose = (tid, agent, o) => {
  const r = AG.rec(tid, agent); if (o.key && (r.skip[o.key] && r.skip[o.key] >= today())) return null;
  if (o.key && db().find("approvals", x => x.tid == tid && x.key == o.key && x.state == "Bekliyor")) return null;
  return db().add("approvals", { tid, agent, key: o.key || "", title: o.title, tp: o.tp || {}, why: o.why, wp: o.wp || {}, risk: o.risk || "Düşük", test: o.test || "Ön kontrol geçti", preview: o.preview || "", act: o.act, state: "Bekliyor", at: now(), rem: "", hist: [] });
};
/* uygulanacak işler: yalnızca onaydan sonra çalışır */
AG.ACT = {
  fillGap: ({ hid, sid, from, to }) => { const s = PD.SX(hid, sid); if (!s) return no(""); const prev = s.periods.slice().sort((a, b) => a.from.localeCompare(b.from)).filter(p => p.to < from).pop() || s.periods[0]; s.periods.push({ id: db().seq(), name: "P+", from, to, prices: U.clone(prev ? prev.prices : {}) }); return ok("Boşluk periyodu eklendi."); },
  markChecked: ({ hid }) => { const h = PD.H(hid); if (h) h.checked = now(); return ok("Otel kontrol edildi olarak işaretlendi."); },
  setBuy: ({ bid }) => { const b = db().get("bookings", bid), c = BK.bkCost(b) || { amt: U.r2(b.cost / 1.1), cur: b.costCur }; b.dbuy = c; return ok("Alış fiyatı işlendi."); },
  assignSup: ({ gid }) => { const s = db().get("gsales", gid), p = OP.gp(s.pid), bb = OP.best(p, s.ad, s.ch); if (!bb) return no("Alış fiyatı yok."); return OP.rhEdit(gid, { sid: bb.sid, ad: bb.ad, ch: bb.ch, cur: bb.cur, pick: s.pick, pickAt: s.pickAt || s.hotel, note: s.opNote || "" }, t("Agent: Operasyon")); },
  bankApply: ({ id }) => IN.bankApply(id),
  remind: ({ oid }) => { const o = db().get("orders", oid), a = db().get("accounts", o.ag) || {}; B4M.mail.send({ to: a.email || "", subj: `Ödeme hatırlatması ${o.no}`, body: `${o.no} için ödenecek tutar ${I.fm(BK.oDue(o), o.cur)}. Son ödeme tarihi ${o.due}.`, tid: o.tid }); return ok("Hatırlatma e-postası gönderildi."); },
  commInv: ({ dmc, month }) => AC.commInvoice(dmc, month),
  kRemind: ({ cid }) => { const c = P.K(cid), x = P.get(c.p, c.pid) || {}; B4M.mail.send({ dmc: c.p == "s" ? c.pid : 0, to: x.email || "", subj: `Sözleşme bitişi ${c.no}`, body: `${c.no} sözleşmesi ${c.end} tarihinde sona eriyor.`, tid: c.tid }); return ok("Sözleşme hatırlatması gönderildi."); },
  docOk: ({ cid, k }) => P.docOk(cid, k),
  margin: ({ dmc, sv, v }) => PR.setMg(dmc, sv, v),
  retry: ({ tid }) => IN.deliver(tid),
  intOff: ({ tid, k }) => IN.toggle(tid, k),
  release: ({ ver }) => { db().cfg("release", { ver, at: now() }); return ok("Yayın kaydı oluşturuldu: {v}", { v: ver }); },
  answer: ({ q, a }) => ok("Yanıt gönderildi.")
};
AG.decide = (id, yes, reason, sure) => {
  const x = db().get("approvals", id); if (!x || x.state != "Bekliyor") return no("Bu iş artık beklemiyor.");
  if (yes) {
    if (x.risk == "Yüksek" && !sure) return { ok: false, confirm: true, msg: "Emin misiniz? Bu iş yüksek riskli (ödeme, şifre veya veri silme)." };
    const f = AG.ACT[x.act.fn]; const r = f ? f(x.act.args || {}) : no("");
    x.state = "Onaylandı"; x.done = now(); x.by = B4M.app.user().name; x.result = r.msg ? t(r.msg, r.p) : "";
    B4M.audit.log("agent.approved", x.agent + ":" + x.id, x.result, x.tid); return ok("Okeylendi; iş canlıya geçti. {r}", { r: x.result });
  }
  if (!String(reason || "").trim()) return { ok: false, ask: true, msg: "Neden okeylemiyorsunuz? (agent düzeltip yeniden gönderir)" };
  x.state = "Reddedildi"; x.done = now(); x.reason = reason; x.by = B4M.app.user().name; B4M.audit.log("agent.rejected", x.agent + ":" + x.id, reason, x.tid);
  /* agent gerekçeyi kaydeder: aynı öneriyi 7 gün tekrarlamaz; düzeltilmiş ön kontrollü yeni sürümü gönderir */
  const r = AG.rec(x.tid, x.agent); if (x.key) r.skip[x.key] = U.addD(today(), 7);
  const y = { ...U.clone(x), key: "", state: "Bekliyor", at: now(), hist: [...(x.hist || []), { at: now(), reason }], rev: (x.rev || 0) + 1, risk: x.risk == "Düşük" ? "Düşük" : "Orta", test: t("Gerekçeye göre yeniden kontrol edildi") + ": " + reason };
  ["id", "done", "by", "reason", "result", "rem"].forEach(k => delete y[k]); const z = db().add("approvals", y);
  return ok("Okeylenmedi. Gerekçe kaydedildi; agent düzeltip yeniden gönderdi.", null, { z });
};
/* cevap verilmeyen işler ertesi gün bir kez hatırlatılır */
AG.remind = () => { let n = 0; db().where("approvals", x => x.state == "Bekliyor" && !x.rem && x.at.slice(0, 10) < today()).forEach(x => { x.rem = now(); n++; }); return n; };
/* ---- agent çalıştırma (kural tabanlı) ---- */
AG.run = (tid, only) => {
  const on = k => (!only || only == k) && AG.isOn(tid, k), dmcs = tid == "P" ? db().where("dmcs", d => !d.parent).map(d => d.id) : [tid]; let n = 0; const add = (k, o) => { if (AG.propose(tid, k, o)) n++; };
  if (on("product")) dmcs.forEach(d => PD.myH(d).forEach(h => (h.seasons || []).forEach(s => PD.seGaps(s).slice(0, 2).forEach(([f, to]) => add("product", { key: `gap:${h.id}:${s.id}:${f}`, title: "{h}: {s} sezonunda {f} → {t} periyotsuz", tp: { h: h.name, s: s.name, f: I.fd(f), t: I.fd(to) }, why: "Periyotla kapsanmayan tarihler satışa kapalı kalır. Önceki periyodun fiyatlarıyla bir boşluk periyodu eklenmesi öneriliyor.", risk: "Orta", preview: `${f} → ${to}`, act: { fn: "fillGap", args: { hid: h.id, sid: s.id, from: f, to } } })))));
  if (on("rez")) dmcs.forEach(d => RP.rsRows(d).filter(r => r.act && !r.buy && r.ed == "buy").slice(0, 10).forEach(r => add("rez", { key: "buy:" + r.k, title: "{no}: alış fiyatı girilmemiş", tp: { no: r.no }, why: "Alış ve satış birlikte tamamlanmalı. DMC'nin alış-satış farkıyla hesaplanan alış fiyatının işlenmesi öneriliyor.", risk: "Düşük", preview: r.hn, act: { fn: "setBuy", args: { bid: r.ref.id } } })));
  if (on("ops")) dmcs.forEach(d => OP.myGS(d).filter(s => s.st == "Yeni").forEach(s => { const bb = OP.best(OP.gp(s.pid), s.ad, s.ch); if (bb) add("ops", { key: "gs:" + s.id, title: "{no}: en uygun tedarikçi {o}", tp: { no: s.no, o: (OP.os(bb.sid) || {}).name }, why: "Rehber satışı operasyon bekliyor. En düşük alış fiyatlı tedarikçinin atanması öneriliyor.", risk: "Orta", preview: `${OP.gp(s.pid).name} · ${s.d} · ${I.fm(OP.amt(OP.gp(s.pid).unit, bb, s), bb.cur)}`, act: { fn: "assignSup", args: { gid: s.id } } }); }));
  if (on("acc")) {
    db().where("bankTx", x => x.tid == tid && x.st == "Eşleşti").forEach(x => add("acc", { key: "bank:" + x.id, title: "Banka hareketi {r} ile eşleşti", tp: { r: x.ref }, why: "Ekstredeki tutar ve açıklama rezervasyonun ödenecek tutarıyla aynı. Ödemenin işlenmesi öneriliyor.", risk: "Yüksek", preview: `${I.fd(x.d)} · ${I.fm(x.amt, x.cur)} · ${x.desc}`, act: { fn: "bankApply", args: { id: x.id } } }));
    db().where("orders", o => (tid == "P" || o.tid == tid) && !o.auto && BK.oDue(o) && o.due <= U.addD(today(), 2) && !o.hold).slice(0, 10).forEach(o => add("acc", { key: "rem:" + o.id + ":" + o.due, title: "{no}: ödeme hatırlatması", tp: { no: o.no }, why: "Son ödeme tarihi yaklaşıyor; ödenmezse rezervasyon otomatik iptal edilir.", risk: "Düşük", preview: `${I.fm(BK.oDue(o), o.cur)} · ${I.fd(o.due)}`, act: { fn: "remind", args: { oid: o.id } } }));
    if (tid == "P") db().where("dmcs", d => !d.parent && AC.commOpen(d.id).length).forEach(d => { const m = U.addD(today().slice(0, 7) + "-01", -1).slice(0, 7), L = AC.commOpen(d.id).filter(c => c.month <= m); if (L.length) add("acc", { key: "kms:" + d.id + ":" + m, title: "{d}: {m} komisyon faturası", tp: { d: d.name, m }, why: "DMC'nin kendi API ticaretinden doğan %1 + %1 komisyonların ay sonu faturası.", risk: "Yüksek", preview: I.fm(U.r2(L.reduce((s, c) => s + c.totalE, 0)), "EUR"), act: { fn: "commInv", args: { dmc: d.id, month: m } } }); });
  }
  if (on("kontrat")) {
    db().where("contracts", c => (tid == "P" ? !c.by : c.tid == tid) && P.kSt(c) == "Aktif" && c.end <= U.addD(today(), 30)).forEach(c => add("kontrat", { key: "kend:" + c.id, title: "{no} sözleşmesi {d} tarihinde bitiyor", tp: { no: c.no, d: I.fd(c.end) }, why: "Süre dolunca panel kapanır. Karşı tarafa hatırlatma gönderilmesi öneriliyor.", risk: "Düşük", act: { fn: "kRemind", args: { cid: c.id } } }));
    if (tid == "P") db().all("contracts").forEach(c => Object.entries(c.docs || {}).filter(([k, d]) => d.st == "Bekliyor").forEach(([k, d]) => { const fine = /^image\/|pdf/.test(d.type || "") && (d.data || "").length > 100; add("kontrat", { key: `doc:${c.id}:${k}:${d.at}`, title: "{no}: {d} kontrol edildi", tp: { no: c.no, d: t(P.DOCS.find(x => x[0] == k)[1]) }, why: fine ? "Dosya türü ve boyutu uygun; okunabilir görünüyor." : "Dosya önizlemesi yok; elle kontrol edin.", risk: "Orta", test: fine ? "Ön kontrol geçti" : "Ön kontrol: önizleme yok", preview: d.name, act: { fn: "docOk", args: { cid: c.id, k } } }); }));
  }
  if (on("fiyat")) dmcs.forEach(d => { const R = RP.rsRows(d).filter(r => r.act && r.pr != null && r.pr < 0); if (R.length) { const sv = R[0].sv, cur = PR.dmcMg(d, sv) ?? 0; add("fiyat", { key: `mg:${d}:${sv}:${cur}`, title: "{d}: {n} rezervasyonda negatif profit", tp: { d: P.dmcName(d), n: R.length }, why: "Alış fiyatı satıştan yüksek. {s} için alış-satış farkının %{a} → %{b} yapılması öneriliyor.", wp: { s: t(U.SVN[sv]), a: cur, b: cur + 5 }, risk: "Yüksek", preview: R.slice(0, 3).map(r => r.no).join(", "), act: { fn: "margin", args: { dmc: d, sv, v: cur + 5 } } }); } });
  if (on("entg")) { const F = IN.failed(tid); if (F.length) add("entg", { key: "retry:" + F.length + ":" + today(), title: "{n} aktarım hatada", tp: { n: F.length }, why: "Kuyruktaki hatalı aktarımların yeniden denenmesi öneriliyor.", risk: "Düşük", act: { fn: "retry", args: { tid } } }); db().where("integrations", r => r.tid == tid && r.on && r.log.filter(l => l.st == "err").length >= 5).forEach(r => add("entg", { key: "off:" + r.id, title: "{n} bağlantısı sürekli hata veriyor", tp: { n: t(IN.def(r.k).n) }, why: "Son aktarımların çoğu hatalı. Bağlantının kapatılması öneriliyor.", risk: "Yüksek", act: { fn: "intOff", args: { tid, k: r.k } } })); }
  if (on("yazilim")) { const chk = AG.selfCheck(); add("yazilim", { key: "rel:" + today(), title: "Bakım sürümü {v} yayına hazır", tp: { v: chk.ver }, why: "Otomatik veri bütünlüğü kontrolleri çalıştırıldı.", risk: "Orta", test: chk.txt, act: { fn: "release", args: { ver: chk.ver } } }); }
  AG.DEF.forEach(a => { if (on(a.k)) { const r = AG.rec(tid, a.k); r.runs++; r.last = now(); } });
  return ok("{n} yeni iş onay kuyruğuna düştü.", { n });
};
AG.selfCheck = () => { const B = db().all("bookings"), orphan = B.filter(b => !db().get("orders", b.oid)).length, neg = db().all("hotels").flatMap(h => h.rooms).filter(r => r.allot < 0).length; return { ver: "41." + db().all("audit").length % 100, txt: `${t("Yetim rezervasyon")}: ${orphan} · ${t("Negatif kontenjan")}: ${neg} · ${t("Rezervasyon")}: ${B.length}` }; };
/* içe aktarım gibi olaylardan gelen notlar */
AG.note = (k, data, dmc) => { const tid = B4M.app.tidOf(dmc); if (!AG.isOn(tid, k)) return; if (data.kind == "check") AG.propose(tid, k, { key: "chk:" + data.hid, title: "{h}: kontrol gerekli satırlar", tp: { h: data.name }, why: "Fiyat listesinden {n} uyarıyla yüklendi. Fiyatları belgeyle karşılaştırıp kontrol edildi olarak işaretleyin.", wp: { n: data.warn }, risk: "Orta", act: { fn: "markChecked", args: { hid: data.hid } } }); };
/* destek agentı: 4 dilde sık sorulanlar; şikayet ve tazminat insan onayına gider */
AG.FAQ = [[/iptal|cancel|إلغاء|отмен/i, "İptal şartları her hizmette gösterilir. Son ücretsiz iptal tarihine kadar iptal ücretsizdir; sonrasında ücret iade edilmez."], [/ödeme|payment|دفع|оплат/i, "Ödeme kredi kartı, havale/EFT, bakiye veya ön ödeme ile yapılır. Son ödeme tarihi rezervasyonda yazar."], [/fatura|invoice|فاتورة|счет/i, "Platform faturası ödeme tahsil edildikten sonra oluşur ve Rezervasyonlar ekranından açılır."], [/voucher|فاوتشر|ваучер/i, "Voucher ödeme veya ön ödeme blokajından sonra düzenlenir."]];
AG.ask = (tid, q, lang) => {
  if (!AG.isOn(tid, "destek")) return no("Destek agentı kapalı.");
  const sens = /şikayet|tazminat|complain|compensat|شكوى|تعويض|жалоб|компенсац/i.test(q), f = AG.FAQ.find(([re]) => re.test(q)), sv = I.lang; I.set(lang || sv); const a = f ? t(f[1]) : t("Sorunuz ilgili departmana iletildi; en kısa sürede dönüş yapılacak."); I.set(sv);
  if (sens) { AG.propose(tid, "destek", { title: "Şikayet / tazminat talebi", why: "Talep insan onayı gerektiriyor. Taslak yanıt hazırlandı.", risk: "Yüksek", preview: `${q}\n—\n${a}`, act: { fn: "answer", args: { q, a } } }); return ok("Talebiniz alındı; yetkili onayından sonra yanıtlanacak."); }
  return ok(a);
};
