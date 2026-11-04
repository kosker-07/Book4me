/* Ortak ekran parçaları: takvim, konum seçici, hızlı arama, kullanıcılar, sözleşme ve belgeler, alt hesaplar, işlem kaydı. */
const VC = B4M.vCommon = {}, A = B4M.ui.A, UI = B4M.ui, S = UI.S, db = () => B4M.db, P = B4M.parties, AU = B4M.auth, BK = B4M.book, PD = B4M.prod;
S.sug = {}; S.loc = {}; S.fq = {};
/* kayıtlı açıklama metinlerini seçilen dile çevirir */
VC.desc = s => { s = String(s || ""); if (I.lang == "tr") return U.esc(s); return U.esc(s.replace(/\(oda (\d+)\)/g, (m, n) => `(${t("oda")} ${n})`).replace(/ · gidiş-dönüş/g, " · " + t("gidiş-dönüş")).replace(/ · iade edilemez/g, " · " + t("iade edilemez")).replace(/^Tur: /, t("Tur") + ": ").replace(/^Uçuş /, t("Uçuş") + " ").replace(/^Transfer /, t("Transfer") + " ").replace(/\(tüm il\)/g, t("(tüm il)"))); };
VC.cx = (d, x) => { const c = PD.cxInfo(d, x); return c.k == "nr" ? t("İade edilemez") : c.k == "late" ? t("Ücretsiz iptal süresi geçti") : t("{d} tarihine kadar ücretsiz iptal", { d: I.fd(c.d) }); };
VC.lt = (l) => I.tp(l.t, l.tp);
/* e-posta konusu: "<metin> <belge no> – <hizmet>" → dil dosyasından */
VC.subj = s => { s = String(s || ""); if (I.lang == "tr") return U.esc(s); const m = s.match(/^(.*?)\s+((?:B4M|RH|K-|FTR|KMF|KOM)[\w-]*)(.*)$/); if (!m) return U.esc(t(s)); return U.esc(t(m[1]) + " " + m[2]) + VC.desc(m[3]); };
/* ---- filtre kutusu ---- */
VC.fIn = (ctx, ph, box = true) => { const x = `<label style="margin:6px 0 4px">${t("Ara")}<input id="fq_${ctx}" type="search" value="${U.esc(S.fq[ctx] || "")}" placeholder="${U.esc(t(ph))}" ${UI.i("fq", ctx)}></label>`; return box ? `<div class="box" style="padding:8px 14px">${x}</div>` : x; };
A.fq = (ctx, el) => { S.fq[ctx] = el.value; };
/* ---- takvim ---- */
VC.cal = (key, mode) => {
  const q = S.cq || (S.cq = { cm: U.today().slice(0, 7), pk: false }), Q = S[key];
  const mo = k => { const [y, n] = k.split("-").map(Number), lead = (new Date(Date.UTC(y, n - 1, 1)).getUTCDay() + 6) % 7, dn = new Date(Date.UTC(y, n, 0)).getUTCDate(); let c = I.WD.map(x => `<b>${t(x)}</b>`).join("") + "<span></span>".repeat(lead);
    for (let i = 1; i <= dn; i++) { const d = `${k}-${U.pad(i, 2)}`, s = mode == "s" ? d == Q.d : d == Q.a || d == Q.b, r = mode == "r" && Q.a && Q.b && d > Q.a && d < Q.b; c += `<button class="${s ? "sel" : r ? "in" : ""}" ${d < U.today() ? "disabled" : ""} ${UI.a("calPick", [key, mode, d])} aria-label="${I.fd(d)}">${i}</button>`; }
    return `<div class="mo"><div style="font-weight:600;margin-bottom:6px;text-align:center">${t(I.MONTHS[n - 1])} ${y}</div><div class="cg">${c}</div></div>`; };
  return `<div class="box" style="background:var(--bg)"><div class="row" style="justify-content:space-between;margin-bottom:6px"><button class="g" ${UI.a("calMove", -1)} ${q.cm <= U.today().slice(0, 7) ? "disabled" : ""}>‹ ${t("Önceki")}</button><span class="mu">${mode == "s" ? t("Günü seç") : q.pk ? t("Şimdi çıkış tarihini seç") : t("Giriş tarihini seç")}</span><button class="g" ${UI.a("calMove", 1)}>${t("Sonraki")} ›</button></div><div class="cal">${mo(q.cm)}${mo(U.ymAdd(q.cm, 1))}</div></div>`;
};
A.calMove = n => { S.cq.cm = U.ymAdd(S.cq.cm, n); };
A.calPick = ([key, m, d]) => { const Q = S[key], q = S.cq; if (m == "s") { Q.d = d; Q.cal = false; } else if (!q.pk || d <= Q.a) { Q.a = d; Q.b = ""; q.pk = true; } else { Q.b = d; q.pk = false; Q.cal = false; } };
/* ---- konum seçici ---- */
VC.loc = (id, label, types, val) => { const L = S.sug[id] || []; return `<label style="position:relative">${label}<input id="lp_${id}" autocomplete="off" value="${U.esc(S.loc[id] ? VC.locLbl(S.loc[id]) : val || "")}" placeholder="${t("Yazmaya başlayın: il, ilçe, bölge")}${types.includes("havalimanı") ? " " + t("veya havalimanı") : ""}" ${UI.i("locSug", [id, types])} data-sug="ls_${id}">${L.length ? `<div id="ls_${id}" class="lsug" role="listbox">${L.map(x => `<button type="button" role="option" ${UI.a("locSet", [id, PD.locIdx().indexOf(x)])}><b>${U.esc(x.t == "il" ? x.il + " (" + t("tüm il") + ")" : x.z)}</b> <span class="mu">${x.t == "il" ? "" : U.esc(x.il) + " · "}${U.esc(x.cn)} · ${t(x.t)}</span></button>`).join("")}</div>` : ""}</label>`; };
VC.locLbl = x => x.t == "il" ? `${x.il} (${t("tüm il")})` : `${x.z} · ${x.il}`;
A.locSug = ([id, types], el) => { S.loc[id] = null; S.sug[id] = PD.locFind(el.value, types); S["lv_" + id] = el.value; };
A.locSet = ([id, i]) => { S.loc[id] = PD.locIdx()[i]; S.sug[id] = []; };
/* ---- hızlı arama ---- */
VC.gsBox = sc => { const L = S.sug["gs_" + sc] || []; return `<div class="box" style="padding:10px 14px"><label style="position:relative">${t("Hızlı arama")}<input id="gs_${sc}" type="search" autocomplete="off" value="${U.esc(S["gq_" + sc] || "")}" placeholder="${U.esc(t(sc == "h" ? "Firma, sözleşme no, rezervasyon no, misafir, otel, fatura veya voucher no" : "Rezervasyon no, misafir adı, otel, voucher veya alt DMC"))}" ${UI.i("gsSug", sc)} data-sug="gr_${sc}">${L.length ? `<div id="gr_${sc}" class="lsug" role="listbox">${L.map((r, i) => `<button type="button" role="option" ${UI.a("gsGo", [sc, i])}><span class="mu" style="display:inline-block;min-width:120px">${U.esc(t(r.t))}</span> <b>${U.esc(r.l)}</b> <span class="mu">${U.esc(r.s)}</span></button>`).join("")}</div>` : (S["gq_" + sc] || "").length >= 2 ? `<div class="lsug" id="gr_${sc}"><div class="mu" style="padding:8px 10px">${t("Sonuç yok")}</div></div>` : ""}</label></div>`; };
VC.gsFind = (sc, q) => {
  if (U.norm(q).trim().length < 2) return []; const R = [], add = (tt, l, s, go) => R.length < 20 && R.push({ t: tt, l, s, go }), u = B4M.app.user();
  if (sc == "h") {
    if (AU.can("s")) P.list("s").filter(x => U.mt(q, [x.name, x.email].join(" "))).forEach(x => add(x.parent ? "DMC (alt hesap)" : "DMC", x.name, [x.email, P.subK("s", x.id) ? t(P.kSt(P.subK("s", x.id))) : t("sözleşme yok")].filter(Boolean).join(" · "), { tab: "s", hc: { p: "s", id: x.id } }));
    if (AU.can("a")) P.list("a").filter(x => U.mt(q, [x.name, x.email].join(" "))).forEach(x => add("Satış hesabı", x.name, x.email || "", { tab: "a", hc: { p: "a", id: x.id } }));
    if (AU.can("k")) db().where("contracts", c => U.mt(q, [c.no, P.name(c.p, c.pid)].join(" "))).forEach(c => add("Sözleşme", c.no, P.name(c.p, c.pid) + " · " + t(P.kSt(c)), { tab: "k", hk: c.id }));
    if (AU.can("res")) db().where("orders", o => BK.oMatch(o, q)).reverse().forEach(o => add("Rezervasyon", o.no, `${P.accName(o.ag)} · ${o.label} · ${t(BK.oSt(o))}`, { rv: { k: "o", id: o.id } }));
    if (AU.can("e")) db().where("hotels", h => U.mt(q, [h.name, h.city, h.zone].join(" "))).forEach(h => add("Otel", h.name, `${h.zone}, ${h.city} · ${P.dmcName(h.sup)}`, { tab: "e", fq: ["he", h.name] }));
  } else {
    const dmc = B4M.ctx.dmc, subs = u.role == "admin" ? P.list("s").filter(x => x.parent == dmc) : [], ids = [dmc, ...subs.map(x => x.id)];
    if (AU.can("r")) db().where("bookings", b => ids.includes(b.sup) && BK.bMatch(b, q)).reverse().forEach(b => add(b.sup == dmc ? "Rezervasyon" : "Alt DMC rezervasyonu", b.no, `${b.desc} · ${P.accName(b.ag)} · ${t(b.status)}`, { rv: { k: "b", id: b.id } }));
    const bu = db().find("accounts", a => a.buyer == dmc); if (bu && AU.can("by")) db().where("orders", o => o.ag == bu.id && BK.oMatch(o, q)).reverse().forEach(o => add("Satın alma", o.no, `${o.label} · ${t(BK.oSt(o))}`, { rv: { k: "o", id: o.id } }));
    if (AU.can("h")) PD.myH(dmc).filter(h => U.mt(q, [h.name, h.city, h.zone].join(" "))).forEach(h => add("Otel", h.name, `${h.zone}, ${h.city}`, { tab: "h", hs: h.id }));
    subs.filter(x => U.mt(q, [x.name, x.email].join(" "))).forEach(x => add("Alt DMC", x.name, P.subK("s", x.id) ? t(P.kSt(P.subK("s", x.id))) : "", { tab: "ss", sbx: x.id }));
  }
  return R;
};
A.gsSug = (sc, el) => { S["gq_" + sc] = el.value; S.sug["gs_" + sc] = VC.gsFind(sc, el.value); };
A.gsGo = ([sc, i]) => { const r = (S.sug["gs_" + sc] || [])[i]; if (!r) return false; const g = r.go; if (g.tab) { S.tab = g.tab; S.sub = ""; } if (g.hc) S.hc = g.hc; if (g.hk) S.hk = g.hk; if (g.rv) S.rv = g.rv; if (g.fq) S.fq[g.fq[0]] = g.fq[1]; if (g.hs) S.hs = g.hs; if (g.sbx) S.sbx = g.sbx; S.sug["gs_" + sc] = []; S["gq_" + sc] = ""; UI.top(); };
/* ---- hizmet türü çipleri ---- */
VC.tyChips = (cur, cnt, a) => { const ks = ["h", "u", "t", "f"].filter(k => cnt[k]), tot = ks.reduce((s, k) => s + cnt[k], 0); if (!ks.length) return ""; return `<div role="group" aria-label="${t("Hizmet türü")}" style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 10px">${[["", "Tümü", tot], ...ks.map(k => [k, U.SVN[k], cnt[k]])].map(([k, l, n]) => `<button class="${cur == k ? "b" : "g"}" aria-pressed="${cur == k}" ${UI.a(a, k)}>${t(l)} <span style="opacity:.75">(${n})</span></button>`).join("")}</div>`; };
/* ---- kullanıcılar ---- */
VC.users = (org, oid) => {
  const me = B4M.app.user(); if (me.role != "admin") return UI.box("", t("Bu bölümü yalnızca yönetici görebilir."));
  const L = AU.orgUsers(org, oid), PM = AU.PERMS[org].filter(([k]) => !(k == "ss" && P.isSub(org, oid))), D = AU.DEPTS[org], nu = S.nu || (S.nu = { d: "Operasyon" }), T = AU.TPL[org][nu.d] || [];
  return UI.box(t("Kullanıcı yetkilendirme"), `<p class="mu" style="margin-top:0">${t("Yönetici her bölüme erişir ve kullanıcıları yönetir. Diğer kullanıcılar yalnızca yöneticinin verdiği bölümleri görür ve kullanır. Kısım müdürü işaretli kullanıcı dashboard'da yalnızca kendi kısmının verilerini görür; tamamı için “Dashboard · tam erişim” yetkisini verin. Departman seçince önerilen yetkiler işaretlenir.")}</p>
  <div class="row">${UI.fld(t("Ad soyad"), UI.in("nu_n", ""))}${UI.fld(t("E-posta"), UI.in("nu_e", "", "", "email"))}${UI.fld(t("Departman"), UI.sel("nu_d", D, nu.d, UI.c("nuDept")), 190)}${UI.chk(t("Kısım müdürü"), 'id="nu_mgr"')}${org != "h" ? UI.fld(t("Birim / şube"), UI.in("nu_u", "", `placeholder="${t("Ör. Kadıköy şubesi")}"`)) : ""}</div>
  <p class="mu" style="margin:0 0 4px">${t("Yetkiler")}</p><div class="row" style="gap:2px 16px">${PM.map(([k, l]) => UI.chk(t(l), `id="nu_p_${k}"`, T.includes(k))).join("")}</div>${UI.btn(t("Kullanıcıyı aç"), "addUser", [org, oid], "b")}`) +
  UI.box(t("Kullanıcılar"), VC.fIn("us" + org, "Kullanıcı adı, e-posta veya departman ara", false) + UI.tbl([t("Kullanıcı"), t("Departman"), t("Yetkiler"), t("Durum"), ""], L.filter(u => U.mt(S.fq["us" + org], [u.name, u.email, u.dept, u.unit].join(" "))).map(u => `<tr><td>${U.esc(u.name)}<div class="mu">${U.esc(u.email || "")}${u.unit ? " · " + U.esc(u.unit) : ""}</div></td><td>${u.role == "admin" ? `<b>${t("Yönetici")}</b>` : `<select aria-label="${U.esc(u.name)} ${t("departmanı")}" style="min-width:130px" ${UI.c("setDept", u.id)}>${UI.opt(D, u.dept || "Diğer")}</select>${UI.chk(t("Kısım müdürü"), UI.c("togMgr", u.id), u.mgr)}`}</td><td class="wrap" style="min-width:260px">${u.role == "admin" ? `<span class="mu">${t("Tüm bölümler ve kullanıcı yönetimi")}</span>` : PM.map(([k, l]) => `<label class="rl" style="display:inline-flex;margin-inline-end:12px;padding:2px 0"><input type="checkbox" ${u.perms.includes(k) ? "checked" : ""} ${UI.c("togPerm", [u.id, k])}>${t(l)}</label>`).join("")}</td><td>${UI.st(u.active ? "Aktif" : "Pasif", u.active)}</td><td>${u.id == me.id ? `<span class="mu">${t("siz")}</span>` : `${UI.btn(t(u.active ? "Pasifleştir" : "Aktifleştir"), "togUser", u.id)} ${UI.btn(t(u.role == "admin" ? "Yöneticilikten al" : "Yönetici yap"), "setRole", u.id)} ${UI.btn(t("Şifre sıfırla"), "resetPw", u.id)}`}</td></tr>`)));
};
A.nuDept = (a, el) => { S.nu.d = el.value; };
A.addUser = ([org, oid]) => { const PM = AU.PERMS[org].map(x => x[0]).filter(k => UI.val("nu_p_" + k)); const r = AU.addUser(org, oid, { name: UI.val("nu_n").trim(), email: UI.val("nu_e").trim(), dept: UI.val("nu_d"), perms: PM, mgr: UI.val("nu_mgr"), unit: org != "h" ? UI.val("nu_u").trim() : "" }); return r; };
A.setDept = (uid, el) => AU.setDept(uid, el.value);
A.togMgr = uid => AU.togMgr(uid);
A.togPerm = ([uid, k]) => AU.togPerm(uid, k);
A.togUser = uid => AU.togUser(uid);
A.setRole = uid => AU.setRole(uid);
A.resetPw = uid => AU.resetPw(uid);
/* hesabım: şifre değiştir */
VC.account = () => UI.box(t("Şifre değiştir"), `<div class="row">${UI.fld(t("Mevcut şifre"), UI.in("pw_o", "", 'autocomplete="current-password"', "password"))}${UI.fld(t("Yeni şifre"), UI.in("pw_n", "", 'autocomplete="new-password"', "password"))}${UI.btn(t("Kaydet"), "chPw", null, "b")}</div>`);
A.chPw = () => AU.changePw(UI.val("pw_o"), UI.val("pw_n"));
/* ---- sözleşme ve belgeler ---- */
VC.kCls = c => P.kSt(c) == "Aktif" ? "ok" : "bad";
VC.steps = c => { const d = c.docs || {}, li = (l, v, bad) => `<li>${l}: ${v ? `<span class="${bad ? "bad" : "ok"}">${bad ? "" : "✓ "}${v}</span>` : `<span class="bad">${t("bekliyor")}</span>`}</li>`;
  return `<ol class="log" style="color:var(--tx);font-size:14px">${li(c.by ? t("{n} imzası (üst firma)", { n: U.esc(P.name(c.by.p, c.by.id)) }) : t("Platform imzası"), c.sigM && `${U.esc(c.sigM.name)} · ${I.fd(c.sigM.at)}`)}${li(t("{r} imzası", { r: t(P.PN[c.p]) }), c.sigP && `${U.esc(c.sigP.name)} · ${I.fd(c.sigP.at)}`)}${P.DOCS.map(([k, tt]) => li(t(tt), d[k] && (d[k].st == "Onaylandı" ? `${t("onaylandı")} · ${I.fd(d[k].at)}` : d[k].st == "Reddedildi" ? `${t("reddedildi")}${d[k].note ? ": " + U.esc(d[k].note) : ""}` : t("yüklendi, admin onayı bekliyor")), d[k] && d[k].st != "Onaylandı")).join("")}${li(c.by ? t("Üst firma onayı ve panel açılışı") : t("Admin onayı ve panel açılışı"), c.ver && `${t("kod")} ${c.ver.code} · ${I.fd(c.ver.at)}`)}</ol>`; };
