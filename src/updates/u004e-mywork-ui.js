/* Yama 2a · "Benim işlerim" (girişte kullanıcıya kendi bekleyenleri), hatırlanan filtreler (arama kutuları, rapor filtreleri, dashboard dönemi),
   dashboard'da oluşturma / seyahat tarihi seçimi. */
const UI = B4M.ui, A = UI.A, S = UI.S, db = () => B4M.db, AU = B4M.auth, BK = B4M.book, NT = B4M.notif, PF = B4M.pref, VD = B4M.vDash, RP = B4M.rep, VL = B4M.vLay, X = B4M.bkx, P = B4M.parties;
const MW = B4M.myWork = {};
const can = k => AU.can(k);
/* her satır: [metin, sayı, eylem, argüman] */
MW.items = () => { const u = B4M.app.user(), c = B4M.ctx, h = c.org == "h", L = [], soon = U.addD(U.today(), 2), add = (l, n, a, p, x) => { if (n) L.push([l, n, a, p, x]); };
  const mine = db().where("bookings", b => b.owner && b.owner.uid == u.id && b.status == "Onaylı"); add("Üstlendiğim rezervasyonlar", mine.length, "bxOpen", (mine[0] || {}).id, mine.map(b => b.no).slice(0, 4).join(", "));
  if (h) {
    if (can("acc")) { add("Onay bekleyen havale / EFT", db().where("orders", o => o.pay && o.pay.state == "Onay bekliyor").length + db().where("topups", x => x.state == "Onay bekliyor").length, "nv", ["acc", { acT: "pay" }]); }
    if (can("sal") || u.role == "admin") add("Onay bekleyen maaş talepleri", db().where("salReq", x => x.tid == "P" && x.st == "Bekliyor").length, "nv", ["acc", { acT: "fsal" }]);
    if (can("ag")) add("Agent onay kuyruğu", B4M.agents.pending("P").length, "hTab", "ag");
    if (can("res") || can("acc")) { const due = db().where("orders", o => !o.auto && BK.oDue(o) > 0 && o.due && o.due <= soon); add("48 saat içinde son ödemesi dolan siparişler", due.length, "hTab", "res", due.map(o => o.no).slice(0, 4).join(", ")); }
    if (can("res")) { const cx = db().where("bookings", b => b.status == "Onaylı" && b.sdl && b.sdl >= U.today() && b.sdl <= soon); add("48 saat içinde tedarikçi ücretsiz iptali dolanlar", cx.length, "bxOpen", (cx[0] || {}).id, cx.map(b => b.no).slice(0, 4).join(", ")); }
  } else { const dmc = c.dmc, tid = B4M.app.tidOf(dmc);
    if (can("r")) add("Onay bekleyen değişiklik talepleri", db().where("modreq", x => x.sup == dmc && x.state == "Bekliyor").length, "dTab", "r");
    if (can("sal") || u.role == "admin") add("Onay bekleyen maaş talepleri", db().where("salReq", x => x.tid == tid && x.st == "Bekliyor" && (!B4M.salFlow || B4M.salFlow.mineToApprove(x, u))).length, "dTab", "msl");
    if (can("ag") && !P.isSub("s", dmc)) add("Agent onay kuyruğu", B4M.agents.pending(tid).length, "dTab", "ag");
    const buyer = db().find("accounts", a => a.buyer == dmc && !a.owner);
    if (buyer && can("by")) { const due = db().where("orders", o => o.ag == buyer.id && !o.auto && BK.oDue(o) > 0 && o.due <= soon); add("48 saat içinde son ödemeniz dolan satın almalar", due.length, "dTab", "by", due.map(o => o.no).slice(0, 4).join(", "));
      const cx = db().where("bookings", b => b.ag == buyer.id && b.status == "Onaylı" && b.dl && b.dl >= U.today() && b.dl <= soon); add("48 saat içinde ücretsiz iptali dolan satın almalar", cx.length, "bxOpen", (cx[0] || {}).id, cx.map(b => b.no).slice(0, 4).join(", ")); }
    if (can("r")) { const cx = db().where("bookings", b => b.sup == dmc && b.status == "Onaylı" && b.a >= U.today() && b.a <= soon); add("48 saat içinde girişi olan rezervasyonlar", cx.length, "dTab", "r", cx.map(b => b.no).slice(0, 4).join(", ")); }
  }
  add("Okunmamış bildirimler", NT.unread().length, "ntfOpen");
  return L; };
