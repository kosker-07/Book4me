/* Yama 1 · arayüz: menüler, bildirim zili, v40'tan geri gelenler (A1, A3, A4, A5), .xls/.csv yükleme metni.
   Eski ekranların koduna dokunmaz; menülere yeni sekmeler ekler ve mevcut ekranların çıktısına kutu ekler. */
const UI = B4M.ui, A = UI.A, S = UI.S, db = () => B4M.db, AU = B4M.auth, P = B4M.parties, PR = B4M.price, NT = B4M.notif, VH = B4M.vHQ, VM = B4M.vDMC, VC = B4M.vCommon;
const VY = B4M.vY1 = { V: {} };
VY.can = (...k) => { const u = B4M.app.user(); return !!u.id && (u.role == "admin" || k.some(x => AU.can(x))); };
VY.tid = () => B4M.ctx.org == "h" ? "P" : B4M.app.tidOf(B4M.ctx.dmc);
VY.fE = v => I.fm(U.r2(v || 0), "EUR");
VY.sub = (L, cur, a) => UI.tabs(L.map(([k, l]) => [k, t(l)]), cur, a, 'class="tabs sm"');
VY.mSel = (id, a, m) => `<input id="${id}" type="month" value="${m}" ${UI.c(a)} aria-label="${t("Ay")}" style="max-width:180px">`;
VY.thisM = () => U.today().slice(0, 7);
/* ---- Back Office sekmeleri ---- */
const addTab = (k, l, after) => { if (VH.TABS.some(x => x[0] == k)) return; const i = VH.TABS.findIndex(x => x[0] == after); VH.TABS.splice(i < 0 ? VH.TABS.length - 2 : i + 1, 0, [k, l]); };
addTab("hk", "Otel kontratları", "e"); addTab("cm", "Commercial", "k"); addTab("fa", "Fiyat analizi", "hk"); addTab("rbo", "Rebooking", "fa");
VY.HTAB = { hk: () => VY.can("hk", "e"), cm: () => VY.can("cs", "mkt", "mkti", "kt", "legal"), fa: () => VY.can("fa"), rbo: () => VY.can("rb") };
const baseTabs = VH.tabs; VH.tabs = () => { const L = baseTabs(), keep = new Set(L.map(x => x[0])); return VH.TABS.filter(([k]) => keep.has(k) || (VY.HTAB[k] && VY.HTAB[k]())); };
const baseHB = VH.body; VH.body = k => VY.V["h_" + k] ? VY.V["h_" + k]() : baseHB(k);
/* ---- DMC menüsü: Transfer / Tur / Uçak tekrar Operasyon altında (v40 düzeni); yeni bölümler ---- */
(() => { const G = VM.GRP, g = n => G.find(x => x[0] == n), pr = g("Product"), op = g("Operasyon"), rz = g("Rezervasyon"), mh = g("Muhasebe");
  const mv = pr[1].filter(x => ["t", "u", "f"].includes(x[0])); pr[1] = pr[1].filter(x => !["t", "u", "f"].includes(x[0])); op[1] = [...mv, ...op[1].filter(x => !["t", "u", "f"].includes(x[0]))];
  const ins = (grp, items) => items.forEach(it => { if (!grp[1].some(x => x[0] == it[0])) grp[1].push(it); });
  ins(pr, [["hk", "Otel kontratları"], ["fa", "Fiyat analizi"], ["rbt", "Fiyat takibi"]]); ins(rz, [["rb", "Rebooking teklifleri"]]);
  ins(mh, [["mfr", "Finans raporu"], ["mx", "Giderler"], ["msl", "Maaşlar"], ["mbn", "Prim"], ["mtn", "Tanıtım faturaları"]]);
  Object.assign(VM.PK, { mfr: "fin", mx: "exp", msl: "sal", mbn: "bon", mtn: "mkt", hk: "hk", fa: "fa", rbt: "rbt", rb: "rb" }); })();
const baseMB = VM.body; VM.body = k => VY.V["s_" + k] ? VY.V["s_" + k]() : baseMB(k);
/* ---- Hesabım: prim ve maaş talebi ---- */
const baseAcc = VC.account; VC.account = () => baseAcc() + (VY.V.myBonus ? VY.V.myBonus() : "");
/* ---- bildirim zili ---- */
const baseHdr = B4M.shell.header; B4M.shell.header = () => { let h = baseHdr(); const c = B4M.ctx; if (!c.uid || !B4M.db) return h; const n = NT.unread().length;
  const bell = `<button class="g ntf" ${UI.a("ntfOpen")} aria-label="${t("Bildirimler")}${n ? " · " + n : ""}" title="${t("Bildirimler")}">🔔${n ? ` <b class="ntfn">${n}</b>` : ""}</button>`;
  return h.replace(`<button class="g" ${UI.a("logout")}>`, bell + `<button class="g" ${UI.a("logout")}>`); };
