/* Arayüz çatısı: tek bir çizim fonksiyonu, olay yetkilendirme (data-a tıklama, data-c değişiklik, data-i yazma), bildirim ve iletişim kutuları.
   Ekranlar yalnızca bu katmanı ve iş kurallarını kullanır; veri katmanına doğrudan yazmaz. */
const UI = B4M.ui = {};
UI.S = { tab: "", sub: "", f: {}, q: null, bk: null, imp: null, dv: null, rv: null, md: null, dlg: null };
UI.A = {};
UI.V = {};
const enc = o => U.esc(JSON.stringify(o == null ? null : o));
UI.a = (name, args) => `data-a="${name}"${args !== undefined ? ` data-p="${enc(args)}"` : ""}`;
UI.c = (name, args) => `data-c="${name}"${args !== undefined ? ` data-p="${enc(args)}"` : ""}`;
UI.i = (name, args) => `data-i="${name}"${args !== undefined ? ` data-p="${enc(args)}"` : ""}`;
UI.$ = id => document.getElementById(id);
UI.val = id => { const e = UI.$(id); return e ? (e.type == "checkbox" ? e.checked : e.value) : ""; };
UI.vals = (ids, pre = "") => Object.fromEntries(ids.map(k => [k, UI.val(pre + k)]));
UI.opt = (list, sel, tr = true) => list.map(x => { const v = Array.isArray(x) ? x[0] : x, l = Array.isArray(x) ? x[1] : x; return `<option value="${U.esc(v)}" ${String(v) == String(sel) ? "selected" : ""}>${U.esc(tr ? t(String(l)) : l)}</option>`; }).join("");
UI.box = (title, body, x = "") => `<div class="box"${x}>${title ? `<h2>${title}</h2>` : ""}${body}</div>`;
UI.btn = (label, a, args, cls = "g", x = "") => `<button class="${cls}" ${UI.a(a, args)} ${x}>${label}</button>`;
UI.fld = (label, input, w) => `<label${w ? ` style="max-width:${w}px"` : ""}>${label}${input}</label>`;
UI.in = (id, val, x = "", type = "text") => `<input id="${id}" type="${type}" value="${U.esc(val ?? "")}" ${x}>`;
UI.sel = (id, list, sel, x = "", tr = true) => `<select id="${id}" ${x}>${UI.opt(list, sel, tr)}</select>`;
UI.chk = (label, x, on) => `<label class="rl"><input type="checkbox" ${on ? "checked" : ""} ${x}>${label}</label>`;
UI.tbl = (heads, rows, empty) => `<div class="tw"><table><tr>${heads.map(h => typeof h == "string" ? `<th>${h}</th>` : `<th class="${h[1]}">${h[0]}</th>`).join("")}</tr>${rows.length ? rows.join("") : `<tr><td colspan="${heads.length}" class="mu">${empty || t("Kayıt yok.")}</td></tr>`}</table></div>`;
UI.cards = L => `<div class="cards">${L.filter(Boolean).join("")}</div>`;
UI.card = (tt, v, s, cls = "") => `<div class="box kpi"><div class="mu">${tt}</div><div class="kv ${cls}">${v}</div><div class="mu">${s || ""}</div></div>`;
UI.tabs = (L, cur, a, x = "") => `<nav class="tabs" ${x}>${L.map(([k, l]) => `<button class="${cur == k ? "on" : ""}" ${UI.a(a, k)}>${l}</button>`).join("")}</nav>`;
UI.chip = (tt, cls = "") => `<span class="chip ${cls}">${tt}</span>`;
UI.st = (s, good) => `<span class="${good ? "ok" : "bad"}">${U.esc(t(s))}</span>`;
UI.fm = (a, c) => I.fm(a, c);
UI.fd = d => I.fd(d);
UI.esc = U.esc;
UI.SPB = () => `<span class="spb">${t("Special offer")}</span>`;
/* toplam: {pb: tutar} → metin */
UI.sumC = m => Object.entries(m).filter(([, v]) => Math.abs(v) > .004).map(([c, v]) => I.fm(U.r2(v), c)).join(" · ") || "—";
/* bildirim */
UI.toast = (msg, p) => { if (!msg) return; const e = UI.$("toast"); if (!e) return; e.textContent = t(msg, p); e.style.display = "block"; clearTimeout(UI.toast.t); UI.toast.t = setTimeout(() => e.style.display = "none", 3800); };
UI.res = r => { if (r && r.msg) UI.toast(r.msg, r.p); return r; };
/* sayfa içi iletişim kutuları (alert/confirm/prompt yerine) */
UI.ask = (msg, onYes, o = {}) => { UI.S.dlg = { msg, onYes, input: o.input, ph: o.ph || "", yes: o.yes || "Evet", no: o.no || "Vazgeç", danger: o.danger }; UI.render(); setTimeout(() => { const e = UI.$("dlg_in"); if (e) e.focus(); }, 30); };
UI.A.dlgYes = () => { const d = UI.S.dlg; if (!d) return false; const v = d.input ? UI.val("dlg_in") : true; UI.S.dlg = null; return d.onYes(v); };
UI.A.dlgNo = () => { UI.S.dlg = null; };
UI.dlgHTML = () => { const d = UI.S.dlg; if (!d) return ""; return `<div class="ovl" role="dialog" aria-modal="true" aria-label="${t("Onay")}"><div class="box dlg"><p style="margin-top:0">${U.esc(t(d.msg))}</p>${d.input ? `<textarea id="dlg_in" rows="3" placeholder="${U.esc(t(d.ph))}"></textarea>` : ""}<div class="row" style="justify-content:flex-end;margin:10px 0 0"><button class="g" ${UI.a("dlgNo")}>${t(d.no)}</button><button class="${d.danger ? "b danger" : "b"}" ${UI.a("dlgYes")}>${t(d.yes)}</button></div></div></div>`; };
/* eylem çalıştır: eylem bir sonuç döndürürse bildirim gösterilir; false dönmezse veri kaydedilir ve ekran yeniden çizilir */
UI.run = (name, args, el, ev, live) => {
  const f = UI.A[name]; if (!f) { console.warn("eylem yok:", name); return; }
  let r; try { r = f(args, el, ev); } catch (e) { console.error(e); UI.toast("Beklenmeyen bir hata oluştu: {e}", { e: e.message }); return; }
  const fin = r => { if (r === false) return; if (r && typeof r == "object" && "ok" in r) UI.res(r); if (B4M.db) { if (!B4M.db.commit()) UI.toast("Tarayıcı depolama alanı doldu; daha az veriyle tekrar deneyin."); } if (!(r && r.noRender)) UI.render(); };
  if (r && typeof r.then == "function") r.then(fin, e => { console.error(e); UI.toast("Beklenmeyen bir hata oluştu: {e}", { e: e.message }); UI.render(); }); else fin(r);
};
const argsOf = el => { const p = el.getAttribute("data-p"); if (p == null) return undefined; try { return JSON.parse(p); } catch (e) { return p; } };
UI.bind = root => {
  root.addEventListener("click", ev => { const el = ev.target.closest("[data-a]"); if (!el || el.disabled) return; if (el.tagName == "A") ev.preventDefault(); UI.run(el.getAttribute("data-a"), argsOf(el), el, ev); });
  root.addEventListener("change", ev => { const el = ev.target; if (!el.getAttribute || !el.getAttribute("data-c")) return; UI.run(el.getAttribute("data-c"), argsOf(el), el, ev); });
  root.addEventListener("input", ev => { const el = ev.target; if (!el.getAttribute || !el.getAttribute("data-i")) return; UI.run(el.getAttribute("data-i"), argsOf(el), el, ev, true); });
  root.addEventListener("keydown", ev => { if (ev.key == "Escape" && (UI.S.dlg || UI.S.dv || UI.S.rv || UI.S.md || UI.S.vw)) { UI.S.dlg = UI.S.dv = UI.S.rv = UI.S.md = UI.S.vw = null; UI.render(); } if (ev.key == "Enter" && ev.target && ev.target.getAttribute && ev.target.getAttribute("data-enter")) { ev.preventDefault(); UI.run(ev.target.getAttribute("data-enter"), argsOf(ev.target), ev.target, ev); } });
  root.addEventListener("submit", ev => ev.preventDefault());
  root.addEventListener("focusout", ev => { const el = ev.target, id = el.getAttribute && el.getAttribute("data-sug"); if (!id) return; setTimeout(() => { const b = UI.$(id); if (b && !b.contains(document.activeElement)) b.style.display = "none"; }, 220); });
  root.addEventListener("focusin", ev => { const el = ev.target, id = el.getAttribute && el.getAttribute("data-sug"); if (!id) return; const b = UI.$(id); if (b) b.style.display = ""; });
};
/* çizim: odaklı alanı ve imleç konumunu korur */
UI.render = () => {
  const app = UI.$("app"); if (!app) return;
  const ae = document.activeElement, fid = ae && ae.id, pos = ae && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null, sy = window.scrollY;
  document.documentElement.lang = I.lang; document.documentElement.dir = I.dir();
  B4M.uiBrand.apply();
  UI.$("hdr").innerHTML = B4M.shell.header();
  app.innerHTML = B4M.shell.main();
  UI.$("ov").innerHTML = B4M.shell.overlays() + UI.dlgHTML();
  if (fid) { const n = UI.$(fid); if (n && n !== document.activeElement) { n.focus({ preventScroll: true }); if (pos) try { n.setSelectionRange(pos[0], pos[1]); } catch (e) { } } }
  if (Math.abs(window.scrollY - sy) > 2) window.scrollTo(0, sy);
};
UI.top = () => window.scrollTo(0, 0);
/* dosya okuma yardımcıları */
UI.readData = f => new Promise((okk, bad) => { const r = new FileReader(); r.onload = e => okk(e.target.result); r.onerror = () => bad(new Error("read")); r.readAsDataURL(f); });
UI.readText = f => new Promise((okk, bad) => { const r = new FileReader(); r.onload = e => okk(e.target.result); r.onerror = () => bad(new Error("read")); r.readAsText(f); });
UI.imgSmall = (f, max = 1400) => new Promise((okk, bad) => { const r = new FileReader(); r.onload = e => { const im = new Image(); im.onload = () => { const sc = Math.min(1, max / Math.max(im.width, im.height)), cn = document.createElement("canvas"); cn.width = Math.round(im.width * sc); cn.height = Math.round(im.height * sc); cn.getContext("2d").drawImage(im, 0, 0, cn.width, cn.height); okk(cn.toDataURL("image/jpeg", .82)); }; im.onerror = () => bad(new Error("img")); im.src = e.target.result; }; r.readAsDataURL(f); });
/* panoya kopyala (indirme yerine) */
UI.copy = async txt => { try { await navigator.clipboard.writeText(txt); UI.toast("Panoya kopyalandı."); } catch (e) { UI.S.copyText = txt; UI.render(); } };