MW.box = () => { const L = MW.items(); if (!L.length) return "";
  return UI.box(t("Benim işlerim"), `<div class="mw">${L.map(([l, n, a, p, x]) => `<button class="g" ${UI.a(a, p)}><b>${n}</b> ${t(l)}${x ? `<span class="mu">${U.esc(x)}</span>` : ""}</button>`).join("")}</div>`, ' id="mywork"'); };
/* açılış ekranının en üstünde (dashboard yetkisi olanlarda Dashboard) */
const wrapRender = (V, firstKey) => { const base = V.body; V.body = k => { const h = base(k); return k == firstKey() ? MW.box() + h : h; }; };
wrapRender(B4M.vHQ, () => B4M.vNav.first);
wrapRender(B4M.vDMC, () => B4M.vNav.first);
const baseStart = AU.start; AU.start = u => { const r = baseStart(u); if (r && r.ok) MW.restore(u); return r; };
/* ---- dashboard: tarih türü ---- */
const basePer = VD.period; VD.period = () => basePer() + `<label class="rl" style="margin-inline-start:8px">${t("Tarih türü")} <select ${UI.c("dbB")} aria-label="${t("Tarih türü")}" style="width:auto">${UI.opt([["c", "Oluşturma tarihine göre"], ["t", "Seyahat tarihine göre"]], S.dbB || "c")}</select></label>`;
A.dbB = (a, el) => { S.dbB = el.value; S.dbDr = ""; };
["hq", "dmc"].forEach(k => { const f = VD[k]; VD[k] = (...a) => { RP.basis = S.dbB == "t" ? "t" : ""; try { return f(...a); } finally { RP.basis = ""; } }; });
/* ---- hatırlanan filtreler ---- */
MW.KEYS = ["fq", "rsf", "dbp", "dbB", "srk"];
MW.snap = () => JSON.stringify(MW.KEYS.map(k => S[k] ?? null));
MW.restore = u => { const m = PF.get(u.id, "flt", null); if (!m) return; MW.KEYS.forEach(k => { if (m[k] != null) S[k] = typeof m[k] == "object" ? JSON.parse(JSON.stringify(m[k])) : m[k]; }); MW.last = MW.snap(); };
const baseRun = UI.run; UI.run = (...a) => { const r = baseRun(...a); try { const c = B4M.ctx; if (c.uid && B4M.db) { const s = MW.snap(); if (s != MW.last) { MW.last = s; const o = {}; MW.KEYS.forEach(k => { if (S[k] != null) o[k] = S[k]; }); PF.set(c.uid, "flt", o); B4M.db.commit(); } } } catch (e) { } return r; };
const baseLogout = A.logout; A.logout = () => { const r = baseLogout(); S.fq = {}; S.rsf = { q: "", ch: "", sv: "", px: "", a: "", b: "", st: "act", o: "new" }; S.dbp = "30"; S.dbB = "c"; S.srk = ""; S.bx = 0; S.bq = 0; MW.last = MW.snap(); return r; };
if (typeof document != "undefined") { const st = document.createElement("style"); st.textContent = `.mw{display:flex;flex-wrap:wrap;gap:8px}.mw button{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:start;padding:8px 12px;max-width:320px}.mw b{font-size:18px}.mwz{margin:0 0 10px}`; (document.head || document.documentElement).appendChild(st); }