A.ntfOpen = () => { S.ntf = !S.ntf; };
A.ntfAll = () => NT.markAll();
A.ntfGo = id => { const n = db().get("notifs", id); if (!n) return; NT.markRead(id); S.ntf = false; const h = B4M.ctx.org == "h";
  const go = (tab, x) => { Object.assign(S, { tab, sub: "", hs: 0 }, x || {}); };
  switch (n.kind) {
    case "hotel": return h ? go("hk", { hkSel: n.ref }) : go("hk");
    case "fa": return go("fa", { faKey: (() => { const x = db().get("hotels", n.ref); return x ? B4M.fa.key(x) : ""; })() });
    case "dmc": return h ? go("lic", { licD: n.ref }) : null;
    case "acct": return go("a", { hc: { p: "a", id: n.ref } });
    case "k": return h ? go("k", { hk: n.ref }) : go("k");
    case "sal": return h ? go("acc", { acT: "fsal" }) : go("msl");
    case "salme": return go("pw");
    case "rbx": case "rbw": return go("r");
    case "rbpen": return h ? go("rbo", { rbT: "pen" }) : go("rb");
  } };
VY.ntfPanel = () => { if (!S.ntf || !B4M.ctx.uid) return ""; const L = NT.forUser().slice(0, 40), u = B4M.app.user();
  return `<div class="ovl" role="dialog" aria-label="${t("Bildirimler")}"><div class="box dlg" style="max-width:560px;width:100%"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2 style="margin:0">${t("Bildirimler")}</h2><span>${UI.btn(t("Tümünü okundu işaretle"), "ntfAll")} ${UI.btn(t("Kapat"), "ntfOpen")}</span></div>
  ${L.length ? `<ul class="log" style="max-height:60vh;overflow:auto">${L.map(n => `<li style="display:flex;justify-content:space-between;gap:8px;align-items:center${n.read.includes(u.id) ? "" : ";font-weight:600"}"><span>${U.esc(t(n.title, n.tp))}<div class="mu" style="font-weight:400">${I.fd(n.at)}</div></span>${UI.btn(t("Aç"), "ntfGo", n.id)}</li>`).join("")}</ul>` : `<p class="mu">${t("Bildirim yok.")}</p>`}</div></div>`; };
const baseOv = B4M.shell.overlays; B4M.shell.overlays = () => baseOv() + VY.ntfPanel() + (VY.V.overlays ? VY.V.overlays() : "");
/* ---- A3 + A5: Platform markup ekranı v40 düzeninde: "Kazancınız" sütunu ve Kâr özeti ---- */
const baseMk = VH.markup; VH.markup = () => { const live = db().where("bookings", b => b.mg && (b.status == "Onaylı" || b.status == "İptal (cezalı)")), sum = f => UI.sumC(U.byCur(live.map(f)));
  const kar = UI.box(t("Kâr özeti"), UI.cards([UI.card(t("Platform markup geliri"), sum(b => [b.mg.hq, b.cur]), t("tüm onaylı rezervasyonlar")), UI.card(t("Üst acentelerin alt acente kârı"), sum(b => [P.parentOf("a", b.ag) ? b.mg.pa : 0, b.cur]), t("alt hesap satışlarından")),
    UI.card(t("Üst tedarikçilerin alt tedarikçi kârı"), sum(b => [b.mg.ps, b.mg.psCur || b.costCur]), t("alt DMC ürünlerinden")), UI.card(t("Rebooking geliri"), VY.fE(db().all("rbRev").reduce((s, r) => s + r.e, 0)), t("alıcı fiyatı değişmeden"), "ok")]));
  return baseMk().split(t("Markup geliriniz")).join(t("Kazancınız")) + `<p class="mu" style="margin:-4px 0 12px">${t("Kazancınız; o firmanın ve alt hesaplarının rezervasyonlarından elde ettiğiniz platform markup geliridir.")}</p>` + kar; };
