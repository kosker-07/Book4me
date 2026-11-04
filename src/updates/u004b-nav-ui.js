/* Yama 2a · menü sadeleştirme: Back Office 21 sekme → 7 başlık; DMC 6 grup, 41 alt sekme → 30. Ekranlar silinmez, yetkiler değişmez:
   bir başlık altındaki en az bir ekrana yetki varsa görünür. Aynı kayda bakan sekmeler tek girişte birleşir (üstte küçük sekme şeridi).
   Tek ekrana yetkisi olan kullanıcı menü görmez. Hesabım üst banttaki kullanıcı adına taşındı. */
const UI = B4M.ui, A = UI.A, S = UI.S, VH = B4M.vHQ, VM = B4M.vDMC, VL = B4M.vLay, PF = B4M.pref, AU = B4M.auth, P = B4M.parties, LIC = B4M.lic, db = () => B4M.db;
const NV = B4M.vNav = {};
/* [başlık, [[giriş, [[sekme, durum, alt ad], …]], …]] */
NV.H = [
  ["Dashboard", [["Dashboard", [["o"]]]]],
  ["Rezervasyonlar", [["Rezervasyonlar", [["res"]]], ["Rebooking", [["rbo"]]]]],
  ["Product / Otel Kontrat", [["Envanter", [["e"]]], ["Otel kontratları", [["hk"]]], ["Fiyat analizi", [["fa"]]]]],
  ["Commercial", [["Commercial", [["cm", { cmT: "cs" }, "Satış"], ["cm", { cmT: "mkt" }, "Pazarlama"], ["cm", { cmT: "kt" }, "Sözleşme takibi"], ["cm", { cmT: "legal" }, "Legal"]]], ["DMC'ler ve lisanslar", [["lic", null, "Müşteriler ve lisanslar"], ["s", null, "DMC'ler"]]], ["Satış hesapları", [["a"]]],
    ["Sözleşmeler", [["k"]]], ["Platform markup", [["pr"]]]]],
  ["Muhasebe", [["Genel", [["acc", { acT: "o" }]]], ["Ödemeler", [["acc", { acT: "pay" }, "Ödeme onayları"], ["acc", { acT: "dp" }, "DMC ödemeleri"], ["acc", { acT: "cm" }, "Komisyonlar"]]],
    ["Banka ve cari", [["acc", { acT: "bk" }, "Banka ve ekstre"], ["acc", { acT: "fx" }, "Kurlar"], ["acc", { acT: "l" }, "Cari hareketler"]]],
    ["Gider ve personel", [["acc", { acT: "fx2" }, "Giderler"], ["acc", { acT: "fsal" }, "Maaşlar ve talepler"], ["acc", { acT: "fbon" }, "Prim"]]],
    ["Raporlar", [["acc", { acT: "fr" }, "Finans raporu"], ["acc", { acT: "fbud" }, "Bütçe"], ["acc", { acT: "fpro" }, "Tanıtım gelirleri"]]]]],
  ["Operasyon", [["Rehber satışları", [["gs"]]]]],
  ["Yönetim", [["Kurallar", [["r"]]], ["Parametreler", [["acc", { acT: "fprm" }]]], ["Entegrasyon merkezi", [["int"]]], ["Agent merkezi", [["ag"]]], ["Platform markası", [["br"]]], ["Kullanıcılar", [["us"]]], ["İşlem kaydı", [["log"]]]]]];
