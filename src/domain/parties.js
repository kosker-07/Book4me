/* Taraflar ve sözleşmeler: DMC'ler (s), satış/alıcı hesapları (a), alt hesaplar, sözleşme ve belge onayı. */
const P = B4M.parties = {};
const db = () => B4M.db, today = () => U.today(), now = () => U.now();
const ok = (msg, p, x) => Object.assign({ ok: true, msg, p }, x || {}), no = (msg, p) => ({ ok: false, msg, p });
B4M.res = { ok, no };
P.PN = { s: "DMC", a: "Satış hesabı" };
P.DOCS = [["k", "İmzalı sözleşme"], ["c", "Şirket bilgileri"], ["v", "Vergi levhası"], ["b", "Banka hesap bilgileri"]];
P.coll = p => p == "s" ? "dmcs" : "accounts";
P.list = p => db().all(P.coll(p));
P.get = (p, id) => db().get(P.coll(p), id);
P.name = (p, id) => (P.get(p, id) || {}).name || "";
P.dmcName = id => P.name("s", id);
P.accName = id => P.name("a", id);
P.parentOf = (p, id) => (P.get(p, id) || {}).parent;
P.isSub = (p, id) => !!P.parentOf(p, id);
P.rootOf = (p, id) => { let x = id, q, n = 0; while ((q = P.parentOf(p, x)) && n++ < 6) x = q; return x; };
P.K = id => db().get("contracts", id);
/* ---- sözleşme durumu ---- */
P.docSt = c => { const d = c.docs || {}; if (P.DOCS.some(([k]) => !d[k])) return "Belge bekliyor"; if (P.DOCS.some(([k]) => d[k].st == "Reddedildi")) return "Belge reddedildi"; if (P.DOCS.some(([k]) => d[k].st != "Onaylandı")) return "Belge onayı bekliyor"; return ""; };
P.kSt = c => c.susp ? "Kapalı (platform)" : !c.sigM || !c.sigP ? "İmza bekliyor" : P.docSt(c) || (!c.ver ? "Admin onayı bekliyor" : today() < c.start ? "Başlamadı" : today() > c.end ? "Süresi doldu" : "Aktif");
/* lisans askıdaysa DMC'nin tüm adresleri ve sözleşmeleri kapanır */
P.licOK = p => { if (!p) return true; const L = B4M.lic && B4M.lic.of(p); return !L || L.status != "Askıda"; };
P.activeC = (p, id) => {
  const c = db().where("contracts", c => c.p == p && c.pid == id && P.kSt(c) == "Aktif").sort((a, b) => b.start.localeCompare(a.start))[0];
  if (!c) return undefined;
  const x = P.get(p, id); if (x && x.parent && !P.activeC(p, x.parent)) return undefined;
  if (p == "s" && !P.licOK(B4M.app.tidOf(id))) return undefined;
  if (p == "a" && x && (x.owner || x.buyer) && !P.licOK(B4M.app.tidOf(x.owner || x.buyer))) return undefined;
  return c;
};
P.subK = (p, id) => db().where("contracts", c => c.p == p && c.pid == id).sort((a, b) => b.id - a.id)[0];
P.seedRules = () => ({ s: { curs: ["EUR", "USD", "TRY"], services: ["h", "t", "f", "u"], comm: 0, cancel: 0, extra: "" }, a: { curs: ["EUR", "USD", "TRY"], services: ["h", "t", "f", "u"], comm: 10, cancel: 7, extra: "" }, cxAdj: 1 });
P.rules = () => db().cfg("rules") || db().cfg("rules", P.seedRules());
P.nextNo = () => `K-${today().slice(0, 4)}-${U.pad(db().all("contracts").length + 1, 3)}`;
P.docSvg = (title, co) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="560" viewBox="0 0 420 560"><rect width="420" height="560" fill="#ffffff"/><rect x="20" y="20" width="380" height="520" fill="none" stroke="#c9d3d2"/><text x="40" y="72" font-family="sans-serif" font-size="22" font-weight="600" fill="#14262b">${U.esc(title)}</text><text x="40" y="102" font-family="sans-serif" font-size="15" fill="#5d7075">${U.esc(co)}</text>${Array.from({ length: 12 }, (_, i) => `<rect x="40" y="${140 + i * 28}" width="${340 - (i % 3) * 70}" height="8" rx="2" fill="#e3e9e8"/>`).join("")}<text x="40" y="518" font-family="sans-serif" font-size="12" fill="#5d7075">Demo</text></svg>`);
P.fullDocs = (pn, note, at) => Object.fromEntries(P.DOCS.map(([k, tt]) => [k, { name: `${U.slug(tt)}.svg`, type: "image/svg+xml", data: P.docSvg(tt, pn), at, st: "Onaylandı", note: note || "" }]));
P.mkK = (p, pid, o) => {
  const at = o.at || now();
  const c = { id: db().seq(), no: P.nextNo(), p, pid, start: o.start || today(), end: o.end || U.addD(today(), 365), curs: [...(o.curs || ["EUR"])], services: [...(o.services || ["h", "t", "f", "u"])], comm: o.comm || 0, cancel: o.cancel || 0, extra: o.extra || "", susp: false, sigM: o.sigM || null, sigP: o.sigP || null, docs: o.docs || {}, ver: o.ver || null, tid: o.tid };
  if (o.by) c.by = o.by;
  return db().add("contracts", c);
};
P.activeAll = (p, pid, pn, by, curs, svs, end, note) => {
  const at = now();
  return P.mkK(p, pid, { by, curs, services: svs, end, sigM: { name: (by ? P.name(by.p, by.id) : "Platform") + " Yetkilisi", at }, sigP: { name: pn + " Yetkilisi", at }, docs: P.fullDocs(pn, note, at), ver: { at, code: "" }, tid: P.tidFor(p, pid) });
};
P.tidFor = (p, id) => { const x = P.get(p, id); if (!x) return "P"; return x.tid || (p == "s" ? B4M.app.tidOf(id) : x.owner || x.buyer ? B4M.app.tidOf(x.owner || x.buyer) : "P"); };
/* ---- okunabilir sözleşme metni (dile göre) ---- */
P.termsText = c => {
  const pn = P.name(c.p, c.pid), sv = c.services.map(x => t(U.SVN[x])).join(", "), L = []; let n = 0; const a = (s, p) => L.push(`${++n}. ${t(s, p)}`);
  L.push(`${t("SÖZLEŞME NO")}: ${c.no}`, c.by ? t("TARAFLAR: {a} (üst firma) ile {b} (alt hesap); bed4book (www.bed4book.com) platform kurallarına tabidir", { a: P.name(c.by.p, c.by.id), b: pn }) : t("TARAFLAR: bed4book (www.bed4book.com) ile {b} ({r})", { b: pn, r: t(P.PN[c.p]) }), "");
  a("SÜRE: Sözleşme {a} ile {b} tarihleri arasında geçerlidir.", { a: I.fd(c.start), b: I.fd(c.end) });
  if (c.p == "s") {
    a("KAPSAM: DMC şu hizmetleri yükler ve satar: {sv}. Panelde yalnızca bu hizmetlerin ekranları açılır.", { sv });
    a("PARA BİRİMLERİ: Fiyatlar yalnızca şu para birimlerinde yüklenebilir: {c}. Anlaşma para birimi, fiyatın yüklendiği para birimidir.", { c: c.curs.join(", ") });
    a("TİCARİ MODEL: Platform, DMC'ye açtığı tüm ürünlerde varsayılan %5 markup uygular (DMC bazında değiştirilebilir). DMC'nin kendi API bağlantısından gelen ticarette alış tutarının %1'i ve satış tutarının %1'i platform komisyonudur; API/XML bağlantı ücreti alınmaz. İade edilen tutardan komisyon alınmaz; cezalı iptalde yalnızca ceza tutarından alınır.");
    a("FATURA: Platform ürünleri platformdan DMC'ye tek faturada faturalanır. DMC kendi API'sinden ve kendi ürünlerinden yaptığı satışları kendi unvanıyla faturalar; platform ay sonunda DMC'ye tek komisyon faturası keser. Komisyon, platformun DMC'ye borçlu olduğu tutarlardan veya ön ödeme bakiyesinden mahsup edilebilir.");
    a("İPTAL ŞARTLARI: Otel fiyatları sezon kontratları halinde, tarih bazlı periyotlar ve periyoda özel oda fiyatlarıyla yüklenir. DMC her ürün için son ücretsiz iptal süresini yükler ve dilerse iade edilemez (nonref) fiyat ekleyebilir. Platform, alıcıya uygulanan süreyi kısaltabilir veya uzatabilir.");
    a("ÖDEME: Platform kredi ile çalışmaz. Platform alıcılarına yapılan satışlarda DMC'ye ödemeyi platform yapar; ödeme, hizmetin çıkış tarihinden itibaren iki haftalık süre dolduktan sonra gelen ilk cuma günü, anlaşma para biriminde yapılır. İptal edilen rezervasyonlar için ödeme yapılmaz.");
    a("SORUMLULUK: Platformun tek ticari muhatabı DMC'dir. DMC'nin alt acente, tedarikçi ve müşterileriyle yaptığı anlaşmalardan doğan her sorumluluk DMC'ye aittir; platform teknoloji hizmeti sağlar.");
    a("ADİL KULLANIM: Çok sayıda arama yapıp satış getirmeyen bağlantılar için arama/rezervasyon oranı sınırı uygulanabilir.");
    a("ONAY VE İPTAL: Yönlenen rezervasyon onay beklenmeden kesinleşir. Müşterinin yaptığı iptaller DMC paneline anında yansır ve bildirilen e-posta adresine gönderilir.");
  } else {
    a("KAPSAM: Hesap şu hizmetleri satın alabilir: {sv}.", { sv });
    a("PARA BİRİMLERİ: Rezervasyon şu para birimlerinden biriyle yapılır: {c} (varsayılan {d}). Ödeme, rezervasyonun yapıldığı para biriminde yapılır.", { c: c.curs.join(", "), d: c.curs[0] });
    a("FATURALAMA: Platform hizmet bedelini net fiyat üzerinden fatura eder ve tahsilatı hesap sahibinden yapar. Hesap sahibi kendi komisyonunu ekleyerek müşterisine kendi faturasını keser.");
    a("ÖDEME: Kredi tanınmaz. Ödeme kredi kartı, havale/EFT, bakiye veya ön ödeme ile yapılır. Son ödeme tarihi, hizmetlerin son ücretsiz iptal tarihlerinin en erkenidir. İade edilemez ve iptal süresi geçmiş hizmetler anında ödenir. Süresinde ödenmeyen rezervasyon sistem tarafından iptal edilir.");
    a("İPTAL VE DEĞİŞİKLİK: İptal şartları her hizmet için tedarikçinin yüklediği son iptal süresine göre uygulanır. Son ücretsiz iptal tarihine kadar değişiklik ve iptal ücretsizdir; sonrasında ücret iade edilmez. İade edilemez rezervasyonlarda her değişiklik tedarikçi onayına tabidir. Uçak biletlerinde isim değişikliği yapılamaz.");
  }
  if (c.by) a("ALT HESAP: {a}, {b} bünyesinde ayrı bir alt hesaptır. Kapsamı üst firmanın sözleşmesindeki hizmet ve para birimleriyle sınırlıdır; üst firmanın hesabı kapanırsa alt hesap da kapanır.", { a: pn, b: P.name(c.by.p, c.by.id) });
  a("YÜRÜRLÜK: Bu sözleşme iki tarafça imzalanıp istenen dört belge (imzalı sözleşme, şirket bilgileri, vergi levhası, banka hesap bilgileri) yüklendikten ve onaylandıktan sonra yürürlüğe girer. Onaydan sonra platform hizmet kapsamını, para birimlerini, süreyi ve hesabın açık/kapalı durumunu yeniden imza gerektirmeden güncelleyebilir.");
  if ((c.extra || "").trim()) L.push("", t("EK ŞARTLAR") + ":", c.extra.trim());
  return L.join("\n");
};
P.kCode = c => { const sv = I.lang; I.set("tr"); const x = U.hsh(P.termsText(c) + "|" + (c.sigM || {}).name + "|" + (c.sigP || {}).name + "|" + P.DOCS.map(([k]) => ((c.docs || {})[k] || {}).name).join("|")); I.set(sv); return x; };
/* ---- sözleşme işlemleri ---- */
P.logK = (c, txt) => {
  (c.log = c.log || []).push({ at: now(), txt });
  B4M.events.emit("contract.admin.update", c.no, 0, "TRY", c.p == "s" ? c.pid : 0);
  if (c.p == "s") { const s = P.get("s", c.pid); B4M.mail.send({ dmc: c.pid, to: (s && s.email) || "", subj: `Sözleşme güncellemesi ${c.no}`, body: `Platform hesabınızda değişiklik yaptı:\n${txt}\nBu değişiklik yeniden imza gerektirmez.`, tid: B4M.app.tidOf(c.pid) }); }
};
P.newK = (p, pid) => { const r = P.rules()[p]; const c = P.mkK(p, pid, { curs: r.curs, services: r.services, comm: r.comm, cancel: r.cancel, extra: r.extra, tid: P.tidFor(p, pid) }); B4M.events.emit("contract.created", c.no, 0); return ok("Taslak sözleşme oluşturuldu.", null, { c }); };
P.saveK = (id, o) => {
  const c = P.K(id); if (!o.curs.length || !o.services.length) return no("En az bir hizmet ve bir para birimi seç.");
  if (!o.start || !o.end || o.end < o.start) return no("Geçerli başlangıç ve bitiş tarihi gir.");
  const old = { services: [...c.services], curs: [...c.curs], start: c.start, end: c.end, extra: c.extra || "" }, before = JSON.stringify(old);
  Object.assign(c, { curs: o.curs, services: o.services, extra: o.extra || "", start: o.start, end: o.end });
  if (JSON.stringify({ services: c.services, curs: c.curs, start: c.start, end: c.end, extra: c.extra || "" }) == before) return no("Değişiklik yok.");
  if (c.ver) {
    const ch = [], sv = x => x.map(y => U.SVN[y]).join(", ") || "—";
    if (old.services.join() != c.services.join()) ch.push(`Hizmet kapsamı: ${sv(old.services)} → ${sv(c.services)}`);
    if (old.curs.join() != c.curs.join()) ch.push(`Para birimleri: ${old.curs.join(", ")} → ${c.curs.join(", ")}`);
    if (old.start != c.start || old.end != c.end) ch.push(`Süre: ${old.start} – ${old.end} → ${c.start} – ${c.end}`);
    if (old.extra != (c.extra || "")) ch.push("Ek şartlar güncellendi");
    P.logK(c, ch.join(" · ") || "Ayarlar güncellendi");
    return ok("Değişiklik uygulandı. Sözleşme onaylı olduğu için yeniden imza veya belge istenmez.");
  }
  const had = c.sigM || c.sigP; c.sigM = c.sigP = null; if (c.docs && c.docs.k) delete c.docs.k; B4M.events.emit("contract.updated", c.no, 0);
  return ok(had ? "Şartlar onaydan önce değişti; imzalar ve imzalı sözleşme belgesi sıfırlandı." : "Şartlar kaydedildi.");
};
P.signM = (id, name) => { const c = P.K(id); if (!name) return no("Platform yetkilisinin adını gir."); c.sigM = { name, at: now() }; B4M.events.emit("contract.signed.hq", c.no, 0); return ok("Platform adına imzalandı."); };
P.signP = (id, name, accepted) => { const c = P.K(id); if (!accepted) return no("Önce şartları okuyup kabul kutusunu işaretle."); if (!name) return no("Yetkili ad soyad gir."); c.sigP = { name, at: now() }; B4M.events.emit("contract.signed.party", c.no, 0); return ok("Sözleşme imzalandı. Belgelerinizi yükleyin; admin onayından sonra paneliniz açılır."); };
P.signBy = (id, userName) => { const c = P.K(id); c.sigM = { name: `${userName} (${P.name(c.by.p, c.by.id)})`, at: now() }; B4M.events.emit("contract.signed.parent", c.no, 0); return ok("Sözleşme üst firma adına imzalandı."); };
P.verifyK = id => { const c = P.K(id); if (!(c.sigM && c.sigP) || P.docSt(c)) return no("Panel açılışı için iki imza ve dört belgenin onayı gerekli."); c.ver = { at: now(), code: P.kCode(c) }; B4M.events.emit("contract.verified", c.no, 0); return ok(today() < c.start ? "Onaylandı. {n} paneli {d} tarihinde açılacak." : "Onaylandı. {n} paneli kullanıma açıldı.", { n: P.name(c.p, c.pid), d: I.fd(c.start) }); };
P.suspK = id => { const c = P.K(id); c.susp = !c.susp; P.logK(c, c.susp ? "Hesap platform tarafından kapatıldı" : "Hesap yeniden açıldı"); return ok(c.susp ? "Hesap kapatıldı; panel ve satışlar durdu. Yeniden açmak için imza gerekmez." : "Hesap yeniden açıldı."); };
P.putDoc = (id, k, file) => { const c = P.K(id); c.docs = c.docs || {}; c.docs[k] = { name: file.name, type: file.type, data: file.data, at: now(), st: "Bekliyor", note: "" }; c.ver = null; B4M.events.emit("document.uploaded", c.no + "/" + k, 0); return ok("{d} yüklendi. Admin onayı bekleniyor.", { d: t(P.DOCS.find(x => x[0] == k)[1]) }); };
P.docOk = (id, k) => { const c = P.K(id); if (k == "k" && !(c.sigM && c.sigP)) return no("İmzalı sözleşme, iki taraf imzalamadan onaylanamaz."); c.docs[k].st = "Onaylandı"; c.docs[k].note = ""; B4M.events.emit("document.approved", c.no + "/" + k, 0); return ok("{d} onaylandı.", { d: t(P.DOCS.find(x => x[0] == k)[1]) }); };
P.docNo = (id, k, note) => { const c = P.K(id); if (!note) return no("Ret nedenini yaz."); c.docs[k].st = "Reddedildi"; c.docs[k].note = note; c.ver = null; B4M.events.emit("document.rejected", c.no + "/" + k, 0); return ok("Belge reddedildi; karşı taraf yeniden yükleyecek."); };
P.subScope = (id, k, v) => {
  const c = P.K(id), n = c[k].includes(v) ? c[k].filter(x => x != v) : [...c[k], v]; if (!n.length) return no("En az bir seçenek kalmalı.");
  const pc = P.activeC(c.by.p, c.by.id); c[k] = k == "curs" ? pc.curs.filter(x => n.includes(x)) : pc.services.filter(x => n.includes(x));
  if (c.ver) P.logK(c, k == "curs" ? "Para birimleri: " + c.curs.join(", ") : "Hizmet kapsamı: " + c.services.map(s => U.SVN[s]).join(", ")); else { c.sigP = null; if (c.docs && c.docs.k) delete c.docs.k; }
  return ok(c.ver ? "Kapsam güncellendi; yeniden imza gerekmez." : "Kapsam güncellendi; alt hesap sözleşmeyi yeniden imzalamalı.");
};
P.saveRules = (s, a) => { if (!s.curs.length || !s.services.length || !a.curs.length || !a.services.length) return no("Her iki şablonda da en az bir hizmet ve para birimi seç."); db().cfg("rules", { s, a, cxAdj: P.rules().cxAdj || 0 }); return ok("Varsayılanlar kaydedildi. Yeni sözleşmeler bu şartlarla açılır."); };
P.saveAdj = v => { v = Math.round(+v || 0); if (v < -30 || v > 30) return no("-30 ile 30 gün arasında bir değer gir."); P.rules().cxAdj = v; B4M.events.emit("rule.cancel.adjust", v, 0); return ok("İptal süresi ayarı kaydedildi; yeni sorgu ve rezervasyonlarda uygulanır."); };
/* ---- hesap açma ---- */
P.newCode = () => { const used = [...P.list("s"), ...P.list("a")].map(x => x.code); let c; do c = String(1000 + Math.floor(Math.random() * 9000)); while (used.includes(c)); return c; };
P.slugFree = base => { let s = U.slug(base).replace(/-(turizm|tur|travel|otelcilik|seyahat|tedarik)$/,"") || "dmc", i = 1, x = s; while (P.list("s").some(d => d.slug == x)) x = s + "-" + (++i); return x; };
/* Back Office yeni DMC açar: firma + yönetici + lisans + marka + standart adres */
P.newDMC = (name, email, pkg) => {
  if (!name) return no("Firma adı gir."); if (email && !U.isMail(email)) return no("Geçerli bir e-posta gir.");
  const id = db().seq(), slug = P.slugFree(name);
  const d = db().add("dmcs", { id, name, code: P.newCode(), email, slug, tid: id, mgn: { h: 10, t: 15, u: 20, f: 5 }, ch: { h: { hq: true, own: true }, t: { hq: true, own: true }, u: { hq: true, own: true } } });
  const pw = B4M.auth.tempPw();
  B4M.auth.addUserRaw({ org: "s", oid: id, name: name + " Yöneticisi", email, role: "admin", perms: [], unit: "", tid: id, pw });
  B4M.lic.create(id, pkg || "Profesyonel");
  B4M.events.emit("dmc.created", id, 0, "TRY", id);
  return ok("{n} hesabı açıldı ({u}). Panel, sözleşme ve belgeler onaylanınca açılır. Geçici şifre: {pw}", { n: name, u: B4M.brand.host(d), pw }, { d });
};
P.newAccount = (name, email) => { if (!name) return no("Firma adı gir."); const id = db().seq(); db().add("accounts", { id, name, code: P.newCode(), email, tid: "P" }); B4M.auth.addUserRaw({ org: "a", oid: id, name: name + " Yöneticisi", email, role: "admin", perms: [], unit: "", tid: "P" }); B4M.events.emit("account.created", id, 0); return ok("{n} hesabı açıldı. Panel, sözleşme ve belgeler onaylanınca açılır.", { n: name }); };
/* DMC alt DMC açar */
P.addSub = (pid, name, email) => {
  if (!name) return no("Firma adını gir."); if (email && !U.isMail(email)) return no("Geçerli bir e-posta gir."); const pc = P.activeC("s", pid); if (!pc) return no("Sözleşmeniz aktif değil.");
  const tid = B4M.app.tidOf(pid), id = db().seq(), par = P.get("s", pid);
  db().add("dmcs", { id, name, email, code: "", parent: pid, pp: { h: 0, t: 0, f: 0, u: 0 }, tid, mgn: { ...(par.mgn || {}) }, ch: U.clone(par.ch || {}) });
  B4M.auth.addUserRaw({ org: "s", oid: id, name: name + " Yöneticisi", email, role: "admin", perms: [], unit: "", tid });
  P.mkK("s", id, { by: { p: "s", id: pid }, end: pc.end, curs: pc.curs, services: pc.services, tid });
  B4M.events.emit("subdmc.created", id, 0, "TRY", pid);
  return ok("{n} alt hesabı açıldı. Sözleşmeyi imzalayın; alt hesap yöneticisi giriş yapıp imzalayacak ve belgelerini yükleyecek.", { n: name }, { id });
};
/* DMC kendi acentesini açar: acente hesabı (DMC'nin ürünlerini DMC'nin kârıyla görür) + DMC panelinde alt hesap */
P.addOwnAg = (dmc, name, email, mk) => {
  if (!name) return no("Acente adını girin."); if (email && !U.isMail(email)) return no("Geçerli bir e-posta girin."); const c = P.activeC("s", dmc); if (!c) return no("Sözleşmeniz aktif değil.");
  const tid = B4M.app.tidOf(dmc), svs = c.services.filter(x => x != "f"), aid = db().seq(), sid = db().seq();
  db().add("accounts", { id: aid, name, email, code: "", owner: dmc, buyer: sid, dmk: Object.fromEntries(svs.map(k => [k, +mk || 0])), tid });
  P.activeAll("a", aid, name, { p: "s", id: dmc }, c.curs, svs, c.end, "DMC tarafından onaylandı");
  db().add("dmcs", { id: sid, name, code: "", email, parent: dmc, tid, mgn: { h: 10, t: 15, u: 20, f: 5 }, ch: { h: { hq: true, own: true }, t: { hq: true, own: true }, u: { hq: true, own: true } } });
  P.activeAll("s", sid, name, { p: "s", id: dmc }, c.curs, ["h", "t", "f", "u"], c.end, "");
  B4M.auth.addUserRaw({ org: "s", oid: sid, name: name + " Yöneticisi", email, role: "admin", perms: [], unit: "", tid });
  B4M.events.emit("dmc.subagency.created", sid, 0, "TRY", dmc);
  return ok("{n} alt hesabınız olarak açıldı; DMC paneline kendi kullanıcısıyla girip sizin ürünlerinizi satar.", { n: name });
};
P.togOwnAg = id => { const k = P.subK("a", id); if (!k) return no("Sözleşme yok."); k.susp = !k.susp; return ok(k.susp ? "Acentenin satışı kapatıldı." : "Acente yeniden açıldı."); };
/* DMC'nin platform alıcı hesabı (satış ekranı bu hesapla çalışır); yoksa otomatik açılır */
P.buyerOf = dmc => {
  const c = P.activeC("s", dmc); if (!c) return null;
  let b = db().find("accounts", a => a.buyer == dmc); const s = P.get("s", dmc);
  if (!b) { b = db().add("accounts", { name: s.name, email: s.email || "", code: "", buyer: dmc, tid: B4M.app.tidOf(dmc) }); B4M.events.emit("dmc.buyer.created", b.id, 0, "TRY", dmc); }
  if (!P.activeC("a", b.id)) { const k = P.activeAll("a", b.id, b.name, null, U.uniq([...(c.curs || []), ...P.rules().a.curs]), ["h", "t", "f", "u"], c.end, ""); k.sigM = { name: "Platform Yetkilisi", at: k.sigM.at }; }
  return b;
};
