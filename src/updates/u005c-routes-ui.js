/* Yama 2b · çift ekran: kayıt adresleri, yeni sekmede aynı oturum, sekmeler arası eşitleme.
   Adres: #<marka>/rez/<rezervasyon no> veya #<marka>/e/<ekran>[/<alt ekran>]. Marka kısmı (#akdeniz, #backoffice) eski kuralı korur:
   yalnızca marka değişince oturum kapanır; ekran veya kayıt değişince yalnızca ilgili ekran açılır, geri düğmesi çalışır.
   Oturum tarayıcı deposunda süreli saklanır (şifre saklanmaz): 8 saat veya Çıkış'a kadar; Çıkış tüm sekmeleri kapatır.
   Oturum yalnızca kayıt/ekran adresiyle açılan sayfada sürer (yeni sekme, yenileme); yalın adres her zaman giriş ekranını açar.
   Eşitleme: her yazmada veri sürümü artar; başka sekme yazınca bu sekme veriyi yeniden okur. Eski veriyle yazma reddedilir, veri sessizce ezilmez.
   Sınır: claude.ai içinde yayınlanan sayfa çerçevede açılır; yeni sekme ayrı veriyle açılır (tarayıcı depolama ayrımı). Çift ekran dosya
   doğrudan açıldığında veya sunucuya geçişte tam çalışır. Farklı bilgisayar / kişi aynı kayıtta: sunucu gerekir. */