NV.S = [
  ["Dashboard", [["Dashboard", [["db"]]]]],
  ["Product", [["Oteller", [["h"]]], ["Satış kanalları", [["ch"]]], ["Otel kontratları", [["hk"]]], ["Fiyat analizi", [["fa"]]], ["Fiyat takibi", [["rbt"]]]]],
  ["Rezervasyon", [["Rezervasyonlar ve profit", [["rs"]]], ["Rezervasyon işlemleri", [["r"]]], ["Acentelerim", [["oa"]]], ["Satış ekranı", [["by"]]], ["Rebooking teklifleri", [["rb"]]]]],
  ["Operasyon", [["Transfer ve güzergahlar", [["t"]]], ["Turlar", [["u"]]], ["Uçak (API)", [["f"]]],
    ["Rehber", [["gp", null, "Rehber ürünleri"], ["gd", null, "Rehberler"], ["gs", null, "Rehber satış ekranı"], ["g", null, "Rehber ve acente satışları"], ["orp", null, "Satış raporu"]]],
    ["Hizmet tedarikçileri", [["os"]]], ["Mesajlar", [["om", null, "Giden e-postalar"], ["m", null, "Gelen bildirimler"]]]]],
  ["Muhasebe", [["Finans özeti", [["ma", null, "Finans dashboard"], ["mfr", null, "Finans raporu"]]], ["Cariler", [["mp", null, "Platform alacakları"], ["mc", null, "Acente carileri"], ["mt", null, "Tedarikçi borçları"]]],
    ["Rehber kasası", [["mk"]]], ["API komisyonları", [["mcm"]]], ["Gider ve personel", [["mx", null, "Giderler"], ["msl", null, "Maaşlar"], ["mbn", null, "Prim"], ["mbd", null, "Bütçe"]]], ["Tanıtım faturaları", [["mtn"]]]]],
  ["Yönetim", [["Sözleşme", [["k"]]], ["Kullanıcılar", [["us"]]], ["Alt DMC'ler", [["ss"]]], ["Marka ve alan adı", [["br"]]], ["Entegrasyonlar", [["int"]]], ["Agentlar ve onay kuyruğu", [["ag"]]], ["İşlem kaydı", [["log"]]]]]];
/* ---- ortak ---- */
const DEF = () => ({ acT: S.acT || "o", cmT: S.cmT || NV.cmFirst() });
NV.cmFirst = () => { const V = (B4M.vY1 || {}).V || {}, L = (V.CMT || []).filter(x => B4M.vY1.can(...x.slice(2))); return (L[0] || [])[0] || "cs"; };
NV.cmOk = k => { const V = (B4M.vY1 || {}).V || {}, x = (V.CMT || []).find(y => y[0] == k); return !!x && B4M.vY1.can(...x.slice(2)); };
NV.accOk = k => { const FT = (B4M.vY1 || {}).FT || [], x = FT.find(y => y[0] == k); if (!x) return true; return x[2] == "admin" ? B4M.app.user().role == "admin" : B4M.vY1.can(...x.slice(2)); };
NV.match = (sb, cur) => sb[0] == S.tab && (!sb[1] || Object.entries(sb[1]).every(([k, v]) => cur[k] == v));
/* görünür ağaç: [[başlık, [[giriş, [alt…]]]]] */
NV.tree = (def, ok) => def.map(([g, L]) => [g, L.map(([l, subs]) => [l, subs.filter(sb => ok(sb))]).filter(x => x[1].length)]).filter(x => x[1].length);
NV.btn = (act, sb, label, on, x = "") => sb[1] ? `<button class="${on ? "on" : ""}" ${UI.a("nv", [sb[0], sb[1]])}${x}>${label}</button>` : `<button class="${on ? "on" : ""}" ${UI.a(act, sb[0])}${x}>${label}</button>`;
NV.build = (T, act, badge) => {
  const cur = DEF(); let curG = null, curL = null; T.forEach(([g, L]) => L.forEach(lf => { if (!curL && lf[1].some(sb => NV.match(sb, cur))) { curG = g; curL = lf; } }));
  if (!curL) { curG = T[0][0]; curL = T[0][1][0]; }
  const nLeaf = T.reduce((s, g) => s + g[1].length, 0), col = new Set(PF.get(B4M.ctx.uid, "navC", []));
  const lbl = lf => t(lf[0]) + (badge ? badge(lf) : "");
  const strip = curL[1].length > 1 ? `<nav class="tabs sm" aria-label="${U.esc(t(curL[0]))}">${curL[1].map(sb => NV.btn(act, sb, t(sb[2] || curL[0]), NV.match(sb, cur))).join("")}</nav>` : "";
  let side = "", top = "";
  if (nLeaf <= 1) top = strip;
  else if (T.length == 1) top = `<nav class="tabs">${T[0][1].map(lf => NV.btn(act, lf[1][0], lbl(lf), lf === curL)).join("")}</nav>` + strip;
  else { side = `<nav class="tabs sidenav" aria-label="${t("Menü")}">${T.map(([g, L]) => { const open = g == curG || !col.has(g); return `<button type="button" class="gh${g == curG ? " cur" : ""}" ${UI.a("navGrp", g)} aria-expanded="${open}">${t(g)}<span aria-hidden="true">${open ? "▾" : "▸"}</span></button>${open ? L.map(lf => NV.btn(act, lf[1][0], lbl(lf), lf === curL)).join("") : ""}`; }).join("")}</nav>`; top = strip; }
  return { side, top, title: curL[0], g: curG };
};
A.navGrp = g => { const u = B4M.ctx.uid, L = new Set(PF.get(u, "navC", [])); L.has(g) ? L.delete(g) : L.add(g); PF.set(u, "navC", [...L]); };
A.nv = ([tab, st]) => { const f = B4M.ctx.org == "h" ? A.hTab : A.dTab; f(tab); Object.assign(S, st || {}); };
/* bir ekranın kendi küçük sekme şeridi menüye taşındıysa ekrandan çıkarılır */
NV.strip = h => h.replace(/<nav class="tabs"[^>]*>[\s\S]*?<\/nav>/, "");
NV.head = (title, sub) => `<div class="ctxl"><h1>${U.esc(t(title))}</h1><span class="mu">${sub}</span></div>`;
/* ---- Back Office ---- */
VH.render = () => { const T0 = VH.tabs(), u = B4M.app.user(); if (!T0.some(x => x[0] == S.tab)) S.tab = T0[0][0]; const keys = new Set(T0.map(x => x[0])), pend = B4M.agents.pending("P").length;
  const ok = sb => keys.has(sb[0]) && (sb[0] != "cm" || NV.cmOk(sb[1].cmT)) && (sb[0] != "acc" || NV.accOk(sb[1].acT));
  NV.first = T0[0][0]; const T = NV.tree(NV.H, ok), nav = NV.build(T, "hTab", lf => lf[1][0][0] == "ag" && pend ? ` (${pend})` : "");
  let body = VH.body(S.tab); if (S.tab == "acc" || S.tab == "cm") body = NV.strip(body);
  const title = S.tab == "pw" ? "Hesabım" : nav.title;
  return VL.page(nav, VL.pre + NV.head(title, `${t("Back Office")} · ${U.esc(u.name)} · ${u.role == "admin" ? t("yönetici · tüm bölümler") : U.esc(t(u.dept || "kullanıcı"))}`) + body); };
