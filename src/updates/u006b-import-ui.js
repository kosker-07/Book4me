/* u006 · arayüz: yükleme ekranında ek sayfaların (erken rezervasyon, pazar tanımı, ekonomi oda) ne olduğunu bilgi olarak gösterir. */
const UI = B4M.ui, S = UI.S, VP = B4M.vProd;
const baseImp = VP.imp; VP.imp = () => { const h = baseImp(), M = S.imp, X = (M && M.extra) || []; if (!X.length || !M.hotels || !M.hotels.length) return h;
  const box = `<div class="mu" style="margin:8px 0 0"><b style="color:var(--ok)">${t("Ek sayfalar")}:</b> ${X.map(([m, p]) => U.esc(t(m, p))).join(" · ")}</div>`;
  const i = h.indexOf('<div class="cards"'); if (i < 0) return h + box; const j = h.indexOf("</div></div>", h.indexOf("</div>", i)); return i < 0 ? h : h.replace(/(<div class="cards"[\s\S]*?<\/div><\/div>)/, `$1${box}`); };
