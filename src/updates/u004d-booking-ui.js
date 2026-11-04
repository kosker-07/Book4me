/* Yama 2a · tek rezervasyon ekranı + oluşturma/seyahat tarihi + tek/çift tık.
   Rezervasyonla ilgili her iş tek ekranda: üst bilgi, işlem çubuğu, bölümler (misafirler, hizmet, fiyat, ödeme, iptal, belgeler, rebooking, notlar, geçmiş).
   Değişiklik aynı ekranda açılır (ikinci katman yok). Geniş ekranda sağ panelde, diğerlerinde tam sayfa.
   Listelerde: tek tık = satırın altında özet, çift tık / "Aç" = tam ayrıntı, Ctrl + tık / orta tık = yeni sekme (2b), telefonda dokunma = özet. */
const UI = B4M.ui, A = UI.A, S = UI.S, db = () => B4M.db, P = B4M.parties, BK = B4M.book, AU = B4M.auth, VB = B4M.vBook, VC = B4M.vCommon, VH = B4M.vHQ, VL = B4M.vLay, PF = B4M.pref, X = B4M.bkx;
const VR = B4M.vRez = {};
const uid = () => B4M.ctx.uid, fd = d => I.fd(d), fm = (a, c) => I.fm(a, c);
VR.trv = b => !b.a ? "—" : b.b && b.b != b.a ? `${fd(b.a)} → ${fd(b.b)}` : fd(b.a);
VR.dto = b => { const n = X.daysTo(b); return n == null ? "" : n > 0 ? t("{n} gün kaldı", { n }) : n == 0 ? t("bugün") : t("geçti"); };
VR.stCls = s => s == "Onaylı" ? "ok" : "bad";
/* ---- açma / kapama ---- */
VR.open = id => { const b = db().get("bookings", +id); if (!b || !X.canSee(b)) return B4M.res.no("Bu rezervasyonu görme yetkiniz yok."); Object.assign(S, { bx: b.id, bq: 0, md: null, rv: null, bxN: false, bxE: 0 }); if (VR.onOpen) VR.onOpen(b); if (!VL.wide()) UI.top(); };
A.bxOpen = id => VR.open(id);
A.bxClose = () => { S.bx = 0; S.md = null; S.bxN = false; if (VR.onClose) VR.onClose(); };
A.bq = id => { S.bq = S.bq == id ? 0 : id; };
/* eski "Detay" düğmeleri de tek rezervasyon ekranına gider */
A.rv = x => { if (!x) return; const id = x.k == "b" ? x.id : ((db().get("orders", x.id) || {}).items || [])[0]; const b = id && db().get("bookings", id); if (b && X.canSee(b)) return VR.open(b.id); S.rv = x; };
/* değişiklik ekranı tek rezervasyon ekranının içinde açılır */
const baseMod = VB.modify; VB.modify = () => { if (S.bx && S.md && S.md.id == S.bx && !VR.inl) return ""; return baseMod(); };
VR.modInline = () => { VR.inl = true; let h = ""; try { h = baseMod(); } finally { VR.inl = false; } return h.replace(/^<div class="ovl"[^>]*>/, "").replace(/<\/div>$/, "").replace(/^<div class="box"/, '<div class="box hl"'); };
/* ---- ekran ---- */
VL.detail = () => S.bx ? VR.screen() : "";
VR.secOpen = k => !(PF.get(uid(), "bxC", []) || []).includes(k);
A.bxSec = k => { const L = new Set(PF.get(uid(), "bxC", [])); L.has(k) ? L.delete(k) : L.add(k); PF.set(uid(), "bxC", [...L]); };
VR.sec = (k, title, body) => body ? `<section class="bxs"><h3><button class="bxh" ${UI.a("bxSec", k)} aria-expanded="${VR.secOpen(k)}">${t(title)} <span aria-hidden="true">${VR.secOpen(k) ? "▾" : "▸"}</span></button></h3>${VR.secOpen(k) ? `<div class="bxb">${body}</div>` : ""}</section>` : "";
VR.kv = L => `<table class="kvt">${L.filter(Boolean).map(([l, v]) => `<tr><td class="mu">${t(l)}</td><td>${v}</td></tr>`).join("")}</table>`;
VR.acts = []; /* 2b ek düğmeler: (b, side) => html */
VR.extraSecs = []; /* 2b ek bölümler: (b, side) => [k, başlık, html] */
VR.screen = () => {
  const b = db().get("bookings", S.bx); if (!b || !X.canSee(b)) { S.bx = 0; return ""; }
  const side = X.side(b), o = X.order(b), h = side == "h", sup = side == "sup", buy = side == "buy", own = sup && b.own && P.rootOf("s", b.sup) == B4M.app.tidOf(B4M.ctx.dmc), sib = (o.items || []).filter(id => id != b.id).map(id => db().get("bookings", id)).filter(Boolean);
  const canMod = buy && b.status == "Onaylı" && (AU.can("by") || AU.can("r")), canCx = canMod;
  const btn = (l, a, p, c = "g", x = "") => UI.btn(t(l), a, p, c, x);
  const acts = [canMod && btn("Değiştir", "mdOpen", b.id, "b"), canCx && btn("İptal et", "cancelBk", b.id), b.vch && btn("Voucher", "dv", ["v", b.id]), (h || buy) && o.inv && `${UI.btn(t("Fatura") + " " + U.esc(o.inv.no), "dv", ["i", o.id])}`, btn("Not ekle", "bxNote", b.id), ...VR.acts.map(f => f(b, side))].filter(Boolean).join(" ");
  const head = `<div class="bxtop"><div>${UI.btn("‹ " + t(VL.wide() ? "Kapat" : "Listeye dön"), "bxClose")}</div><h2 class="bxno">${U.esc(b.no)} <span class="chip ${VR.stCls(b.status)}">${U.esc(t(b.status))}</span>${b.pendingMod ? ` <span class="chip bad">${t("Değişiklik talebi tedarikçi onayında")}</span>` : ""}</h2>
  <div class="bxmeta"><span>${t("Oluşturma")}: <b>${U.esc(I.fd(X.created(b)))}</b> <span class="mu">${U.esc((X.created(b) || "").slice(11, 16))}</span></span><span>${t("Seyahat")}: <b>${VR.trv(b)}</b>${b.kind == "h" && X.nights(b) ? ` · ${I.tn(X.nights(b), "gece")}` : ""} <span class="mu">${VR.dto(b)}</span></span>${b.owner ? `<span>${t("Üstlenen")}: <b>${U.esc(b.owner.name)}</b></span>` : ""}</div></div>
  <div class="row bxact" style="gap:6px;margin:8px 0 12px">${acts}</div>`;
  const md = S.md && S.md.id == b.id ? VR.modInline() : "";
  const note = S.bxN ? `<div class="box hl"><label>${t("Not")}<textarea id="bx_note" rows="2" placeholder="${U.esc(t("Yalnızca firmanızın kullanıcıları görür"))}"></textarea></label><div class="row" style="margin:8px 0 0">${UI.btn(t("Notu kaydet"), "bxNoteSave", b.id, "b")}${UI.btn(t("Vazgeç"), "bxNote", 0)}</div></div>` : "";
  /* bölümler */
  const guests = `${(b.guests || []).length ? `<ol class="gl">${b.guests.map(g => `<li>${U.esc(g)}</li>`).join("")}</ol>` : `<span class="mu">—</span>`}${b.nat ? `<div class="mu">${t("Milliyet")}: ${U.esc(t(B4M.prod.natN(b.nat)))}</div>` : ""}`;
  const svc = VR.kv([["Hizmet türü", U.esc(t(U.SVN[b.kind] || b.kind))], ["Hizmet", VC.desc(b.desc)], ["Seyahat", VR.trv(b) + (b.kind == "h" && X.nights(b) ? ` · ${I.tn(X.nights(b), "gece")}` : "")], b.fl && ["Uçuş", U.esc(b.fl)],
    (h || sup) && ["Alıcı hesap", U.esc(P.accName(b.ag))], h && ["Tedarikçi", U.esc(P.dmcName(b.sup))], b.ref && ["Referans", U.esc(b.ref)], b.by && ["Yapan", U.esc(b.by)],
    sib.length && ["Aynı siparişte", sib.map(s => `<button class="lnk" ${UI.a("bxOpen", s.id)}>${U.esc(s.no)}</button>`).join(" · ")]]);
  const mg = b.mg || {}, price = h ? VR.kv([["Alıcıya satış", fm(b.total, b.cur)], ["DMC'ye alış", fm(b.cost, b.costCur)], ["Platform markup", fm(mg.hq || 0, b.cur)], mg.ps && ["Üst tedarikçi kâr payı", fm(mg.ps, mg.psCur || b.costCur)], mg.rb && ["Rebooking geliri", fm(mg.rb, "EUR")], ["Platform kârı", `<b>${fm(U.r2((mg.hq || 0) + (mg.rb || 0)), b.cur)}</b>`]])
    : sup ? VR.kv([own ? ["Acenteye satış", fm(b.total, b.cur)] : null, ["Size ödenecek", fm(b.cost ?? b.total, b.costCur || b.cur)], own && mg.dm != null && ["Kârınız", fm(mg.dm, b.cur)], b.dbuy && ["Alış (sizin girdiğiniz)", fm(b.dbuy.amt, b.dbuy.cur)], !own && ["Ödeme günü", b.status == "Onaylı" ? (b.sp ? t("ödendi") + " " + fd(b.sp) : fd(BK.supPay(b))) : "—"]])
    : VR.kv([["Tutar", fm(b.total, b.cur)], b.resale && ["Müşterinize satış", `${fm(b.resale.amt, b.resale.cur)} · ${U.esc(b.resale.to)}`]]);
  const d = BK.oDue(o), pay = sup ? "" : VR.kv([["Sipariş", U.esc(o.no || "")], ["Durum", `<b class="${d && !o.auto ? "bad" : "ok"}">${U.esc(t(BK.oSt(o)))}</b>`], ["Sipariş toplamı", fm(o.total, o.cur)], ["Ödenen", fm(o.paid || 0, o.cur)], d && !o.auto && ["Ödenecek", `<b>${fm(d, o.cur)}</b>`], d && !o.auto && ["Son ödeme", fd(o.due)], o.pay && ["Ödeme yöntemi", U.esc(t(o.pay.m))]]);
  const cx = VR.kv([(h || buy) && ["Alıcının ücretsiz iptali", b.dl ? t("{d} tarihine kadar", { d: fd(b.dl) }) : t("İade edilemez")], (h || sup) && ["Tedarikçinin ücretsiz iptali", b.sdl ? t("{d} tarihine kadar", { d: fd(b.sdl) }) : t("İade edilemez")]]);
  const docs = [b.vch && UI.btn(t("Voucher") + " " + U.esc(b.vch), "dv", ["v", b.id]), (h || buy) && o.inv && UI.btn(t("Fatura") + " " + U.esc(o.inv.no), "dv", ["i", o.id]), buy && o.cinv && UI.btn(t("Müşteri faturası") + " " + U.esc(o.cinv.no), "dv", ["c", o.id])].filter(Boolean).join(" ") || `<span class="mu">${t("Fatura ve voucher ödeme tahsil edildikten sonra oluşur.")}</span>`;
  const rbA = h ? db().where("rbAuctions", x => x.bid == b.id) : [], rbR = h ? db().where("rbRev", x => x.no == b.no) : [];
  const rb = h && (rbA.length || rbR.length) ? `<ul class="log">${rbA.map(x => `<li>${t("Artırma")} · ${U.esc(t(x.st))} · ${t("kapanış")} ${fd(x.end)}</li>`).join("")}${rbR.map(x => `<li>${fd(x.at)} · ${t("Rebooking geliri")} ${fm(x.e, "EUR")}</li>`).join("")}</ul>` : "";
  const myT = B4M.app.curTid(), notes = (b.inotes || []).filter(n => n.tid == myT);
  const nt = `${b.note ? `<p style="margin:0 0 6px"><span class="mu">${t("Özel istek")}:</span> ${U.esc(b.note)}</p>` : ""}${notes.length ? `<ul class="log">${notes.slice().reverse().map(n => `<li>${fd(n.at)} · ${U.esc(n.by)} · ${U.esc(n.txt)}</li>`).join("")}</ul>` : ""}` || `<span class="mu">${t("Not yok.")}</span>`;
  const req = db().where("modreq", x => x.bid == b.id);
  const hist = [...(b.mods || []).map(x => [x.at, `${U.esc(x.by)} · ${x.iv ? `<b>${t("Müdahale")}</b> · ` : ""}${U.esc(x.txt)}`]), ...req.map(r => [r.at, `${t("Değişiklik talebi")} · ${U.esc(t(r.state))} · ${U.esc(r.txt)}`]), [X.created(b), t("Rezervasyon oluşturuldu")]].sort((a, c) => (c[0] || "").localeCompare(a[0] || ""));
  const extra = VR.extraSecs.map(f => f(b, side)).filter(Boolean);
  return `<div class="bxw">${head}${md}${note}${extra.map(x => VR.sec(...x)).join("")}
    ${VR.sec("g", "Misafirler", guests)}${VR.sec("s", "Hizmet", svc)}${VR.sec("p", "Fiyat", price)}${VR.sec("o", "Ödeme ve son ödeme", pay)}${VR.sec("c", "İptal koşulları", cx)}${VR.sec("d", "Belgeler", docs)}${VR.sec("r", "Rebooking durumu", rb)}${VR.sec("n", "Notlar", nt)}
    ${VR.sec("h", "Geçmiş", `<ul class="log">${hist.map(([a, x]) => `<li>${fd(a)} ${U.esc((a || "").slice(11, 16))} · ${x}</li>`).join("")}</ul>`)}</div>`;
};
A.bxNote = id => { S.bxN = !!id && !S.bxN; };
A.bxNoteSave = id => { const b = db().get("bookings", id), x = String(UI.val("bx_note") || "").trim(); if (!x) return B4M.res.no("Not boş olamaz."); const u = B4M.app.user(); (b.inotes = b.inotes || []).push({ at: U.now(), by: u.name, uid: u.id, tid: B4M.app.curTid(), txt: x }); B4M.audit.log("booking.note", b.no, x); S.bxN = false; return B4M.res.ok("Not eklendi."); };
/* ---- birleşik rezervasyon listesi (Back Office "Rezervasyonlar", DMC "Rezervasyon işlemleri") ---- */
VR.COLS = { no: "No", guest: "Misafir", svc: "Hizmet", created: "Oluşturma", travel: "Seyahat", status: "Durum", total: "Tutar", acct: "Alıcı hesap", sup: "Tedarikçi", pay: "Ödeme", cost: "Alış", dl: "Ücretsiz iptal" };
VR.DEFC = ["no", "guest", "svc", "created", "travel", "status", "total"];
VR.DEFF = { q: "", bs: "c", a: "", b: "", st: "act", k: "", o: "new" };
VR.lf = id => ({ ...VR.DEFF, ...(PF.get(uid(), "lf_" + id, {}) || {}) });
VR.lc = (id, avail) => (PF.get(uid(), "lc_" + id, null) || VR.DEFC).filter(c => avail.includes(c));
VR.filt = (L, f) => { const dOf = b => f.bs == "t" ? b.a || "" : (X.created(b) || "").slice(0, 10);
  const R = L.filter(b => (f.st == "all" || (f.st == "act" ? b.status == "Onaylı" : b.status != "Onaylı")) && (!f.k || b.kind == f.k) && (!f.a || dOf(b) >= f.a) && (!f.b || dOf(b) <= f.b) && (!f.q || BK.bMatch(b, f.q) || U.mt(f.q, (X.order(b).no || ""))));
  const so = { new: (x, y) => X.created(y).localeCompare(X.created(x)), old: (x, y) => X.created(x).localeCompare(X.created(y)), tr: (x, y) => (x.a || "").localeCompare(y.a || ""), trd: (x, y) => (y.a || "").localeCompare(x.a || "") }[f.o] || (() => 0);
  return R.sort(so); };
