/* Kullanıcılar, departmanlar ve yetkiler. Her firmada bir yönetici vardır; diğer kullanıcılar yalnızca yöneticinin verdiği yetkileri kullanır. */
const AU = B4M.auth = {};
const db = () => B4M.db, { ok, no } = B4M.res;
AU.DEPTS = { h: ["DMC", "Muhasebe", "Operasyon", "Kontrat", "Satış", "Rehber", "Diğer"], s: ["Product", "Rezervasyon", "Operasyon", "Muhasebe", "Rehber", "Diğer"], a: ["Satış", "Muhasebe", "Diğer"] };
AU.PERMS = {
  h: [["dbf", "Dashboard · tam erişim"], ["res", "Rezervasyonlar"], ["lic", "Müşteriler ve lisanslar"], ["pr", "Platform markup"], ["s", "DMC'ler"], ["a", "Satış hesapları"], ["k", "Sözleşmeler"], ["e", "Envanter"], ["gs", "Rehber satışları"], ["r", "Kurallar"], ["acc", "Muhasebe"], ["int", "Entegrasyon merkezi"], ["ag", "Agent merkezi"], ["log", "İşlem kaydı"]],
  s: [["dbf", "Dashboard · tam erişim"], ["h", "Product · Otel yükleme"], ["ch", "Product · Satış kanalları"], ["r", "Rezervasyon · Rezervasyon arama, liste ve alış / satış raporu"], ["oa", "Rezervasyon · Acentelerim"], ["by", "Rezervasyon · Satış ekranı"], ["t", "Operasyon · Transfer fiyatları ve güzergahlar"], ["u", "Operasyon · Tur fiyatları"], ["f", "Operasyon · Uçak detayları (API)"], ["gp", "Operasyon · Rehber ürünleri"], ["g", "Operasyon · Satış düzenleme"], ["or", "Operasyon · Tur, transfer ve rehber satışlarını görme"], ["ga", "Operasyon · Satış onayı"], ["os", "Operasyon · Hizmet tedarikçileri ve rehberler"], ["gs", "Operasyon · Rehber satış ekranı"], ["m", "Operasyon · Gelen bildirimler"], ["acc", "Muhasebe"], ["k", "Yönetim · Sözleşme"], ["ss", "Yönetim · Alt DMC'ler"], ["br", "Yönetim · Marka ve alan adı"], ["int", "Yönetim · Entegrasyonlar"], ["ag", "Yönetim · Agentlar ve onay kuyruğu"], ["log", "Yönetim · İşlem kaydı"]],
  a: [["s", "Arama ve rezervasyon"], ["o", "Rezervasyonlar ve ödeme"], ["h", "Hesap ve bakiye"], ["k", "Sözleşme"]]
};
/* departman seçilince önerilen yetkiler */
AU.TPL = {
  h: { DMC: ["res", "s", "e", "lic"], Muhasebe: ["res", "acc", "int"], Operasyon: ["res", "e", "gs"], Kontrat: ["s", "a", "k", "e", "pr", "lic"], Satış: ["a", "res", "pr"], Rehber: ["gs"], Diğer: [] },
  s: { Product: ["h", "ch"], Rezervasyon: ["r", "oa", "by"], Operasyon: ["t", "u", "f", "gp", "g", "or", "os", "m"], Muhasebe: ["acc", "r"], Rehber: ["gs"], Diğer: ["r"] },
  a: { Satış: ["s", "o"], Muhasebe: ["o", "h"], Diğer: ["s"] }
};
AU.tempPw = () => { const c = "abcdefghjkmnpqrstuvwxyz23456789"; let s = ""; for (let i = 0; i < 8; i++) s += c[Math.floor(Math.random() * c.length)]; return s; };
AU.DEMO_PW = "bed4book";
AU.setPw = (u, pw) => { u.salt = U.hsh(u.id + "|" + (u.email || "") + "|" + Math.random()); u.pw = U.pwHash(pw, u.salt); };
AU.addUserRaw = o => { const u = db().add("users", { role: "user", dept: "", perms: [], unit: "", active: true, mgr: false, ...o, pw: undefined }); AU.setPw(u, o.pw || AU.DEMO_PW); return u; };
AU.can = (k, u) => { u = u || B4M.app.user(); return u.role == "admin" || (u.perms || []).includes(k); };
AU.roleTxt = u => u.role == "admin" ? "yönetici" : (u.dept || "kullanıcı");
/* giriş: e-posta + şifre. tenantSlug verilirse (white-label adres) yalnızca o DMC'nin kullanıcıları girebilir */
AU.login = (email, pw, tenantSlug) => {
  email = String(email || "").trim().toLowerCase();
  const L = db().where("users", u => (u.email || "").toLowerCase() == email && u.active);
  const ten = tenantSlug ? db().find("dmcs", d => d.slug == tenantSlug && !d.parent) : null;
  const u = L.find(u => u.pw == U.pwHash(pw, u.salt) && (!ten || (u.org == "s" && B4M.app.tidOf(u.oid) == ten.id)));
  if (!u) return no("E-posta veya şifre hatalı.");
  return AU.start(u);
};
AU.start = u => {
  const c = B4M.ctx; c.org = u.org; c.uid = u.id; c.dmc = u.org == "s" ? u.oid : 0; c.acct = u.org == "a" ? u.oid : 0; c.support = null;
  if (u.org == "s" && !P_licOK(u.oid)) { const x = { ok: false, msg: "Lisansınız askıya alındı; tüm adresleriniz kapalı. Platformla iletişime geçin." }; AU.logout(); return x; }
  B4M.audit.log("auth.login", u.id, u.name, u.org == "h" ? "P" : B4M.app.tidOf(u.oid));
  return ok("Hoş geldiniz, {n}.", { n: u.name }, { u });
};
const P_licOK = oid => B4M.parties.licOK(B4M.app.tidOf(oid));
AU.logout = () => { const c = B4M.ctx; if (c.uid) B4M.audit.log("auth.logout", c.uid, ""); Object.assign(c, { org: "", uid: 0, dmc: 0, acct: 0, support: null }); };
AU.changePw = (oldPw, nw) => { const u = B4M.app.user(); if (u.pw != U.pwHash(oldPw, u.salt)) return no("Mevcut şifre hatalı."); if (String(nw || "").length < 6) return no("Yeni şifre en az 6 karakter olmalı."); AU.setPw(u, nw); B4M.audit.log("user.password.changed", u.id, ""); return ok("Şifreniz değiştirildi."); };
/* ---- kullanıcı yönetimi (yalnızca yönetici) ---- */
AU.orgUsers = (org, oid) => db().where("users", u => u.org == org && u.oid == oid);
AU.addUser = (org, oid, o) => {
  if (!o.name) return no("Ad soyad gir."); if (o.email && !U.isMail(o.email)) return no("Geçerli bir e-posta gir."); if (!o.perms.length) return no("En az bir bölüm yetkisi seç.");
  if (o.email && db().find("users", u => (u.email || "").toLowerCase() == o.email.toLowerCase())) return no("Bu e-posta adresiyle bir kullanıcı zaten var.");
  const pw = AU.tempPw(), tid = org == "h" ? "P" : org == "s" ? B4M.app.tidOf(oid) : B4M.parties.tidFor("a", oid);
  const u = AU.addUserRaw({ org, oid, name: o.name, email: o.email, role: "user", dept: o.dept, perms: o.perms, mgr: !!o.mgr, unit: o.unit || "", tid, pw });
  B4M.mail.send({ dmc: org == "s" ? oid : 0, to: o.email || "", subj: "Kullanıcı daveti", body: `Merhaba ${o.name},\nbed4book hesabınız açıldı.\nGiriş: ${o.email}\nGeçici şifre: ${pw}\nİlk girişte şifrenizi değiştirin.`, tid });
  B4M.events.emit("user.created", u.id, 0);
  return ok("{n} ({d}) için kullanıcı açıldı. Geçici şifre: {pw}", { n: o.name, d: t(o.dept), pw }, { u });
};
AU.setDept = (uid, d) => { const u = db().get("users", uid); u.dept = d; u.perms = [...AU.TPL[u.org][d]]; B4M.events.emit("user.department.updated", uid, 0); return ok("{d} departmanı atandı; önerilen yetkiler uygulandı.", { d: t(d) }); };
AU.togPerm = (uid, k) => { const u = db().get("users", uid); u.perms = u.perms.includes(k) ? u.perms.filter(x => x != k) : [...u.perms, k]; B4M.events.emit("user.permission.updated", uid, 0); return ok("Yetki güncellendi."); };
AU.togUser = uid => { const u = db().get("users", uid); if (u.id == B4M.ctx.uid) return no("Kendi hesabınızı pasifleştiremezsiniz."); u.active = !u.active; B4M.events.emit(u.active ? "user.activated" : "user.deactivated", uid, 0); return ok(u.active ? "Kullanıcı aktif." : "Kullanıcı pasif; giriş yapamaz."); };
AU.setRole = uid => { const u = db().get("users", uid); if (u.id == B4M.ctx.uid) return no("Kendi rolünüzü değiştiremezsiniz."); u.role = u.role == "admin" ? "user" : "admin"; if (u.role == "user" && !u.perms.length) u.perms = [...AU.TPL[u.org][u.dept || "Diğer"]]; B4M.events.emit("user.role.updated", uid, 0); return ok(u.role == "admin" ? "Kullanıcı yönetici yapıldı." : "Yöneticilik kaldırıldı."); };
AU.togMgr = uid => { const u = db().get("users", uid); u.mgr = !u.mgr; B4M.events.emit("user.manager.updated", uid, 0); return ok(u.mgr ? "{n} kısım müdürü yapıldı; {d} kısmının dashboard'unu görür." : "{n} kısım müdürlüğünden alındı.", { n: u.name, d: t(u.dept || "kendi") }); };
AU.resetPw = uid => { const u = db().get("users", uid), pw = AU.tempPw(); AU.setPw(u, pw); B4M.mail.send({ dmc: u.org == "s" ? u.oid : 0, to: u.email || "", subj: "Şifre sıfırlama", body: `Geçici şifreniz: ${pw}`, tid: u.tid }); return ok("{n} için yeni geçici şifre: {pw}", { n: u.name, pw }); };
/* ---- e-posta (simülasyon): DMC'nin e-postaları kendi alan adından, kayıtlar eksikse platform adresinden gider ---- */
B4M.mail = {
  send(o) {
    const db = B4M.db, d = o.dmc ? db.get("dmcs", B4M.app.tidOf(o.dmc)) : null, from = B4M.brand ? B4M.brand.sender(d) : "noreply@bed4book.com";
    const okTo = U.isMail(o.to);
    return db.add("mail", { at: U.now(), dmc: o.dmc || 0, sup: o.sup || 0, gs: o.gs || 0, to: o.to || "", from, subj: o.subj, body: o.body, state: okTo ? "Gönderildi (simülasyon)" : "Beklemede: e-posta adresi tanımlı değil", tid: o.tid || (o.dmc ? B4M.app.tidOf(o.dmc) : "P") });
  }
};