/* ---- A4: Muhasebe → DMC ödemeleri: "Üst tedarikçi kâr payı" ve rebooking ---- */
const VA = B4M.vAcc, BK = B4M.book, baseAH = VA.hq;
VY.FT = [["fr", "Finans raporu", "fin"], ["fx2", "Giderler", "exp"], ["fsal", "Maaşlar ve talepler", "sal"], ["fbon", "Prim", "bon"], ["fpro", "Tanıtım gelirleri", "mkt", "mkti"], ["fbud", "Bütçe", "fin"], ["fprm", "Parametreler", "admin"]];
VA.hq = () => { const st = S.acT || "o", my = VY.FT.filter(x => x[2] == "admin" ? B4M.app.user().role == "admin" : VY.can(...x.slice(2))); let h;
  if (my.some(x => x[0] == st)) { h = baseAH.call(null).replace(/^([\s\S]*?<\/nav>)[\s\S]*$/, "$1"); h += VY.V["f_" + st]("P"); }
  else if (st == "dp") { h = baseAH().replace(/^([\s\S]*?<\/nav>)[\s\S]*$/, "$1") + VY.dp(); }
  else h = baseAH();
  return h.replace("</nav>", my.map(([k, l]) => `<button class="${st == k ? "on" : ""}" ${UI.a("acT", k)}>${t(l)}</button>`).join("") + "</nav>"); };
VY.dp = () => { const sp = db().where("bookings", b => b.status == "Onaylı" && b.oid && !b.own).sort((a, b) => BK.supPay(a).localeCompare(BK.supPay(b))), fm = I.fm;
  return UI.box(t("DMC ödemeleri"), `<p class="mu" style="margin-top:0">${t("Kural: çıkış tarihinden itibaren iki hafta dolduktan sonraki ilk cuma, anlaşma para biriminde ödenir. İptal edilen rezervasyonlar listeye girmez.")}</p>` + UI.tbl([t("Ödeme günü"), t("DMC"), t("Rezervasyon"), t("Çıkış"), [t("Tutar"), "num"], t("Üst tedarikçi kâr payı"), [t("Platform markup"), "num"], [t("Rebooking"), "num"], ""],
    sp.map(b => `<tr><td>${I.fd(BK.supPay(b))}</td><td>${U.esc(P.dmcName(b.sup))}</td><td>${U.esc(b.no)} · ${VC.desc(b.desc)}</td><td>${I.fd(b.b || b.a)}</td><td class="num">${fm(b.cost ?? b.total, b.costCur || b.cur)}</td><td>${b.mg && b.mg.ps ? fm(b.mg.ps, b.mg.psCur) + " → " + U.esc(P.dmcName(P.parentOf("s", b.sup))) : "—"}</td><td class="num">${b.mg ? fm(b.mg.hq || 0, b.cur) : "—"}</td><td class="num ${b.mg && b.mg.rb ? "ok" : ""}">${b.mg && b.mg.rb ? VY.fE(b.mg.rb) : "—"}</td><td>${b.sp ? `<span class="ok">${t("Ödendi")} · ${I.fd(b.sp)}</span>` : UI.btn(t("Ödendi işaretle"), "supPaid", b.id)}</td></tr>`), t("Ödenecek DMC rezervasyonu yok."))); };
/* ---- A2: fiyat listesi yükleme .xls ve .csv kabul eder ---- */
const VP = B4M.vProd, baseUp = VP.ixUp; VP.ixUp = () => baseUp().replace('accept=".xlsx,.xlsm,', 'accept=".xlsx,.xlsm,.xls,.csv,').replace("</label>", `<div class="mu" style="margin-top:6px">${t("Desteklenen: .xlsx, .xls, .csv, PDF ve fotoğraf")}</div></label>`);
/* ---- stil ---- */
if (typeof document != "undefined") { const st = document.createElement("style"); st.textContent = `.ntf{position:relative}.ntfn{background:var(--bad,#c62828);color:#fff;border-radius:10px;padding:0 6px;font-size:12px;margin-inline-start:2px}.y1c{cursor:pointer}.y1c:hover{outline:2px solid var(--ln)}.agebar{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.agebar button{text-align:start;padding:10px;border:1px solid var(--ln);border-radius:8px;background:transparent}.agebar button.on{outline:2px solid var(--ac)}@media print{.noprint,#hdr,nav.tabs{display:none!important}}`; (document.head || document.documentElement).appendChild(st); }