VC.docPrev = (d, h = 220) => !d || !d.data ? `<div class="mu" style="height:${h}px;display:flex;align-items:center;justify-content:center;text-align:center;border:1px dashed var(--ln);border-radius:6px;padding:12px">${d ? t("Önizleme yok (dosya 2 MB'tan büyük)") : t("Henüz yüklenmedi")}</div>` : /pdf/.test(d.type) ? `<div class="mu" style="height:${h}px;display:flex;align-items:center;justify-content:center;border:1px solid var(--ln);border-radius:6px">PDF · ${U.esc(d.name)}</div>` : `<img src="${U.esc(d.data)}" alt="${U.esc(d.name)}" style="display:block;width:100%;height:${h}px;object-fit:contain;background:var(--bg);border:1px solid var(--ln);border-radius:6px">`;
VC.docCard = (c, k, tt, mode) => { const d = (c.docs || {})[k], st = d ? (d.st == "Bekliyor" ? "Onay bekliyor" : d.st) : "Yüklenmedi"; let act = "";
  if (mode == "p" && (!d || d.st != "Onaylandı")) act = `<label style="margin-top:8px">${t(d ? "Yeniden yükle" : "Dosya seç")} (${t("PDF veya görsel")})<input type="file" accept=".pdf,image/*" ${UI.c("upDoc", [c.id, k])}></label>`;
  if (mode == "m" && d && d.st != "Onaylandı") act = `<div class="row" style="margin:8px 0 0">${UI.btn(t("Onayla"), "docOk", [c.id, k], "b")}</div><div class="row" style="margin:0">${UI.fld(t("Ret nedeni"), UI.in(`rj_${c.id}_${k}`, "", `placeholder="${t("Ör. belge okunmuyor")}"`))}${UI.btn(t("Reddet"), "docNo", [c.id, k])}</div>`;
  return `<div class="box" style="margin:0"><div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px"><b>${t(tt)}</b><span class="${st == "Onaylandı" ? "ok" : "bad"}" style="font-size:13px">${t(st)}</span></div>${VC.docPrev(d)}${d ? `<div class="mu" style="margin-top:6px;word-break:break-all">${U.esc(d.name)} · ${I.fd(d.at)}${d.note && d.st == "Reddedildi" ? ` · <span class="bad">${U.esc(d.note)}</span>` : ""}</div>${d.data ? UI.btn(t("Büyük görüntüle"), "vw", [c.id, k], "g", 'style="margin-top:6px"') : ""}` : ""}${act}</div>`; };
