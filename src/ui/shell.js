/* Kabuk: başlık (marka), dil seçimi, giriş ekranı, panel yönlendirmesi, üst katmanlar. */
const SH = B4M.shell = {}, A = B4M.ui.A, UI = B4M.ui, S = UI.S, db = () => B4M.db;
SH.header = () => {
  const x = B4M.uiBrand.current(), u = B4M.app.user(), c = B4M.ctx, host = x ? B4M.brand.addresses(x.d).filter(a => a.ok).map(a => a.host)[0] || B4M.brand.host(x.d) : "www.bed4book.com";
  return B4M.uiBrand.logo(x) + `<div class="end"><span class="mu url">${U.esc(host)}</span><label class="lngw"><span class="mu" style="font-size:12px">${t("Dil")}</span><select id="lng" aria-label="${t("Dil")}" ${UI.c("lang")}>${UI.opt(I.LANGS, I.lang, false)}</select></label>${c.uid ? `<span class="mu" style="align-self:center">${U.esc(u.name)}</span><button class="g" ${UI.a("logout")}>${t("Çıkış yap")}</button>` : ""}</div>`;
};
A.lang = (a, el) => { I.set(el.value); try { localStorage.setItem("b4m-lang", I.lang); } catch (e) { } };
A.logout = () => { B4M.auth.logout(); Object.assign(S, { tab: "", sub: "", bk: null, imp: null, dv: null, rv: null, md: null, dlg: null, q: null, f: {} }); };
SH.main = () => {
  const c = B4M.ctx; if (!c.uid) return SH.login();
  const ann = c.org == "s" ? B4M.lic.annFor(c.dmc, c.uid).map(a => `<div class="box ann" role="note"><div style="display:flex;justify-content:space-between;gap:8px"><b>${U.esc(a.title)}</b><button class="g" ${UI.a("annSeen", a.id)}>${t("Kapat")}</button></div><div class="mu">${U.esc(a.body)}</div></div>`).join("") : "";
  const sup = c.support ? `<div class="box warn" role="status" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span>${t("Destek modu: {n} ekranındasınız. Her işlem kayıt altına alınır.", { n: U.esc(B4M.parties.dmcName(c.dmc)) })}</span><button class="b" ${UI.a("supExit")}>${t("Destek modundan çık")}</button></div>` : "";
  return sup + ann + (c.org == "h" ? B4M.vHQ.render() : B4M.vDMC.render());
};
A.annSeen = id => B4M.lic.annSeen(id, B4M.ctx.uid) && undefined;
A.supExit = () => { const r = B4M.lic.supportExit(); S.tab = "lic"; return r; };
/* ---- giriş ---- */
SH.login = () => {
  const slug = B4M.uiBrand.slug(), x = B4M.uiBrand.current(), lic = x && B4M.lic.of(x.d.id), closed = lic && lic.status != "Aktif";
  if (slug && !x && slug != "backoffice") return UI.box(t("Adres bulunamadı"), `<p class="mu">${t("Bu adreste kayıtlı bir firma yok.")}</p><a href="#">www.bed4book.com</a>`);
  if (closed) return UI.box(t("Bu adres şu anda kapalı"), `<p class="mu" style="margin:0">${t("Firmanın lisansı askıya alındı. Lütfen firmanızla iletişime geçin.")}</p>`);
  const demo = db().where("users", u => u.active && (!x || (u.org == "s" && B4M.app.tidOf(u.oid) == x.d.id))).sort((a, b) => (a.org == "h" ? 0 : 1) - (b.org == "h" ? 0 : 1) || a.oid - b.oid || (a.role == "admin" ? 0 : 1) - (b.role == "admin" ? 0 : 1));
  const grp = {}; demo.forEach(u => { const k = u.org == "h" ? t("Back Office") : B4M.parties.dmcName(u.oid); (grp[k] = grp[k] || []).push(u); });
  return `<p class="sub">${x ? t("{n} satış ve yönetim paneli", { n: U.esc(x.b.title) }) : t("Otel, transfer, uçak ve tur; DMC panelleri ve Back Office tek çatı altında.")}</p>
  <div class="box" style="max-width:520px"><h2>${x ? t("Firma girişi") : t("Giriş")}</h2>
  <div class="row"><label>${t("E-posta")}<input id="lg_e" type="email" autocomplete="username" data-enter="login"></label></div>
  <div class="row"><label>${t("Şifre")}<input id="lg_p" type="password" autocomplete="current-password" data-enter="login"></label></div>
  <div class="row" style="margin:0"><button class="b" ${UI.a("login")}>${t("Giriş yap")}</button>${x ? `<a class="mu" href="#" style="align-self:center">${t("Platform girişi")}</a>` : `<span class="mu" style="align-self:center">${t("Firmalar kendi adreslerinden de girebilir, ör. {h}", { h: "akdeniz.bed4book.com" })} <a href="#akdeniz">#akdeniz</a></span>`}</div></div>
  <details class="box" style="max-width:720px" open><summary><b>${t("Test girişi")}</b> <span class="mu">${t("Demo hesaplarının şifresi: {p}", { p: "bed4book" })}</span></summary>
  <div class="row" style="margin-top:10px"><label>${t("Kullanıcı")}<select id="lg_d">${Object.entries(grp).map(([g, L]) => `<optgroup label="${U.esc(g)}">${L.map(u => `<option value="${u.id}">${U.esc(u.name)} · ${U.esc(t(B4M.auth.roleTxt(u)))}${u.mgr ? " · " + t("kısım müdürü") : ""} · ${U.esc(u.email || "")}</option>`).join("")}</optgroup>`).join("")}</select></label><button class="b" ${UI.a("demoLogin")}>${t("Giriş yap")}</button></div>
  <p class="mu" style="margin:0">${t("Canlı sistemde her kullanıcı kendi şifresiyle girer. Yönetici tüm bölümlere erişir; diğer kullanıcılar yöneticinin verdiği yetkilerle çalışır.")}</p></details>`;
};
const afterLogin = r => { if (r.ok) { S.tab = ""; S.sub = ""; const u = r.u, b = u.org == "s" ? B4M.brand.of(u.oid) : null; if (b && b.lang && !localStorage_lang()) I.set(b.lang); UI.top(); } return r; };
const localStorage_lang = () => { try { return localStorage.getItem("b4m-lang"); } catch (e) { return null; } };
A.login = () => afterLogin(B4M.auth.login(UI.val("lg_e"), UI.val("lg_p"), B4M.uiBrand.slug()));
A.demoLogin = () => { const u = db().get("users", +UI.val("lg_d")); if (!u) return B4M.res.no("Aktif kullanıcı yok."); return afterLogin(B4M.auth.start(u)); };
/* ---- üst katmanlar ---- */
SH.overlays = () => [S.rv && B4M.vBook.detail(), S.md && B4M.vBook.modify(), S.vw && B4M.vCommon.docViewer(), S.dv && B4M.vAcc.docView(), S.copyText && `<div class="ovl" role="dialog"><div class="box dlg"><h2>${t("Kopyalayın")}</h2><textarea rows="10" readonly>${U.esc(S.copyText)}</textarea><div class="row" style="justify-content:flex-end;margin:8px 0 0"><button class="g" ${UI.a("copyClose")}>${t("Kapat")}</button></div></div></div>`].filter(Boolean).join("");
A.copyClose = () => { S.copyText = null; };
A.ovClose = k => { S[k] = null; };
