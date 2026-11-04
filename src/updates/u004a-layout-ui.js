/* Yama 2a · tam ekran ve sol menü: sabit 1040 px sınırı kalkar; telefon (< 768 px) tek sütun + açılır çekmece, tablet/dizüstü solda menü,
   geniş ekran (> 1600 px) solda menü · ortada liste · sağda seçili kayıt. Üst bant tek satır: menü düğmesi, logo, arama, zil, tam ekran, kullanıcı.
   Eski ekranlar aynen çizilir; yalnızca yerleşim ve menü değişir. Menü yapısı u004b'dedir. */
const UI = B4M.ui, A = UI.A, S = UI.S, SH = B4M.shell, PF = B4M.pref;
const VL = B4M.vLay = {};
const me = () => B4M.ctx.uid;
VL.wide = () => typeof window != "undefined" && window.innerWidth >= 1600;
VL.phone = () => typeof window != "undefined" && window.innerWidth < 768;
VL.detail = () => "";      /* u004d doldurur: sağ panelde / tam sayfada kayıt ayrıntısı */
VL.ctxLine = () => "";     /* u004b doldurur: firma, kullanıcı, sözleşme satırı */
/* yerleşim: nav = { side: html | "", top: html | "" } */
VL.page = (nav, content) => {
  const det = VL.detail(), min = PF.get(me(), "navMin", false), cls = ["lay", nav.side ? "" : "nonav", nav.side && min ? "navmin" : "", S.navOpen ? "navopen" : "", det ? "hasdet" : ""].filter(Boolean).join(" ");
  return `<div class="${cls}">${nav.side ? `<aside class="side" aria-label="${t("Menü")}">${nav.side}</aside><div class="scrim" ${UI.a("navTog")}></div>` : ""}<section class="cnt">${nav.top || ""}${content}</section>${det ? `<aside class="det" aria-label="${t("Kayıt ayrıntısı")}">${det}</aside>` : ""}</div>`;
};
/* ---- kabuk ---- */
const baseMain = SH.main;
SH.main = () => { const c = B4M.ctx; if (!c.uid) return `<div class="narrow">${baseMain()}</div>`;
  const ann = c.org == "s" ? B4M.lic.annFor(c.dmc, c.uid).map(a => `<div class="box ann" role="note"><div style="display:flex;justify-content:space-between;gap:8px"><b>${U.esc(a.title)}</b><button class="g" ${UI.a("annSeen", a.id)}>${t("Kapat")}</button></div><div class="mu">${U.esc(a.body)}</div></div>`).join("") : "";
  const sup = c.support ? `<div class="box warn" role="status" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span>${t("Destek modu: {n} ekranındasınız. Her işlem kayıt altına alınır.", { n: U.esc(B4M.parties.dmcName(c.dmc)) })}</span><button class="b" ${UI.a("supExit")}>${t("Destek modundan çık")}</button></div>` : "";
  VL.pre = sup + ann; const h = c.org == "h" ? B4M.vHQ.render() : B4M.vDMC.render(); VL.pre = ""; return h; };
VL.pre = "";
/* ---- üst bant ---- */
const baseHdr = SH.header;
SH.header = () => { let h = baseHdr(); const c = B4M.ctx; if (!c.uid || !B4M.db) return h; const u = B4M.app.user(), tab = c.org == "h" ? "hTab" : "dTab";
  h = h.replace(/<span class="mu url">[^<]*<\/span>/, "").replace(`<span class="mu" style="align-self:center">${U.esc(u.name)}</span>`, `<button class="g usr" ${UI.a(tab, "pw")} title="${t("Hesabım")}">👤 <span class="un">${U.esc(u.name)}</span></button>`);
  const fs = typeof document != "undefined" && document.fullscreenEnabled ? `<button class="g fsb" ${UI.a("fsTog")} aria-label="${t("Tam ekran")}" title="${t("Tam ekran")}">${document.fullscreenElement ? "🗗" : "⛶"}</button>` : "";
  h = h.replace(`<button class="g" ${UI.a("logout")}>`, fs + `<button class="g" ${UI.a("logout")}>`);
  return `<button class="g navb" ${UI.a("navTog")} aria-label="${t("Menü")}" title="${t("Menü")}">☰</button>` + h.replace('<div class="end">', `<div class="hsr">${VL.search ? VL.search() : ""}</div><div class="end">`); };