VR.cell = (c, b, side) => { const o = X.order(b); switch (c) {
  case "no": return `<b>${U.esc(b.no)}</b>${b.src == "api" ? ` <span class="chip">API</span>` : ""}${b.owner ? `<div class="mu">👤 ${U.esc(b.owner.name)}</div>` : ""}`;
  case "guest": return `${U.esc((b.guests || [])[0] || "—")}${(b.guests || []).length > 1 ? ` <span class="mu">+${b.guests.length - 1}</span>` : ""}`;
  case "svc": return `<span class="wrap2">${VC.desc(b.desc)}</span>`;
  case "created": return `${fd(X.created(b))}`;
  case "travel": return VR.trv(b);
  case "status": return `<span class="${VR.stCls(b.status)}">${U.esc(t(b.status))}</span>${b.pendingMod ? `<div class="bad" style="font-size:12px">${t("talep")}</div>` : ""}`;
  case "total": return side == "sup" ? fm(b.cost ?? b.total, b.costCur || b.cur) : fm(b.total, b.cur);
  case "acct": return U.esc(P.accName(b.ag)); case "sup": return U.esc(P.dmcName(b.sup));
  case "pay": return U.esc(t(BK.oSt(o))); case "cost": return fm(b.cost, b.costCur);
  case "dl": return side == "sup" ? (b.sdl ? fd(b.sdl) : t("İade edilemez")) : (b.dl ? fd(b.dl) : t("İade edilemez"));
} return ""; };
VR.list = (id, L, o = {}) => {
  const f = VR.lf(id), avail = o.cols || Object.keys(VR.COLS), cols = VR.lc(id, avail), R = VR.filt(L, f), side = o.side || "h", show = R.slice(0, 300), n = cols.length + 1;
  const sc = (k, l, opts) => UI.fld(t(l), `<select ${UI.c("lfSet", [id, k])}>${UI.opt(opts, f[k])}</select>`, 180);
  const kinds = U.uniq(L.map(b => b.kind)).filter(Boolean);
  const bar = `<div class="row">${UI.fld(t("Ara"), `<input type="search" id="lf_${id}" value="${U.esc(f.q)}" placeholder="${U.esc(t("Rezervasyon no, misafir, otel, hesap veya voucher"))}" ${UI.c("lfSet", [id, "q"])} data-enter="lfQ">`)}
    ${sc("bs", "Tarih türü", [["c", "Oluşturma tarihi"], ["t", "Seyahat tarihi"]])}${UI.fld(t("Başlangıç"), `<input type="date" value="${f.a}" ${UI.c("lfSet", [id, "a"])}>`, 160)}${UI.fld(t("Bitiş"), `<input type="date" value="${f.b}" ${UI.c("lfSet", [id, "b"])}>`, 160)}</div>
    <div class="row">${sc("st", "Durum", [["act", "Aktif"], ["can", "İptal"], ["all", "Tümü"]])}${kinds.length > 1 ? sc("k", "Hizmet türü", [["", "Tümü"], ...kinds.map(k => [k, U.SVN[k] || k])]) : ""}${sc("o", "Sırala", [["new", "Oluşturma (yeni → eski)"], ["old", "Oluşturma (eski → yeni)"], ["tr", "Seyahat (yakın → uzak)"], ["trd", "Seyahat (uzak → yakın)"]])}
    <div class="row" style="margin:0;gap:6px">${UI.btn(t("Sütunlar"), "lcOpen", id)}${UI.btn(t("CSV kopyala"), "lCsv", id)}${JSON.stringify(f) != JSON.stringify(VR.DEFF) ? UI.btn(t("Filtreleri temizle"), "lfClr", id) : ""}</div></div>
    ${S.lcOpen == id ? `<div class="box" style="background:var(--bg)"><b>${t("Görünen sütunlar")}</b><div class="row" style="margin:6px 0 0">${avail.map(c => UI.chk(t(VR.COLS[c]), UI.c("lcTog", [id, c]), cols.includes(c))).join("")}</div><div class="row" style="margin:6px 0 0">${UI.btn(t("Varsayılan sütunlar"), "lcDef", id)}${UI.btn(t("Kapat"), "lcOpen", id)}</div></div>` : ""}`;
  VR.last[id] = { R, cols, side };
  const rows = show.map(b => { const q = S.bq == b.id;
    return `<tr class="rw${q ? " sel" : ""}" data-bx="${b.id}" tabindex="0">${cols.map(c => `<td class="${["total", "cost"].includes(c) ? "num" : c == "svc" ? "wrap" : ""}">${VR.cell(c, b, side)}</td>`).join("")}<td class="ra">${UI.btn(t("Aç"), "bxOpen", b.id, "g", 'style="padding:2px 10px"')}</td></tr>${q ? `<tr class="bqr"><td colspan="${n}">${VR.quick(b, side)}</td></tr>` : ""}`; });
  return UI.box(o.title ? t(o.title) + ` <span class="mu" style="font-weight:400">(${R.length})</span>` : "", (o.intro || "") + bar + UI.tbl([...cols.map(c => ["total", "cost"].includes(c) ? [t(VR.COLS[c]), "num"] : t(VR.COLS[c])), ""], rows, t(L.length ? "Bu filtrede rezervasyon yok." : "Henüz rezervasyon yok.")) + (R.length > show.length ? `<p class="mu">${t("İlk {n} kayıt gösteriliyor; filtreyi daraltın.", { n: show.length })}</p>` : "") + `<p class="mu" style="margin:6px 0 0">${t("Tek tık: özet · çift tık veya Aç: tam ayrıntı · Ctrl + tık: yeni sekme")}</p>`);
};
VR.last = {};
VR.quick = (b, side) => { const o = X.order(b), buy = side == "buy";
  return `<div class="bq"><span><b>${U.esc((b.guests || []).join(", ") || "—")}</b></span><span>${t("Seyahat")}: ${VR.trv(b)}</span><span class="${VR.stCls(b.status)}">${U.esc(t(b.status))}</span><span>${VR.cell("total", b, side)}</span>${side != "sup" ? `<span class="mu">${U.esc(t(BK.oSt(o)))}</span>` : ""}
  <span class="row" style="margin:0;gap:6px">${UI.btn(t("Aç"), "bxOpen", b.id, "b")}${b.vch ? UI.btn(t("Voucher"), "dv", ["v", b.id]) : ""}${buy && b.status == "Onaylı" ? UI.btn(t("Değiştir"), "bxMod", b.id) : UI.btn(t("Not ekle"), "bxNoteQ", b.id)}</span></div>`; };