VC.docGrid = (c, mode) => `<div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">${P.DOCS.map(([k, tt]) => VC.docCard(c, k, tt, mode)).join("")}</div>`;
A.vw = ([id, k]) => { S.vw = [id, k]; };
VC.docViewer = () => { const [id, k] = S.vw, c = P.K(id), d = c && (c.docs || {})[k]; if (!d) return ""; return `<div class="ovl" role="dialog" aria-label="${t("Belge önizleme")}"><div class="box"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px"><b>${t(P.DOCS.find(x => x[0] == k)[1])} · ${U.esc(P.name(c.p, c.pid))}</b>${UI.btn(t("Kapat"), "ovClose", "vw")}</div>${VC.docPrev(d, 600)}</div></div>`; };
A.upDoc = async ([id, k], el) => { const f = el.files[0]; if (!f) return false; if (!/^image\/|pdf/.test(f.type)) return B4M.res.no("Yalnızca PDF veya görsel yükleyebilirsin."); let data = null, type = f.type; if (f.type.startsWith("image/")) { data = await UI.imgSmall(f); type = "image/jpeg"; } else if (f.size <= 2e6) data = await UI.readData(f); return P.putDoc(id, k, { name: f.name, type, data }); };
A.docOk = ([id, k]) => P.docOk(id, k);
A.docNo = ([id, k]) => P.docNo(id, k, UI.val(`rj_${id}_${k}`).trim());
VC.logK = c => (c.log || []).length ? `<div style="flex-basis:100%"><p class="mu" style="margin:8px 0 4px">${t("Onay sonrası platform güncellemeleri")}</p><ul class="log">${c.log.slice().reverse().map(l => `<li>${I.fd(l.at)} · ${U.esc(l.txt)}</li>`).join("")}</ul></div>` : "";
VC.kView = (c, mode) => { const canSign = !c.sigP && !c.susp;
  return UI.box(`${t("Sözleşme")} ${U.esc(c.no)} <span class="${VC.kCls(c)}" style="font-size:14px;font-weight:500">· ${t(P.kSt(c))}</span>`, VC.steps(c) + `<pre class="pre">${U.esc(P.termsText(c))}</pre>` + (canSign ? `${UI.chk(t("Sözleşme şartlarını okudum ve kabul ediyorum."), 'id="k_ok"')}<div class="row" style="margin-top:6px">${UI.fld(t("Yetkili ad soyad"), UI.in("k_sp", ""))}${UI.btn(t("Sözleşmeyi imzala"), "signP", c.id, "b")}</div>` : c.sigP ? `<p class="mu" style="margin:0">${t("Bu sözleşmeyi {n} {d} tarihinde imzaladı.", { n: U.esc(c.sigP.name), d: I.fd(c.sigP.at) })}</p>${VC.logK(c)}` : "")) +
  UI.box(t("İstenen belgeler"), `<p class="mu" style="margin-top:0">${mode == "p" ? t("Her belgeyi ayrı ayrı yükleyin; görsel veya PDF olabilir. Belgeler admin tarafından onaylandıktan sonra paneliniz açılır.") : t("Onaylanmış belgeleriniz.")}</p>${VC.docGrid(c, mode)}`); };