const UI = B4M.ui, A = UI.A, S = UI.S, AU = B4M.auth, BRU = B4M.uiBrand, VR = B4M.vRez, X = B4M.bkx, APP = B4M.app;
const RT = B4M.route = {};
const LS = () => { try { return globalThis.localStorage || null; } catch (e) { return null; } };
RT.SESS = "b4m-sess"; RT.HOURS = 8;
RT.framed = () => { try { return window.top !== window.self; } catch (e) { return true; } };
/* ---- adres ---- */
RT.parse = h => { const p = String(h || "").replace(/^#/, "").split("/"); return { slug: p[0] || "", kind: p[1] || "", a: decodeURIComponent(p[2] || ""), b: decodeURIComponent(p[3] || "") }; };
BRU.slug = () => { const s = RT.parse(location.hash).slug; return s && s != "backoffice" ? s : ""; };
RT.want = () => { const c = B4M.ctx, cur = RT.parse(location.hash); if (!c.uid) return null; const base = "#" + cur.slug;
  if (S.bx) { const b = B4M.db.get("bookings", S.bx); if (b) return `${base}/rez/${encodeURIComponent(b.no)}`; }
  const sub = S.tab == "acc" ? S.acT || "" : S.tab == "cm" ? S.cmT || "" : ""; return S.tab ? `${base}/e/${encodeURIComponent(S.tab)}${sub ? "/" + encodeURIComponent(sub) : ""}` : base; };
RT.apply = h => { const r = RT.parse(h), c = B4M.ctx; if (!c.uid) { RT.pending = h; return; }
  if (r.kind == "rez") { const b = X.byNo(r.a); if (b && X.canSee(b)) { Object.assign(S, { bx: b.id, bq: 0, md: null, iv: 0 }); return; } UI.toast("Bu adresteki rezervasyon bulunamadı veya görme yetkiniz yok."); S.bx = 0; return; }
  if (r.kind == "e" && r.a) { const f = c.org == "h" ? A.hTab : A.dTab; f(r.a); if (r.b) { if (r.a == "acc") S.acT = r.b; if (r.a == "cm") S.cmT = r.b; } S.bx = 0; return; }
  if (!r.kind) S.bx = 0; };
/* hashchange: yalnızca marka değişince eski davranış (oturum kapanır) */
RT.lastSlug = typeof location != "undefined" ? RT.parse(location.hash).slug : "";
if (typeof window != "undefined") window.addEventListener("hashchange", ev => { const r = RT.parse(location.hash); if (r.slug == RT.lastSlug) { ev.stopImmediatePropagation(); RT.syncing = true; RT.apply(location.hash); UI.render(); RT.syncing = false; } else RT.lastSlug = r.slug; }, true);
/* her çizimden sonra adres güncellenir (geri düğmesi için yeni kayıt) */
const baseRender = UI.render; UI.render = () => { if (RT.pending && B4M.ctx.uid) { const h = RT.pending; RT.pending = null; RT.apply(h); } baseRender();
  try { if (!RT.syncing && B4M.ctx.uid) { const w = RT.want(); if (w && w != location.hash) { history.pushState(null, "", w); } } } catch (e) { } };
/* ---- süreli oturum ---- */
RT.save = u => { const l = LS(); if (!l || !u) return; try { l.setItem(RT.SESS, JSON.stringify({ uid: u.id, exp: Date.now() + RT.HOURS * 36e5, k: Math.random().toString(36).slice(2) })); } catch (e) { } };
RT.clear = () => { const l = LS(); try { l && l.removeItem(RT.SESS); } catch (e) { } };
RT.read = () => { const l = LS(); try { const x = JSON.parse((l && l.getItem(RT.SESS)) || "null"); return x && x.exp > Date.now() ? x : null; } catch (e) { return null; } };
RT.restore = () => { const x = RT.read(), c = B4M.ctx; if (!x || c.uid) return false; const u = B4M.db.get("users", x.uid); if (!u || !u.active) { RT.clear(); return false; }
  if (u.org == "s" && !B4M.parties.licOK(APP.tidOf(u.oid))) { RT.clear(); return false; }
  const ten = BRU.slug() ? B4M.db.find("dmcs", d => d.slug == BRU.slug() && !d.parent) : null; if (ten && !(u.org == "s" && APP.tidOf(u.oid) == ten.id)) return false;
  Object.assign(c, { org: u.org, uid: u.id, dmc: u.org == "s" ? u.oid : 0, acct: u.org == "a" ? u.oid : 0, support: null }); RT.restored = true; if (B4M.myWork) B4M.myWork.restore(u); return true; };
const baseStart = AU.start; AU.start = u => { const r = baseStart(u); if (r && r.ok) { RT.save(u); RT.restored = true; } return r; };
const baseOut = AU.logout; AU.logout = () => { const had = B4M.ctx.uid; baseOut(); if (had && !RT.remote) RT.clear(); };
/* süre dolunca */
RT.checkExp = () => { if (B4M.ctx.uid && RT.restored && !RT.read() && LS()) { RT.remote = true; AU.logout(); RT.remote = false; Object.assign(S, { tab: "", bx: 0 }); UI.toast("Oturum süresi doldu; yeniden giriş yapın."); UI.render(); return true; } return false; };
if (typeof window != "undefined") setInterval(RT.checkExp, 60000);
/* ---- sekmeler arası eşitleme ---- */
RT.REV = () => APP.STORAGE_KEY + ":rev";
RT.rev = 0; RT.storedRev = () => { const l = LS(); return l ? +(l.getItem(RT.REV()) || 0) : 0; };
const baseInit = APP.init; APP.init = (...a) => { const db = baseInit(...a); RT.rev = RT.storedRev(); RT.wrapDb(db); if (typeof location != "undefined") { const r = RT.parse(location.hash); if (r.kind) { RT.restore(); RT.pending = location.hash; } } return db; };
RT.wrapDb = db => { if (db.adapter.name != "local" || db.__rt) return; db.__rt = 1; const base = db.commit;
  db.commit = () => { const l = LS(); if (!l) return base(); const st = RT.storedRev(); if (st != RT.rev) { RT.reload(true); return true; } const okk = base(); if (okk) { RT.rev = st + 1; try { l.setItem(RT.REV(), String(RT.rev)); } catch (e) { } } return okk; }; };
RT.reload = conflict => { const db = B4M.db; db.load(B4M.seed && B4M.seed.run); RT.rev = RT.storedRev(); if (S.bx && !db.get("bookings", S.bx)) S.bx = 0;
  if (conflict) { UI.toast("Bu kayıt başka bir pencerede değişti; ekran yenilendi, işlemi tekrarlayın."); setTimeout(() => UI.render(), 0); } };
RT.later = false;
RT.redraw = () => { const ae = document.activeElement; if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && ae.type != "checkbox" && ae.type != "radio") { RT.later = true; return; } RT.later = false; UI.render(); };
if (typeof window != "undefined") {
  window.addEventListener("storage", ev => { if (!B4M.db) return;
    if (ev.key == RT.REV()) { RT.reload(false); RT.redraw(); }
    else if (ev.key == RT.SESS) { const x = RT.read(); if (!x && B4M.ctx.uid) { RT.remote = true; AU.logout(); RT.remote = false; Object.assign(S, { tab: "", bx: 0, md: null, iv: 0 }); UI.render(); } else if (x && x.uid != B4M.ctx.uid) { const c = B4M.ctx; Object.assign(c, { org: "", uid: 0, dmc: 0, acct: 0, support: null }); RT.restore(); S.tab = ""; S.bx = 0; UI.render(); } } });
  document.addEventListener("focusout", () => { if (RT.later) setTimeout(() => { if (RT.later) RT.redraw(); }, 250); });
}
/* ---- yeni sekme / pencere ---- */
RT.url = b => location.href.split("#")[0] + "#" + RT.parse(location.hash).slug + "/rez/" + encodeURIComponent(b.no);
VR.newWin = id => { const b = B4M.db.get("bookings", id); if (!b) return; if (RT.framed()) { UI.S.copyText = null; UI.toast("Yayın sayfasında yeni sekme ayrı veriyle açılır; çift ekran için dosyayı doğrudan tarayıcıda açın. Adres panoya kopyalandı."); UI.copy(RT.url(b)); return; }
  const w = window.open(RT.url(b), "_blank"); if (!w) { UI.copy(RT.url(b)); UI.toast("Tarayıcı yeni pencereyi engelledi; adres panoya kopyalandı."); } };
A.bxWin = id => { VR.newWin(id); return { noRender: true }; };
A.bxLink = id => { const b = B4M.db.get("bookings", id); if (b) UI.copy(RT.url(b)); return { noRender: true }; };
VR.acts.push(b => `${UI.btn(t("Yeni pencerede aç"), "bxWin", b.id)} ${UI.btn(t("Adresi kopyala"), "bxLink", b.id)}`);