A.bxMod = id => { VR.open(id); A.mdOpen(id); };
A.bxNoteQ = id => { VR.open(id); S.bxN = true; };
A.lfSet = ([id, k], el) => { const f = VR.lf(id); f[k] = el.value; PF.set(uid(), "lf_" + id, f); S.bq = 0; };
A.lfQ = (p, el) => { A.lfSet(Array.isArray(p) ? p : [p, "q"], el); };
A.lfClr = id => { PF.set(uid(), "lf_" + id, null); };
A.lcOpen = id => { S.lcOpen = S.lcOpen == id ? "" : id; };
A.lcTog = ([id, c], el) => { const cur = PF.get(uid(), "lc_" + id, null) || VR.DEFC.slice(); const L = el.checked ? U.uniq([...cur, c]) : cur.filter(x => x != c); if (!L.length) return B4M.res.no("En az bir sütun seçin."); PF.set(uid(), "lc_" + id, Object.keys(VR.COLS).filter(x => L.includes(x))); };
A.lcDef = id => { PF.set(uid(), "lc_" + id, null); };
A.lCsv = id => { const x = VR.last[id]; if (!x) return false; const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`, txt = s => String(s).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
  const rows = [x.cols.map(c => t(VR.COLS[c])), ...x.R.map(b => x.cols.map(c => c == "created" ? (X.created(b) || "").slice(0, 16) : c == "travel" ? [b.a, b.b].filter(Boolean).join(" → ") : txt(VR.cell(c, b, x.side))))];
  UI.copy("﻿" + rows.map(r => r.map(q).join(";")).join("\r\n")); return { ok: true, msg: "{n} satır CSV olarak panoya kopyalandı; Excel'e yapıştırabilirsiniz.", p: { n: x.R.length }, noRender: true }; };
/* ---- Back Office → Rezervasyonlar ---- */
VH.res = () => VR.list("hres", db().where("bookings", b => b.oid), { title: "Tüm rezervasyonlar", side: "h" });
/* ---- DMC → Rezervasyon işlemleri ---- */
VB.supRes = dmc => { const isRoot = !P.isSub("s", dmc), all = db().where("bookings", b => b.oid && (b.sup == dmc || (isRoot && P.rootOf("s", b.sup) == dmc)) && (b.kind == "h" || AU.can("or"))), g = {};
  all.filter(b => b.sup == dmc && b.status == "Onaylı" && !b.sp).forEach(b => { const k = BK.supPay(b) + "|" + (b.costCur || b.cur); g[k] = (g[k] || 0) + (b.cost ?? b.total); }); const Pp = Object.entries(g).sort(), MR = db().where("modreq", x => x.sup == dmc && x.state == "Bekliyor");
  return (MR.length ? UI.box(t("Değişiklik talepleri (iade edilemez rezervasyonlar)"), UI.tbl([t("Rezervasyon"), t("Hesap"), t("Talep"), [t("Yeni tutar"), "num"], t("Tarih"), ""], MR.map(r => { const b = db().get("bookings", r.bid); return `<tr class="rw" data-bx="${b.id}"><td>${b.no}<div class="mu">${VC.desc(b.desc)}</div></td><td>${U.esc(P.accName(r.ag))}<div class="mu">${U.esc(r.by)}</div></td><td class="wrap">${U.esc(r.txt)}</td><td class="num">${r.q.price ? I.fm(r.q.cost, b.costCur) : "—"}</td><td>${I.fd(r.at)}</td><td>${UI.btn(t("Onayla"), "mrOk", r.id, "b")} ${UI.btn(t("Reddet"), "mrNo", r.id)}</td></tr>`; })), ' style="border-color:var(--bad)"') : "") +
    VR.list("sres", all, { title: "Size yönlenen rezervasyonlar", side: "sup", cols: ["no", "guest", "svc", "created", "travel", "status", "total", "acct", "dl"], intro: `<p class="mu" style="margin-top:0">${t("Fiyatınız en düşük olduğunda rezervasyon otomatik size gelir ve onay beklenmeden kesinleşir. İptaller burada anında görünür ve e-postanıza bildirim gider. Platform alıcılarına yapılan satışlarda ödemeniz, çıkış tarihinden itibaren iki hafta dolduktan sonraki ilk cuma, fiyatınızın para biriminde yapılır.")}</p>` }) +
    (Pp.length ? UI.box(t("Yaklaşan ödemeleriniz"), UI.tbl([t("Ödeme günü (cuma)"), [t("Tutar"), "num"]], Pp.map(([k, v]) => { const [d, c] = k.split("|"); return `<tr><td>${I.fd(d)}</td><td class="num">${I.fm(v, c)}</td></tr>`; }))) : ""); };
/* ---- diğer rezervasyon tabloları: satırlar tıklanabilir, oluşturma tarihi görünür ---- */
const baseTbl = VB.table; VB.table = (L, o = {}) => { let h = baseTbl(L, o); if (!L.length) return h; let i = -1;
  h = h.replace(/<tr>/g, m => { i++; if (i == 0) return m; const b = L[i - 1]; return b && b.id ? `<tr class="rw" data-bx="${b.id}" tabindex="0">` : m; });
  return h.replace(`<th>${t("Tarih")}</th>`, `<th>${t("Seyahat")}</th>`); };
/* DMC alış/satış raporu: satır tıklanınca mevcut özet (rsx), çift tıkta tam ayrıntı; özet kutusunda "Aç" */
const baseRep = VB.report; VB.report = (dmc, mode) => baseRep(dmc, mode).replace(/<tr style="([^"]*)"><td><button class="lnk" data-a="rsx" data-p="&quot;([bp])(\d+)&quot;"/g, (m, st, k, id) => `<tr class="rw" data-bx="${id}" data-q="${U.esc(JSON.stringify(["rsx", k + id]))}" style="${st}"><td><button class="lnk" data-a="rsx" data-p="&quot;${k}${id}&quot;"`);
const baseRsDet = VB.rsDet; VB.rsDet = r => { const h = baseRsDet(r), b = r.ref; return b && b.no && /^[bp]/.test(r.k) ? h.replace(`${UI.btn(t("Kapat"), "rsx", r.k)}`, `<span>${UI.btn(t("Aç"), "bxOpen", b.id, "b")} ${UI.btn(t("Kapat"), "rsx", r.k)}</span>`) : h; };
/* ---- tıklama: tek tık özet, çift tık ayrıntı (bekleme yok), Ctrl/orta tık yeni sekme ---- */
VR.click = { id: 0, at: 0 };
VR.newWin = id => VR.open(id); /* 2b'de yeni sekmede açar */
if (typeof document != "undefined") {
  document.addEventListener("click", ev => { const tr = ev.target.closest && ev.target.closest("tr[data-bx]"); if (!tr || ev.target.closest("button,a,input,select,textarea,label")) return;
    const id = +tr.getAttribute("data-bx"), now = Date.now();
    if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); VR.newWin(id); return; }
    const dbl = VR.click.id == id && now - VR.click.at < 450; VR.click = { id, at: dbl ? 0 : now };
    if (dbl) { UI.run("bxOpen", id); return; }
    const q = tr.getAttribute("data-q"); if (q) { const [a, p] = JSON.parse(q); UI.run(a, p); } else UI.run("bq", id); });
  document.addEventListener("auxclick", ev => { if (ev.button != 1) return; const tr = ev.target.closest && ev.target.closest("tr[data-bx]"); if (!tr) return; ev.preventDefault(); VR.newWin(+tr.getAttribute("data-bx")); });
  document.addEventListener("keydown", ev => { const tr = ev.target && ev.target.matches && ev.target.matches("tr[data-bx]") ? ev.target : null;
    if (tr && ev.key == "Enter") { ev.preventDefault(); const id = +tr.getAttribute("data-bx"); if (ev.shiftKey) UI.run("bxOpen", id); else { const q = tr.getAttribute("data-q"); if (q) { const [a, p] = JSON.parse(q); UI.run(a, p); } else UI.run("bq", id); } setTimeout(() => { const n = document.querySelector(`tr[data-bx="${id}"]`); if (n) n.focus(); }, 0); return; }
    if (ev.key == "Escape" && S.bx && !document.querySelector("#ov .ovl") && !S.md && !S.bxN) { const ae = document.activeElement; if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return; UI.run("bxClose"); } }, true);
  const st = document.createElement("style"); st.textContent = `tr.rw{cursor:pointer}tr.rw:hover td{background:color-mix(in srgb,var(--ac) 5%,transparent)}tr.rw.sel td{background:var(--bg)}tr.rw:focus-visible{outline:2px solid var(--ac)}tr.bqr td{background:var(--bg);white-space:normal}
.bq{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center}.ra{text-align:end}.bxw .bxtop h2{margin:8px 0 4px;font-size:20px}.bxmeta{display:flex;flex-wrap:wrap;gap:6px 18px}.bxs{background:var(--sf);border:1px solid var(--ln);border-radius:8px;margin:0 0 10px}.bxs h3{margin:0}
.bxh{display:flex;justify-content:space-between;width:100%;background:none;border:0;font:inherit;font-weight:600;padding:10px 14px;cursor:pointer;color:var(--tx);text-align:start}.bxb{padding:0 14px 12px}table.kvt td{white-space:normal;border-bottom:1px solid var(--ln)}table.kvt td:first-child{width:38%}.gl{margin:0;padding-inline-start:20px}.wrap2{white-space:normal}
@media(max-width:767px){.ra{text-align:start}}`; (document.head || document.documentElement).appendChild(st); }
/* menüden başka bir ekrana gidince açık rezervasyon ekranı kapanır */
["hTab", "dTab"].forEach(k => { const f = A[k]; A[k] = x => { S.bx = 0; S.bq = 0; S.md = null; S.iv = 0; return f(x); }; });
