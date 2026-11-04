/* Yama 2a · tek arama kutusu (üst bantta): rezervasyon/sipariş, otel ve hizmet, firma, sözleşme. Mevcut hızlı arama (VC.gsFind) kullanılır,
   sonuçlar türe göre gruplanır (her grupta en fazla 5), rezervasyonlar tek rezervasyon ekranında açılır. Klavye: "/" kutuya gider, oklar ve Enter. */
const UI = B4M.ui, A = UI.A, S = UI.S, VC = B4M.vCommon, VL = B4M.vLay, AU = B4M.auth, P = B4M.parties, BK = B4M.book, db = () => B4M.db;
const HS = B4M.vSearch = {};
HS.ORD = ["Rezervasyon", "Alt DMC rezervasyonu", "Satın alma", "Otel", "Hizmet", "DMC", "DMC (alt hesap)", "Satış hesabı", "Acente", "Alt DMC", "Sözleşme"];
HS.find = q => {
  const sc = B4M.ctx.org == "h" ? "h" : "s", R = VC.gsFind(sc, q).slice(), add = (tt, l, s, go) => R.push({ t: tt, l, s, go });
  if (U.norm(q).trim().length >= 2) {
    if (sc == "h") { if (AU.can("e")) [["transfers", "t"], ["tours", "u"]].forEach(([c]) => db().where(c, x => U.mt(q, [x.name, x.from, x.to, x.city].filter(Boolean).join(" "))).forEach(x => add("Hizmet", x.name || `${x.from} → ${x.to}`, P.dmcName(x.sup), { tab: "e" }))); }
    else { const dmc = B4M.ctx.dmc;
      if (AU.can("oa")) db().where("accounts", a => a.owner == dmc && U.mt(q, [a.name, a.email].join(" "))).forEach(a => add("Acente", a.name, a.email || "", { tab: "oa" }));
      if (AU.can("k")) { const c = P.activeC("s", dmc); if (c && U.mt(q, c.no)) add("Sözleşme", c.no, t(P.kSt(c)), { tab: "k" }); }
      [["transfers", "t"], ["tours", "u"]].forEach(([c, k]) => { if (AU.can(k)) db().where(c, x => x.sup == dmc && U.mt(q, [x.name, x.from, x.to, x.city].filter(Boolean).join(" "))).forEach(x => add("Hizmet", x.name || `${x.from} → ${x.to}`, "", { tab: k })); }); } }
  /* rezervasyon sonuçları tek rezervasyon ekranına gider */
  R.forEach(r => { const g = r.go; if (g.rv) { const id = g.rv.k == "b" ? g.rv.id : ((db().get("orders", g.rv.id) || {}).items || [])[0]; if (id) r.go = { bx: id }; } });
  const by = {}; R.forEach(r => { (by[r.t] = by[r.t] || []).push(r); });
  return Object.keys(by).sort((a, b) => (HS.ORD.indexOf(a) + 99) % 99 - (HS.ORD.indexOf(b) + 99) % 99).flatMap(k => by[k].slice(0, 5));
};
VL.search = () => { const q = S.hsq || "", L = S.hsr || [];
  let list = ""; if (L.length) { let last = ""; list = `<div id="hs_r" class="lsug" role="listbox">${L.map((r, i) => { const h = r.t != last ? `<div class="mu hsg">${U.esc(t(r.t))}</div>` : ""; last = r.t; return h + `<button type="button" role="option" ${UI.a("hsGo", i)}><b>${U.esc(r.l)}</b> <span class="mu">${U.esc(r.s || "")}</span></button>`; }).join("")}</div>`; }
  else if (q.trim().length >= 2) list = `<div id="hs_r" class="lsug"><div class="mu" style="padding:8px 10px">${t("Sonuç yok")}</div></div>`;
  return `<label style="position:relative"><span class="hsl">${t("Ara")}</span><input id="hs_q" type="search" autocomplete="off" value="${U.esc(q)}" placeholder="${U.esc(t(B4M.ctx.org == "h" ? "Ara: rezervasyon no, misafir, voucher, otel, firma, sözleşme ( / )" : "Ara: rezervasyon no, misafir, voucher, otel, acente ( / )"))}" aria-label="${t("Ara")}" ${UI.i("hsQ")} data-sug="hs_r">${list}</label>`; };
A.hsQ = (a, el) => { S.hsq = el.value; S.hsr = HS.find(el.value); };
A.hsGo = i => { const r = (S.hsr || [])[i]; if (!r) return false; const g = r.go; S.hsq = ""; S.hsr = [];
  if (g.bx) { if (B4M.vRez) return B4M.vRez.open(g.bx); S.rv = { k: "b", id: g.bx }; return; }
  const f = B4M.ctx.org == "h" ? A.hTab : A.dTab; if (g.tab) f(g.tab); if (g.hc) S.hc = g.hc; if (g.hk) S.hk = g.hk; if (g.fq) S.fq[g.fq[0]] = g.fq[1]; if (g.hs) S.hs = g.hs; if (g.sbx) S.sbx = g.sbx; S.bx = 0; UI.top(); };
/* klavye */
if (typeof document != "undefined") document.addEventListener("keydown", ev => {
  const ae = document.activeElement, inField = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
  if (ev.key == "/" && !inField && !ev.ctrlKey && !ev.metaKey) { const e = document.getElementById("hs_q"); if (e) { ev.preventDefault(); e.focus(); } return; }
  if (ev.key != "ArrowDown" && ev.key != "ArrowUp") return; const box = document.getElementById("hs_r"); if (!box || !(ae && (ae.id == "hs_q" || box.contains(ae)))) return;
  const bs = [...box.querySelectorAll("button")]; if (!bs.length) return; ev.preventDefault(); const i = bs.indexOf(ae); const n = ev.key == "ArrowDown" ? (i < 0 ? 0 : Math.min(bs.length - 1, i + 1)) : (i <= 0 ? -1 : i - 1); (n < 0 ? document.getElementById("hs_q") : bs[n]).focus();
});
if (typeof document != "undefined") { const st = document.createElement("style"); st.textContent = `.hsg{padding:6px 10px 2px;font-size:11px;text-transform:uppercase;letter-spacing:.04em}#hs_r{max-height:70vh}`; (document.head || document.documentElement).appendChild(st); }