/* ---- DMC ---- */
VM.render = () => {
  const me = B4M.app.user(), dmc = B4M.ctx.dmc, ac = P.activeC("s", dmc), d = db().get("dmcs", dmc), tid = B4M.app.tidOf(dmc);
  const sub = `${U.esc(me.name)} · ${me.role == "admin" ? t("firma yöneticisi") : U.esc(t(me.dept || "kullanıcı"))}${ac ? ` · ${t("sözleşme {no} · {d} tarihine kadar", { no: U.esc(ac.no), d: I.fd(ac.end) })}` : ""}${LIC.of(tid) ? ` · ${t("paket")}: ${t(LIC.of(tid).pkg)}` : ""}`;
  const firm = `${U.esc(d.name)}${P.isSub("s", dmc) ? ` · ${t("alt DMC")} · ${U.esc(P.dmcName(P.parentOf("s", dmc)))}` : ""}`;
  const hd = NV.head(d.name, sub);
  if (!ac) return VL.page({}, VL.pre + hd + (me.role == "admin" ? B4M.vCommon.lock("s", dmc) : UI.box(t("Panel henüz açık değil"), `<p class="mu" style="margin:0">${t("Firmanızın sözleşmesi henüz aktif değil veya hesap kapalı. Sözleşme ve belge işlemlerini firma yöneticiniz yürütür.")}</p>`)));
  const okK = k => (!["h", "t", "u", "f"].includes(k) || ac.services.includes(k)) && VM.can(k);
  const T = NV.tree(NV.S, sb => okK(sb[0])), all = T.flatMap(g => g[1].flatMap(l => l[1].map(sb => sb[0])));
  if (me.role != "admin" && AU.can("gs") && !all.some(k => !["gs", "pw"].includes(k))) return VL.page({}, VL.pre + hd + B4M.vOps.guideApp(true));
  if (!all.length && S.tab != "pw") return VL.page({}, VL.pre + hd + UI.box("", t("Hesabınıza henüz bir bölüm yetkisi verilmemiş. Firma yöneticinizle iletişime geçin.")));
  NV.first = all[0]; if (!all.includes(S.tab) && S.tab != "pw") S.tab = all[0];
  const nav = all.length ? NV.build(T, "dTab") : {}, title = S.tab == "pw" ? "Hesabım" : nav.title;
  return VL.page(nav, VL.pre + NV.head(title, `${firm} · ${sub}`) + VM.body(S.tab)); };