A.signP = id => P.signP(id, UI.val("k_sp").trim(), UI.val("k_ok"));
VC.lock = (p, id) => { const L = db().where("contracts", c => c.p == p && c.pid == id && P.kSt(c) != "Süresi doldu").sort((a, b) => b.id - a.id), msg = t("Panel; sözleşme iki tarafça imzalanıp istenen dört belge ayrı ayrı yüklendikten ve admin onayladıktan sonra açılır.");
  if (!B4M.parties.licOK(B4M.app.tidOf(id))) return UI.box(t("Lisansınız askıda"), `<p class="mu" style="margin:0">${t("Platform lisansınızı askıya aldı; tüm adresleriniz kapalı.")}</p>`);
  if (!L.length) return UI.box(t("Paneliniz henüz açık değil"), `<p class="mu" style="margin:0">${t("Size ait geçerli bir sözleşme yok.")} ${msg}</p>`);
  if (L[0].susp && L[0].ver) return UI.box(t("Hesabınız geçici olarak kapalı"), `<p class="mu" style="margin:0">${t("Platform hesabınızı kapattı. Yeniden açıldığında paneliniz aynı sözleşmeyle, yeniden imza veya belge istenmeden açılır.")}</p>`);
  return UI.box(t("Paneliniz henüz açık değil"), `<p class="mu" style="margin:0">${msg} ${t("Aşağıdan şartları okuyup imzalayabilir ve belgelerinizi yükleyebilirsiniz.")}</p>`) + VC.kView(L[0], "p"); };
