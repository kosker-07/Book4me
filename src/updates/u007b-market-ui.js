/* u007 · arayüz: kontratın (sezonun) pazarı ve elle düzenleme; Back Office otel kontratı detayında sezon pazarları; arama ekranında not. */
const UI = B4M.ui, A = UI.A, S = UI.S, VP = B4M.vProd, MK = B4M.mkt, PD = B4M.prod, VY = B4M.vY1;
MK.txt = m => !m || m.mode == "all" || !(m.list || []).length ? t("Tüm pazarlar") : `${U.esc(m.label || t("Seçili ülkeler"))} · ${I.tn(m.list.length, "ülke")}`;
MK.names = m => (m.list || []).map(c => t(PD.natN(c))).join(", ");
const baseSeason = VP.season; VP.season = (x, s) => { const h = baseSeason(x, s), m = s.mk, defs = MK.defs(B4M.app.tidOf(x.sup)), mkts = [...new Set(defs.map(r => r.market))], ed = S.mkEd == s.id;
  const box = UI.box(t("Pazar (satışa açık milliyetler)"), `<p style="margin-top:0"><b>${MK.txt(m)}</b>${m && m.mode != "all" && (m.list || []).length ? `<br><span class="mu">${U.esc(MK.names(m))}</span>` : ""}</p><p class="mu" style="margin:0 0 8px">${t("Bu kontrat yalnızca listedeki milliyetlere satılır; diğer milliyetlerle yapılan aramada ve API sorgusunda görünmez. Aynı otelin başka pazar fiyat listesi ayrı kontrat olarak yüklenir.")}</p>` +
    (ed ? `<div class="row">${mkts.map(k => UI.chk(U.esc(XP_t(k)), `data-mk="${U.esc(k)}" ${(m && m.list || []).length && defs.filter(r => r.market == k).every(r => m.list.includes(r.nat)) ? "checked" : ""}`, false)).join("")}</div><div class="row" style="margin:0">${UI.btn(t("Pazarı kaydet"), "mkSave", [x.id, s.id], "b")}${UI.btn(t("Tüm pazarlara aç"), "mkAll", [x.id, s.id])}${UI.btn(t("Vazgeç"), "mkEd", 0)}</div>` : UI.btn(t("Pazarı düzenle"), "mkEd", s.id)));
  return box + h; };
const XP_t = k => B4M.xp.xTitle(k).replace(/\bUk\b/, "UK").replace(/\bCis\b/, "CIS");
A.mkEd = id => { S.mkEd = id; };
A.mkSave = ([hid, sid]) => { const ms = [...document.querySelectorAll("input[data-mk]")].filter(e => e.checked).map(e => e.getAttribute("data-mk")); const r = MK.setSeason(hid, sid, { markets: ms }); if (r.ok) S.mkEd = 0; return r; };
A.mkAll = ([hid, sid]) => { const r = MK.setSeason(hid, sid, { all: true }); if (r.ok) S.mkEd = 0; return r; };
/* Back Office: otel kontratı detayında sezon pazarları */
if (VY && VY.V && VY.V.hkDet) { const base = VY.V.hkDet; VY.V.hkDet = h => base(h) + ((h.seasons || []).length ? UI.box(t("Kontratlar ve pazarları"), UI.tbl([t("Sezon"), t("Tarih"), t("Pazar"), t("Milliyetler")], h.seasons.map(s => `<tr><td>${U.esc(s.name)}</td><td>${I.fdr(s.from, s.to)}</td><td>${MK.txt(s.mk)}</td><td class="wrap mu">${U.esc(MK.names(s.mk || {}))}</td></tr>`))) : ""); }
