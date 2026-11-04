/* Müşteriler ve lisanslar, marka (white-label), alan adları, duyurular, destek modu. */
const LIC = B4M.lic = {}, BR = B4M.brand = {};
const db = () => B4M.db, { ok, no } = B4M.res;
/* paketler: hangi modül hangi pakette (açık soru — Back Office'ten değiştirilebilir) */
LIC.MODS = [["product", "Product"], ["sales", "Arama ve satış"], ["booking", "Rezervasyon"], ["acc", "Muhasebe"], ["ops", "Operasyon ve rehber"], ["dash", "Dashboard ve raporlar"], ["sub", "Alt DMC ve acenteler"], ["int", "Entegrasyon merkezi"], ["agent", "Agent merkezi"], ["domain", "Kendi alan adı"], ["apiout", "API Out"]];
LIC.DEF_PKG = { "Başlangıç": ["product", "sales", "booking", "acc"], "Profesyonel": ["product", "sales", "booking", "acc", "ops", "dash", "sub", "int"], "Kurumsal": LIC.MODS.map(m => m[0]) };
LIC.pkgs = () => db().cfg("packages") || db().cfg("packages", U.clone(LIC.DEF_PKG));
LIC.of = tid => db().find("licenses", l => l.tid == tid);
LIC.create = (dmc, pkg) => db().add("licenses", { tid: dmc, dmc, pkg, status: "Aktif", from: U.today(), to: U.addD(U.today(), 365), log: [{ at: U.now(), txt: `Lisans açıldı · ${pkg}` }] });
LIC.has = (tid, mod) => { if (tid == "P" || !tid) return true; const l = LIC.of(tid); if (!l) return true; return (LIC.pkgs()[l.pkg] || []).includes(mod); };
LIC.setPkg = (tid, pkg) => { const l = LIC.of(tid); if (!l) return no("Lisans bulunamadı."); l.pkg = pkg; l.log.push({ at: U.now(), txt: `Paket: ${pkg}` }); B4M.events.emit("license.package", tid, 0, "TRY", tid); return ok("Paket güncellendi: {p}", { p: t(pkg) }); };
LIC.toggle = (tid, reason) => {
  const l = LIC.of(tid); if (!l) return no("Lisans bulunamadı.");
  l.status = l.status == "Aktif" ? "Askıda" : "Aktif"; l.log.push({ at: U.now(), txt: l.status == "Askıda" ? `Askıya alındı${reason ? ": " + reason : ""}` : "Yeniden açıldı" });
  B4M.events.emit(l.status == "Askıda" ? "license.suspended" : "license.activated", tid, 0, "TRY", tid);
  return ok(l.status == "Askıda" ? "Lisans askıya alındı; DMC'nin tüm adresleri aynı anda kapandı." : "Lisans yeniden açıldı; adresler ve panel kullanıma açıldı.");
};
LIC.setEnd = (tid, to) => { const l = LIC.of(tid); if (!to) return no("Geçerli bir tarih gir."); l.to = to; l.log.push({ at: U.now(), txt: `Bitiş: ${to}` }); return ok("Lisans süresi güncellendi."); };
LIC.togMod = (pkg, mod) => { const P = LIC.pkgs(), L = P[pkg] || []; P[pkg] = L.includes(mod) ? L.filter(x => x != mod) : [...L, mod]; db().cfg("packages", P); return ok("Paket içeriği güncellendi."); };
LIC.usage = tid => {
  const B = db().where("bookings", b => b.sellerT == tid || b.buyerT == tid), U2 = db().where("users", u => u.tid == tid);
  const gmv = B.filter(b => b.status == "Onaylı").reduce((s, b) => s + B4M.price.cv(b.total, b.cur, "EUR"), 0);
  const last = db().where("audit", a => a.tid == tid && a.action == "auth.login").map(a => a.at).sort().pop() || "";
  return { users: U2.length, active: U2.filter(u => u.active).length, bookings: B.length, gmv: U.r2(gmv), hotels: db().where("hotels", h => h.tid == tid).length, last };
};
/* ---- marka ---- */
BR.DEF = { ac: "#0B2A5B", gd: "#B8862B" };
BR.of = dmc => { const d = dmc && db().get("dmcs", B4M.app.tidOf(dmc)); if (!d) return null; d.brand = d.brand || { title: d.name, logo: "", icon: "", ac: BR.DEF.ac, gd: BR.DEF.gd, sender: "", lang: "tr", cur: "EUR", domain: null, support: false }; return d.brand; };
BR.host = d => `${d.slug || "firma"}.book4me-ai.com`;
BR.addresses = d => { const b = BR.of(d.id), L = [{ host: BR.host(d), kind: "Standart adres", ok: true }]; if (b && b.domain) L.push({ host: b.domain.name, kind: "Kendi alan adı", ok: b.domain.status == "Doğrulandı" }); const lic = LIC.of(d.id); if (lic && lic.status != "Aktif") L.forEach(x => x.ok = false); return L; };
BR.sender = d => { if (!d) return "noreply@book4me-ai.com"; const b = BR.of(d.id); if (b && b.domain && b.domain.status == "Doğrulandı" && b.domain.mail && b.sender) return b.sender; return `noreply@book4me-ai.com (${(b && b.title) || d.name})`; };
const HEX = /^#[0-9a-f]{6}$/i;
BR.save = (dmc, o) => {
  const b = BR.of(dmc); if (!b) return no("Firma bulunamadı.");
  if (o.ac && !HEX.test(o.ac) || o.gd && !HEX.test(o.gd)) return no("Renkler #RRGGBB biçiminde olmalı.");
  if (o.sender && !U.isMail(o.sender)) return no("Gönderen e-posta adresi geçerli değil.");
  Object.assign(b, { title: (o.title || "").trim() || b.title, ac: o.ac || b.ac, gd: o.gd || b.gd, sender: (o.sender || "").trim(), lang: o.lang || b.lang, cur: o.cur || b.cur, icon: (o.icon || "").slice(0, 2) });
  if (o.logo !== undefined) b.logo = o.logo;
  B4M.events.emit("brand.updated", dmc, 0, "TRY", dmc); return ok("Marka ayarları kaydedildi; tüm ekranlara yansıdı.");
};
BR.setDomain = (dmc, name) => {
  const b = BR.of(dmc); name = String(name || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(name)) return no("Geçerli bir alan adı girin (ör. www.firmaniz.com).");
  if (!LIC.has(B4M.app.tidOf(dmc), "domain")) return no("Kendi alan adı paketinizde yok.");
  if (db().find("dmcs", d => d.brand && d.brand.domain && d.brand.domain.name == name && d.id != B4M.app.tidOf(dmc))) return no("Bu alan adı başka bir firmada kayıtlı.");
  b.domain = { name, status: "Kayıt bekleniyor", ssl: "", mail: false, dns: false, at: U.now() }; B4M.events.emit("domain.added", name, 0, "TRY", dmc);
  return ok("Alan adı eklendi. Alan adınıza tek bir yönlendirme kaydı ekleyin; kayıt görülünce güvenlik sertifikası otomatik kurulur.");
};
/* çevrimdışı modelde DNS kontrolü simüle edilir: dns=true ise kayıt "görülür" */
BR.simDns = (dmc, on) => { const b = BR.of(dmc); if (!b.domain) return no("Önce alan adı ekleyin."); b.domain.dns = !!on; return BR.check(dmc); };
BR.check = dmc => {
  const b = BR.of(dmc), d = b.domain; if (!d) return no("Önce alan adı ekleyin.");
  if (d.dns) { d.status = "Doğrulandı"; d.ssl = d.ssl || `Otomatik sertifika · ${U.today()}`; d.mail = true; }
  else { d.status = d.status == "Doğrulandı" ? "Kayıt bulunamadı" : "Kayıt bekleniyor"; d.mail = false; }
  B4M.events.emit("domain.checked", d.name + ":" + d.status, 0, "TRY", dmc);
  return d.status == "Doğrulandı" ? ok("Kayıt doğrulandı; {h} adresi ve güvenlik sertifikası hazır.", { h: d.name }) : ok("Yönlendirme kaydı bulunamadı; adres kapalı. Standart adresiniz çalışmaya devam ediyor.");
};
BR.delDomain = dmc => { const b = BR.of(dmc); b.domain = null; return ok("Alan adı kaldırıldı; standart adresiniz çalışmaya devam ediyor."); };
BR.togSupport = dmc => { const b = BR.of(dmc); b.support = !b.support; B4M.audit.log(b.support ? "support.allowed" : "support.revoked", dmc, ""); return ok(b.support ? "Back Office destek erişimine izin verildi; her giriş kayıt altına alınır." : "Destek erişimi kapatıldı."); };
/* ---- destek modu: Back Office yalnızca DMC izin verdiyse girer ---- */
LIC.supportEnter = dmc => {
  const b = BR.of(dmc); if (!b || !b.support) return no("Bu DMC destek erişimine izin vermedi.");
  const c = B4M.ctx, me = B4M.app.user(), adm = db().find("users", u => u.org == "s" && u.oid == dmc && u.role == "admin" && u.active); if (!adm) return no("DMC'de aktif yönetici yok.");
  db().add("supportLog", { tid: dmc, at: U.now(), by: me.name, uid: me.id, act: "giriş" });
  B4M.audit.log("support.enter", dmc, me.name, dmc);
  const from = { uid: c.uid }; Object.assign(c, { org: "s", uid: adm.id, dmc, acct: 0, support: { by: me.name, from } });
  return ok("Destek modu: {n} ekranı açıldı. Tüm işlemleriniz kayıt altında.", { n: P_name(dmc) });
};
const P_name = id => B4M.parties.dmcName(id);
LIC.supportExit = () => { const c = B4M.ctx; if (!c.support) return no("Destek modunda değilsiniz."); const by = c.support.by, from = c.support.from; db().add("supportLog", { tid: c.dmc, at: U.now(), by, act: "çıkış" }); B4M.audit.log("support.exit", c.dmc, by); Object.assign(c, { org: "h", uid: from.uid, dmc: 0, acct: 0, support: null }); return ok("Destek modundan çıkıldı."); };
/* ---- duyurular ---- */
LIC.announce = (title, body, to) => { if (!title) return no("Başlık girin."); db().add("announcements", { title, body: body || "", to: to || "all", at: U.now(), active: true, seen: [] }); return ok("Duyuru yayınlandı."); };
LIC.annFor = (dmc, uid) => db().where("announcements", a => a.active && (a.to == "all" || a.to == B4M.app.tidOf(dmc)) && !(a.seen || []).includes(uid));
LIC.annSeen = (id, uid) => { const a = db().get("announcements", id); (a.seen = a.seen || []).push(uid); return ok(""); };
LIC.annTog = id => { const a = db().get("announcements", id); a.active = !a.active; return ok(a.active ? "Duyuru yayında." : "Duyuru kaldırıldı."); };