/* ---- alt hesaplar (DMC → alt DMC) ---- */
VC.subs = pid => {
  if (!AU.can("ss")) return UI.box("", t("Bu bölümü yalnızca firma yöneticisi görebilir.")); const L = P.list("s").filter(x => x.parent == pid && (S.sbx || U.mt(S.fq.sb, [x.name, x.email].join(" "))));
  if (S.sbx) { const x = L.find(y => y.id == S.sbx); if (x) return VC.subDetail(pid, x); }
  return UI.box(t("Yeni alt DMC"), `<p class="mu" style="margin-top:0">${t("Alt DMC'leriniz kendi sözleşmesi ve kendi kullanıcılarıyla ayrı bir hesap olarak çalışır. Sözleşmeyi siz düzenler ve imzalarsınız; alt hesap şartları okuyup imzalar ve belgelerini yükler, siz onaylayınca paneli açılır. Kapsam, sizin sözleşmenizdeki hizmet ve para birimleriyle sınırlıdır.")}</p><div class="row">${UI.fld(t("Firma adı"), UI.in("sb_n", ""))}${UI.fld(t("Yetkili e-posta"), UI.in("sb_e", "", "", "email"))}${UI.btn(t("Alt hesap aç"), "addSub", pid, "b")}</div>`) + VC.fIn("sb", "Alt hesap adı veya e-posta ara") +
    UI.box(t("Alt DMC'lerim"), UI.tbl([t("Firma"), t("Sözleşme"), t("Kâr oranınız"), t("Envanter"), [t("Rezervasyon"), "num"], ""], L.map(x => { const k = P.subK("s", x.id); return `<tr><td>${U.esc(x.name)}<div class="mu">${U.esc(x.email || "")} · ${I.tn(AU.orgUsers("s", x.id).length, "kullanıcı")}</div></td><td class="${k && P.kSt(k) == "Aktif" ? "ok" : "bad"}">${k ? t(P.kSt(k)) : "—"}</td><td class="mu">${VC.ppTxt(x)}</td><td class="mu">${VC.inv(x.id)}</td><td class="num">${db().where("bookings", b => b.sup == x.id).length}</td><td>${UI.btn(t("Yönet"), "sbx", x.id)}</td></tr>`; }), t("Henüz alt hesap yok.")));
};
VC.ppTxt = x => U.SV.map(sv => `${t(U.SVN[sv])} %${(x.pp || {})[sv] || 0}`).join(" · ");
VC.inv = id => [["otel", "hotels"], ["transfer", "transfers"], ["tur", "tours"]].map(([n, c]) => I.tn(db().where(c, x => x.sup == id).length, n)).join(" · ");
A.sbx = id => { S.sbx = id; };
A.addSub = pid => { const r = P.addSub(pid, UI.val("sb_n").trim(), UI.val("sb_e").trim()); if (r.ok) S.sbx = r.id; return r; };
VC.subDetail = (pid, x) => { const c = P.subK("s", x.id), pc = P.activeC("s", pid) || { services: [], curs: [] }, both = c.sigM && c.sigP, res = db().where("bookings", b => b.sup == x.id).reverse().slice(0, 10), pp = x.pp || PR_Z();
  return `<div class="box" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${UI.btn("‹ " + t("Alt hesaplar"), "sbx", 0)}<b>${U.esc(x.name)}</b><span class="mu">${U.esc(x.email || "")}</span></div>` +
  UI.box(`${t("Sözleşme")} ${U.esc(c.no)} <span class="${VC.kCls(c)}" style="font-size:14px;font-weight:500">· ${t(P.kSt(c))}</span>`, VC.steps(c) + (!c.sigM ? UI.btn(t("Sözleşmeyi {n} adına imzala", { n: U.esc(P.dmcName(pid)) }), "signBy", c.id, "b") : "") + (!c.sigP ? `<p class="mu">${t("Alt hesap yöneticisi giriş yapıp şartları okuyarak imzalamalı ve dört belgeyi ayrı ayrı yüklemeli.")}</p>` : "") + (!c.ver ? (both && !P.docSt(c) ? `<div class="row" style="margin-top:12px">${UI.btn(t("Onayla ve paneli aç"), "verifyK", c.id, "b")}</div>` : "") : `<div class="row" style="margin-top:12px;align-items:center"><span class="ok" style="flex:1">${t("Onaylandı {d}. Sonraki değişiklikler yeniden imza istemez.", { d: I.fd(c.ver.at) })}</span>${UI.btn(t(c.susp ? "Hesabı aç" : "Hesabı kapat"), "suspK", c.id, c.susp ? "b" : "g")}${VC.logK(c)}</div>`)) +
  UI.box(t("Belgeler"), VC.docGrid(c, "m")) +
  UI.box(t("Profit"), `<p class="mu" style="margin-top:0">${t("Bu alt DMC'nin profitini siz belirler ve siz alırsınız: oran, alt DMC'nin fiyatına eklenir.")}</p><div class="row">${U.SV.map(sv => UI.fld(t(U.SVN[sv]) + " %", `<input type="number" min="0" step="0.5" value="${pp[sv] || 0}" ${UI.c("setPP", ["s", x.id, sv])}>`, 130)).join("")}</div>`) +
  UI.box(t("Kapsam"), `<p class="mu" style="margin-top:0">${t("Alt hesap yalnızca sizin sözleşmenizde olan hizmet ve para birimlerini kullanabilir.")}</p><div class="row" style="gap:2px 16px">${pc.services.map(s => UI.chk(t(U.SVN[s]), UI.c("subScope", [c.id, "services", s]), c.services.includes(s))).join("")}</div><div class="row" style="gap:2px 16px">${pc.curs.map(s => UI.chk(s, UI.c("subScope", [c.id, "curs", s]), c.curs.includes(s))).join("")}</div>`) +
  UI.box(t("Son rezervasyonlar"), res.length ? B4M.vBook.table(res, { sh: 1, sp: 1 }) : `<span class="mu">${t("Henüz rezervasyon yok.")}</span>`); };