A.navTog = () => { if (VL.phone()) S.navOpen = !S.navOpen; else { PF.set(me(), "navMin", !PF.get(me(), "navMin", false)); S.navOpen = false; } };
A.fsTog = () => { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) { } setTimeout(() => UI.render(), 300); return { noRender: true }; };
/* menüden bir yere gidince telefonda çekmece kapanır */
["hTab", "dTab"].forEach(k => { const f = A[k]; A[k] = x => { S.navOpen = false; return f(x); }; });
/* ---- telefonda tablolar kart görünümü: her hücreye sütun başlığı yazılır ---- */
const baseRender = UI.render;
UI.render = () => { baseRender(); try { VL.label(document.getElementById("app")); VL.label(document.getElementById("ov")); } catch (e) { } };
VL.label = root => { if (!root) return; root.querySelectorAll(".tw table").forEach(tb => { const rows = tb.rows; if (!rows.length) return; const hs = [...rows[0].cells].map(c => c.textContent.trim()); for (let i = 1; i < rows.length; i++) [...rows[i].cells].forEach((c, j) => { if (hs[j] && !c.hasAttribute("colspan")) c.setAttribute("data-label", hs[j]); }); }); };
/* ---- stil ---- */
VL.CSS = `
main{max-width:none;margin:0;padding:0}
#hdr.lgo{min-height:52px;position:sticky;top:0;z-index:15;background:var(--sf);border-bottom:1px solid var(--ln);margin:0;padding:6px 14px;gap:10px;flex-wrap:nowrap;align-items:center}
#hdr .lgo,#hdr>svg{flex:none}#hdr .wm{font-size:22px}#hdr .tg{display:none}#hdr .bi{width:36px!important;height:36px!important;font-size:18px}#hdr .bt{font-size:18px}#hdr img.plogo{height:36px!important;max-width:180px!important}#hdr svg{max-height:38px;width:auto}
#hdr .end{margin-inline-start:0;align-items:center;flex-wrap:nowrap;gap:6px}.lngw{flex-direction:row;align-items:center;gap:6px}.lngw select{min-width:0;padding:5px 6px}
.hsr{flex:1;min-width:120px;max-width:560px;margin-inline-start:auto}.hsr label{margin:0}.hsr .hsl{display:none}
.navb{display:none}#hdr .usr{display:flex;gap:4px;align-items:center;white-space:nowrap}
.narrow{max-width:1040px;margin:0 auto;padding:16px}
.lay{display:grid;grid-template-columns:232px minmax(0,1fr);min-height:calc(100vh - 52px)}
.lay.nonav{grid-template-columns:minmax(0,1fr)}.lay.navmin{grid-template-columns:minmax(0,1fr)}.lay.navmin>.side{display:none}
.side{background:var(--sf);border-inline-end:1px solid var(--ln);padding:8px 6px 24px;position:sticky;top:52px;align-self:start;max-height:calc(100vh - 52px);overflow:auto}
.side nav.tabs{display:flex;flex-direction:column;flex-wrap:nowrap;gap:0;border:0;margin:0;overflow:visible}
.side nav.tabs button{text-align:start;white-space:normal;border-bottom:0;border-inline-start:3px solid transparent;padding:6px 10px;border-radius:0 6px 6px 0;color:var(--tx)}
.side nav.tabs button.on{border-color:var(--gd);background:var(--bg);font-weight:600}
.side .gh{display:flex;justify-content:space-between;width:100%;background:none;border:0;font:inherit;font-size:12.5px;color:var(--mu);padding:12px 10px 4px;cursor:pointer;font-weight:600}
.side .gh.cur{color:var(--tx)}
.scrim{display:none}
.cnt{padding:14px 18px 40px;min-width:0}
.ctxl{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 10px}.ctxl h1{font-size:19px;margin:0;font-weight:650}
.det{min-width:0;padding:14px 18px 40px;border-inline-start:1px solid var(--ln);background:var(--bg)}
.lay.hasdet>.cnt{display:none}
@media(min-width:1600px){.lay.hasdet{grid-template-columns:232px minmax(0,1fr) minmax(480px,38%)}.lay.hasdet.nonav,.lay.hasdet.navmin{grid-template-columns:minmax(0,1fr) minmax(480px,38%)}.lay.hasdet>.cnt{display:block}.det{position:sticky;top:52px;align-self:start;max-height:calc(100vh - 52px);overflow:auto}}
.row>label{max-width:460px}.row>label:only-child{max-width:none}
@media(max-width:767px){
 #hdr.lgo{flex-wrap:wrap;padding:6px 10px}.navb{display:inline-block}.hsr{order:9;flex-basis:100%;max-width:none}#hdr .un,#hdr .lngw>span{display:none}
 .lay{display:block}.side{display:none;position:fixed;top:0;bottom:0;inset-inline-start:0;width:min(300px,84vw);max-height:none;z-index:31;box-shadow:0 0 24px rgba(0,0,0,.3)}
 .lay.navopen>.side{display:block}.lay.navopen>.scrim{display:block;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:30}
 .cnt,.det{padding:10px}
 .tw table,.tw tbody,.tw tr,.tw td{display:block;width:100%}.tw tr:first-child{display:none}.tw tr{border:1px solid var(--ln);border-radius:8px;margin:0 0 8px;padding:4px 8px;background:var(--sf)}
 .tw td{border:0;white-space:normal;padding:3px 0;text-align:start}.tw td[data-label]::before{content:attr(data-label);display:block;font-size:12px;color:var(--mu)}.tw td.num{text-align:start}.tw td:empty{display:none}
}
@media(min-width:768px){.navb{display:inline-block}}
@media print{#hdr,.side,.scrim{display:none!important}.lay{display:block}}
`;
if (typeof document != "undefined") { const st = document.createElement("style"); st.id = "u004a"; st.textContent = VL.CSS; (document.head || document.documentElement).appendChild(st); document.addEventListener("fullscreenchange", () => UI.render()); }
