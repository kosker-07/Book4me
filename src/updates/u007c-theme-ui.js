/* Koyu mod: üst bantta düğme ile Otomatik (cihaz ayarı) → Koyu → Açık. Seçim kullanıcı bazında saklanır; giriş ekranında son seçim kullanılır. */
const UI = B4M.ui, A = UI.A, SH = B4M.shell, PF = B4M.pref;
const TH = B4M.theme = {};
TH.LS = "b4m-theme";
TH.get = () => { const u = B4M.ctx.uid; let v = u && B4M.db ? PF.get(u, "theme", null) : null; if (v == null) { try { v = localStorage.getItem(TH.LS); } catch (e) { } } return v == "dark" || v == "light" ? v : "auto"; };
TH.apply = () => { if (typeof document == "undefined") return; const v = TH.get(), r = document.documentElement; if (v == "auto") r.removeAttribute("data-theme"); else r.setAttribute("data-theme", v);
  const dark = v == "dark" || (v == "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches), m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", dark ? "#0a1424" : "#0B2A5B"); };
TH.NEXT = { auto: "dark", dark: "light", light: "auto" };
TH.ICON = { auto: "◐", dark: "☾", light: "☀" };
TH.LBL = { auto: "Tema: otomatik (cihaz ayarı)", dark: "Tema: koyu", light: "Tema: açık" };
A.theme = () => { const v = TH.NEXT[TH.get()], u = B4M.ctx.uid; if (u) PF.set(u, "theme", v); try { localStorage.setItem(TH.LS, v); } catch (e) { } TH.apply(); UI.toast(TH.LBL[v]); };
const baseHdr = SH.header; SH.header = () => { const h = baseHdr(), v = TH.get(), b = `<button class="g thm" ${UI.a("theme")} aria-label="${t(TH.LBL[v])}" title="${t(TH.LBL[v])}">${TH.ICON[v]}</button>`;
  return h.includes(`${UI.a("logout")}>`) ? h.replace(`<button class="g" ${UI.a("logout")}>`, b + `<button class="g" ${UI.a("logout")}>`) : h.replace(/(<\/div>)\s*$/, b + "$1"); };
const baseRender = UI.render; UI.render = () => { TH.apply(); baseRender(); };
if (typeof document != "undefined") { const st = document.createElement("style"); st.textContent = `
:root[data-theme="dark"] .lgo .wm{color:#fff}:root[data-theme="dark"] .lgo .wm b,:root[data-theme="dark"] .lgo .tg{color:#D9B25A}
:root[data-theme="dark"] .ovl{background:rgba(0,0,0,.7)}:root[data-theme="dark"] .lsug{box-shadow:0 8px 20px rgba(0,0,0,.5)}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]) .ovl{background:rgba(0,0,0,.7)}}
.thm{min-width:36px;font-size:16px;line-height:1}a{color:var(--ac)}`; (document.head || document.documentElement).appendChild(st);
  try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => TH.apply()); } catch (e) { } TH.apply(); }