const PR_Z = () => B4M.price.Z(0);
A.signBy = id => P.signBy(id, B4M.app.user().name);
A.verifyK = id => P.verifyK(id);
A.suspK = id => P.suspK(id);
A.setPP = ([p, id, sv], el) => B4M.price.setPP(p, id, sv, el.value);
A.subScope = ([id, k, v]) => P.subScope(id, k, v);
/* ---- işlem kaydı ---- */
VC.audit = tid => { const L = db().where("audit", a => tid == "P" || a.tid == tid).reverse().filter(a => U.mt(S.fq.au, [a.who, a.action, a.ref, a.detail].join(" "))), n = S.auN || 100;
  return VC.fIn("au", "Kişi, işlem veya kayıt ara") + UI.box(t("İşlem kaydı") + ` <span class="mu" style="font-size:14px;font-weight:400">${t("kim, neyi, ne zaman yaptı")}</span>`, UI.tbl([t("Zaman"), t("Kişi"), t("İşlem"), t("Kayıt"), t("Ayrıntı")], L.slice(0, n).map(a => `<tr><td>${I.fd(a.at)}</td><td>${U.esc(a.who)}${a.support ? `<div class="mu">${t("destek")}: ${U.esc(a.support)}</div>` : ""}</td><td><code>${U.esc(a.action)}</code></td><td>${U.esc(a.ref)}</td><td class="wrap mu">${U.esc(String(a.detail || "").slice(0, 160))}</td></tr>`)) + (L.length > n ? UI.btn(t("Daha fazla göster"), "auMore") : "")); };
A.auMore = () => { S.auN = (S.auN || 100) + 200; };
/* ---- giden e-postalar ---- */
VC.mails = L => L.length ? L.map(m => `<details class="room" style="display:block"><summary><b>${VC.subj(m.subj)}</b> <span class="mu">· ${U.esc(m.to || t("adres yok"))} · ${I.fd(m.at)}</span> <span class="${/Gönderildi/.test(m.state) ? "ok" : "bad"}">· ${t(m.state)}</span></summary><div class="mu" style="margin-top:6px">${t("Gönderen")}: ${U.esc(m.from || "")}</div><pre class="pre" style="max-height:240px">${U.esc(m.body)}</pre></details>`).join("") : `<span class="mu">${t("Henüz giden e-posta yok.")}</span>`;
