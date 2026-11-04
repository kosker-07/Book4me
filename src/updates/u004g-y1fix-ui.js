/* Yama 2a · Yama 1'den eksik kalanlar (ekranlar): A5 kutu adları · B2 firma × kova ve ödenmediği için iptal edilenler · B4 kartlarda önceki döneme göre % ·
   D fiyat analizinde CSV · F Legal'de şart değiştirme · H prim kuralı adı · I yöneticinin maaş talebi onayı · J ek finans göstergeleri, DMC bütçesi ·
   K tanıtım mahsupları DMC ödemelerinde ve DMC'nin platform alacaklarında. */
const UI = B4M.ui, A = UI.A, S = UI.S, db = () => B4M.db, P = B4M.parties, VY = B4M.vY1, V = VY.V, FN = B4M.fin, RP = B4M.rep, VD = B4M.vDash, VH = B4M.vHQ, VM = B4M.vDMC, VC = B4M.vCommon, VA = B4M.vAcc, SF = B4M.salFlow, NT = B4M.notif, BK = B4M.book, MW = B4M.myWork, LG = B4M.legal, FA = B4M.fa;
const fE = v => v == null ? "—" : I.fm(U.r2(v || 0), "EUR"), E = (v, c) => B4M.price.cv(+v || 0, c || "EUR", "EUR");
/* ---- A5: Platform markup kutu adları v40 gibi ---- */
const baseMk = VH.markup; VH.markup = () => baseMk().split(t("Alıcı hesapları (DMC bazında)")).join(t("Acente profitleri")).split(t("Satıcı DMC'ler")).join(t("DMC profitleri"));
/* ---- B2 + B4: dashboard ---- */
const baseExtra = VD.extra; VD.extra = tid => { const h = baseExtra(tid), bo = tid == "P", from = RP.from(S.dbp), O = FN.openOrders(tid), m = {};
  O.forEach(o => { const a = P.rootOf("a", o.ag), g = Math.round((Date.parse(U.today()) - Date.parse(o.due)) / 864e5), k = o.due >= U.today() ? "nd" : g <= 7 ? "a7" : g <= 30 ? "a30" : "a99", x = m[a] = m[a] || { name: P.accName(a), nd: 0, a7: 0, a30: 0, a99: 0, t: 0 }; const v = E(BK.oDue(o), o.cur); x[k] += v; x.t += v; });
  const firms = UI.box(t("Alacak yaşlandırma · firma bazında"), UI.tbl([t("Firma"), ...FN.AGE.map(([, l]) => [t(l), "num"]), [t("Toplam"), "num"]], Object.values(m).sort((a, b) => b.t - a.t).map(x => `<tr><td>${U.esc(x.name)}</td>${FN.AGE.map(([k]) => `<td class="num ${k != "nd" && x[k] > 0 ? "bad" : ""}">${x[k] ? fE(x[k]) : "—"}</td>`).join("")}<td class="num"><b>${fE(x.t)}</b></td></tr>`), t("Açık alacak yok.")));
  const auto = db().where("orders", o => o.auto && RP.od(o) >= from && (bo || BK.oBks(o).some(b => b.own == tid))).reverse();
  const ab = UI.box(t("Ödenmediği için otomatik iptal edilenler"), UI.tbl([t("Rezervasyon"), t("Firma"), t("Oluşturma"), t("Son ödeme"), [t("Tutar"), "num"], ""], auto.map(o => `<tr class="rw" data-bx="${o.items[0]}"><td>${U.esc(o.no)}</td><td>${U.esc(P.accName(o.ag))}</td><td>${I.fd(o.at)}</td><td>${I.fd(o.due)}</td><td class="num">${I.fm(o.total, o.cur)}</td><td>${UI.btn(t("Aç"), "bxOpen", o.items[0])}</td></tr>`), t("Seçili dönemde ödenmediği için iptal edilen rezervasyon yok.")));
  const i = h.indexOf(`<div class="box"><h2>${t("Gecikmeli firmalar")}`); return i < 0 ? h + firms + ab : h.slice(0, i) + firms + h.slice(i) + ab; };
/* kartların altında önceki döneme göre değişim (akış göstergeleri; anlık bakiyeler için dönem karşılaştırması yapılmaz) */
const D4 = B4M.kpiDelta = { v: {} };
D4.winH = (a, b) => { const B = db().where("bookings", x => { if (!x.oid) return false; const d = RP.od(db().get("orders", x.oid) || {}); return d >= a && d <= b; }), ok = B.filter(x => x.status == "Onaylı"), O = new Set(ok.map(x => x.oid));
  const gross = ok.reduce((s, x) => s + RP.eur(x.total, x.cur), 0); return { gmv: gross, mk: ok.reduce((s, x) => s + RP.eur((x.mg || {}).hq, x.cur), 0), avg: O.size ? gross / O.size : 0, cx: B.length ? B.filter(x => x.status.startsWith("İptal")).length / B.length * 100 : 0, comm: db().where("commissions", c => c.at.slice(0, 10) >= a && c.at.slice(0, 10) <= b).reduce((s, c) => s + (c.totalE || 0), 0) }; };
D4.winS = (dmc, a, b, sc) => { const d = sc.dept, rf = d == "Product" || d == "Rezervasyon" ? r => r.sv == "h" : d == "Operasyon" ? r => r.sv != "h" : d == "Rehber" ? r => r.ch == "Rehber" : () => true, R = RP.rsRows(dmc).filter(r => (r.at || "").slice(0, 10) >= a && (r.at || "").slice(0, 10) <= b && r.act && rf(r));
  return { sales: R.filter(r => r.sell).reduce((s, r) => s + RP.eur(r.sell.amt, r.sell.cur), 0), profit: R.reduce((s, r) => s + (r.prE || 0), 0) }; };
["hq", "dmc"].forEach(k => { const f = VD[k]; VD[k] = (...a) => { const h = f(...a); try { const pw = VD.prevWin(S.dbp); D4.v = {}; if (pw) { const from = RP.from(S.dbp), today = U.today();
  if (k == "hq") { const c = D4.winH(from, today), p = D4.winH(pw[0], pw[1]); Object.keys(c).forEach(x => D4.v[x] = [c[x], p[x], x != "cx"]); }
  else { const sc = RP.scope("s"); if (sc) { const c = D4.winS(a[0], from, today, sc), p = D4.winS(a[0], pw[0], pw[1], sc); Object.keys(c).forEach(x => D4.v[x] = [c[x], p[x], true]); } } } } catch (e) { D4.v = {}; } return h; }; });
D4.apply = root => { if (!root) return; root.querySelectorAll(".kpi.y1c").forEach(el => { let k; try { k = JSON.parse(el.getAttribute("data-p")); } catch (e) { return; } const d = D4.v[k]; if (!d || el.querySelector(".dlt")) return; const [c, p, up] = d;
  const x = document.createElement("div"); x.className = "mu dlt"; if (!p) { x.textContent = t("önceki dönemde veri yok"); } else { const pc = (c - p) / Math.abs(p) * 100, good = up ? pc >= 0 : pc <= 0; x.innerHTML = `<b class="${good ? "ok" : "bad"}">${pc >= 0 ? "+" : ""}${I.num(pc, 1)}%</b> ${U.esc(t("önceki döneme göre"))}`; } el.appendChild(x); }); };
const baseRender = UI.render; UI.render = () => { baseRender(); try { if (typeof document != "undefined") D4.apply(document.getElementById("app")); } catch (e) { } };
/* ---- D: fiyat analizinde CSV ---- */
const baseFa = V.fa; V.fa = tid => { const h = baseFa(tid); return h.replace(`${UI.btn(t("Analiz et"), "faRun", null, "b")}`, `${UI.btn(t("Analiz et"), "faRun", null, "b")}${UI.btn(t("CSV kopyala"), "faCsv", tid)}`); };
A.faCsv = tid => { const f = S.faF || {}, q = v => `"${String(v ?? "").replace(/"/g, '""')}"`, n = v => v == null ? "" : String(U.r2(v)).replace(".", ","); let rows;
  if ((S.faM || "h") == "p") { const R = FA.portfolio(tid, f.from, f.to, f.n, f.nat); rows = [[t("Otel"), t("Şehir"), t("Platformdaki teklif"), t("Fiyatlı gün"), t("En ucuz olduğunuz gün"), t("En ucuza ortalama fark")], ...R.map(r => [r.name, r.city, r.comp, r.days, tid == "P" ? "" : r.cheapest, tid == "P" ? "" : n(r.gapAvg)])]; }
  else { const G = FA.groups(), keys = Object.keys(G), key = keys.includes(S.faKey) ? S.faKey : keys.filter(k => tid == "P" || G[k].some(h => B4M.app.tidOf(h.sup) == tid)).sort()[0]; if (!key) return false; const R = FA.analyze({ key, from: f.from, to: f.to, n: f.n, ad: f.ad, nat: f.nat, tid });
    rows = [[t("Giriş"), ...(R.mine ? [t("Sizin fiyatınız"), t("Sıranız")] : []), t("En düşük"), t("Ortalama"), t("En yüksek"), t("Teklif sayısı")], ...R.rows.map(r => [r.d, ...(R.mine ? [n(r.my), r.rank ? r.rank + "/" + r.n : ""] : []), n(r.min), n(r.avg), n(r.max), r.offers.length])]; }
  UI.copy("﻿" + rows.map(r => r.map(q).join(";")).join("\r\n")); return { ok: true, msg: "{n} satır CSV olarak panoya kopyalandı; Excel'e yapıştırabilirsiniz.", p: { n: rows.length - 1 }, noRender: true }; };
/* ---- F: Legal'de şart değiştirme ---- */
const baseLg = V.cmLegal; V.cmLegal = () => { const h = baseLg(), K = db().all("contracts"), c = K.find(k => k.id == S.lgK) || K[0]; if (!c || !LG.can()) return h;
  const box = UI.box(t("Şartları değiştir"), `<p class="mu" style="margin-top:0">${t("Hizmetler ve para birimleri sözleşmede kalır; burada geçerlilik tarihleri ve ek şartlar değiştirilir. Değişiklik sürüm olarak kaydedilir ve karşı tarafa bildirilir.")}</p><div class="row">${UI.fld(t("Başlangıç"), UI.in("lg_s", c.start, "", "date"), 180)}${UI.fld(t("Bitiş"), UI.in("lg_e", c.end, "", "date"), 180)}</div><label>${t("Ek şartlar")}<textarea id="lg_x" rows="4">${U.esc(c.extra || "")}</textarea></label><div class="row" style="margin-top:8px">${UI.btn(t("Şartları kaydet"), "lgTerms", c.id, "b")}</div>`);
  const i = h.indexOf(`<div class="box"><h2>${t("Sözleşme metni (güncel)")}`); return i < 0 ? h + box : h.slice(0, i) + box + h.slice(i); };
A.lgTerms = id => { const c = P.K(id); return LG.saveTerms(id, { curs: c.curs, services: c.services, start: UI.val("lg_s"), end: UI.val("lg_e"), extra: UI.val("lg_x") }); };
/* ---- H: prim kuralı adı ---- */
const baseBon = V.f_fbon; V.f_fbon = tid => { let h = baseBon(tid); const Rl = db().where("bonusRules", r => r.tid == tid).reverse(), cut = h.indexOf(`<h2>${t("Hesaplanan primler")}`), a = cut < 0 ? h : h.slice(0, cut), b = cut < 0 ? "" : h.slice(cut);
  let i = -1; const k0 = `<label style="max-width:280px">${t("Kime")}<select id="bn_u"`, a2 = a.replace(k0, UI.fld(t("Kural adı"), UI.in("bn_n", "", `placeholder="${U.esc(t("Ör. Satış ekibi kâr primi"))}"`), 240) + k0).replace(`<th>${t("Kime")}</th>`, `<th>${t("Kural adı")}</th><th>${t("Kime")}</th>`)
    .replace(/<tr><td>/g, m => { i++; const r = Rl[i]; return r ? `<tr><td>${U.esc(r.name || "—")}</td><td>` : m; });
  return a2 + b; };
const baseBnSet = A.bnSet; A.bnSet = tid => { const name = UI.val("bn_n"), r = baseBnSet(tid); if (r && r.ok && r.x) r.x.name = String(name || "").trim(); return r; };
/* ---- I: yöneticinin maaş talebi onayı (Hesabım) ---- */
const baseAcc = VC.account; VC.account = () => { const h = baseAcc(), L = SF.forMe(); if (!L.length) return h;
  return h + UI.box(t("Ekibimin maaş talepleri"), `<p class="mu" style="margin-top:0">${t("Onayladığınız talep Muhasebe'nin onayına gider; Muhasebe onaylayınca yeni maaş gelecek aydan geçerli olur.")}</p>` + UI.tbl([t("Tarih"), t("Çalışan"), [t("Talep"), "num"], t("Not"), ""], L.map(x => `<tr><td>${I.fd(x.at)}</td><td>${U.esc(x.name)} <span class="mu">${U.esc(t(x.dept || ""))}</span></td><td class="num">${I.fm(x.amt, x.cur)}</td><td>${U.esc(x.note)}</td><td>${UI.btn(t("Onayla"), "sfDec", [x.id, 1], "b")} ${UI.btn(t("Reddet"), "sfDec", [x.id, 0])}</td></tr>`)), ' id="salmgr"'); };
A.sfDec = ([id, y]) => SF.decide(id, !!y);
const baseItems = MW.items; MW.items = () => { const L = baseItems(), n = SF.forMe().length; if (n) L.splice(1, 0, ["Ekibimin maaş talepleri (yönetici onayı)", n, B4M.ctx.org == "h" ? "hTab" : "dTab", "pw"]); return L; };
/* ---- J: ek finans göstergeleri ---- */
const baseFr = V.f_fr; V.f_fr = tid => { const h = baseFr(tid), m = S.fM || VY.thisM(), x = FN.extra(tid, m), px = FN.extra(tid, FN.addM(m, -1)), ly = FN.extra(tid, FN.addM(m, -12));
  const tb = UI.tbl([t("Gösterge"), [t("Bu ay"), "num"], [t("Önceki ay"), "num"], [t("Geçen yıl aynı ay"), "num"]], [["Rezervasyon başına net gelir", "perBk"], ["Tahsil edilen", "collected"]].map(([l, k]) => `<tr><td>${t(l)}</td><td class="num">${fE(x[k])}</td><td class="num">${fE(px[k])}</td><td class="num">${fE(ly[k])}</td></tr>`));
  const pay = `<p style="margin:8px 0 0">${t(tid == "P" ? "Ödenecek (DMC'lere, mahsuplar düşülmüş)" : "Ödenecek (hizmet tedarikçileri ve satın almalarınız)")}: <b>${fE(x.payable)}</b> <span class="mu">${t("bugün itibarıyla açık")}</span></p>`;
  const st = tid == "P" ? UI.box(t("Çalışan kârlılığı · {m}", { m }), `<p class="mu" style="margin-top:0">${t("Back Office'te rezervasyonu çalışan yapmadığı için kişi başına katkı, departmanın net katkısının (departman geliri − departman giderleri) departmandaki kişi sayısına bölünmesiyle bulunur.")}</p>` + UI.tbl([t("Çalışan"), t("Departman"), [t("İşveren maliyeti"), "num"], [t("Prim"), "num"], [t("Kişi başı departman katkısı"), "num"]], x.staff.map(s => `<tr><td>${U.esc(s.name)}</td><td>${U.esc(t(s.dept))}</td><td class="num">${fE(s.cost)}</td><td class="num">${fE(s.bonus)}</td><td class="num ${s.share == null ? "" : s.share < 0 ? "bad" : "ok"}">${s.share == null ? "—" : fE(s.share)}</td></tr>`), t("Çalışan yok."))) : "";
  return h + UI.box(t("Ek göstergeler"), tb + pay) + st; };
/* DMC bütçesi */
V.s_mbd = () => V.f_fbud(VY.tid()); VM.PK.mbd = "fin";
/* ---- K: tanıtım mahsupları ---- */
const offBox = dmc => { const L = FN.offs(dmc); if (!L.length) return ""; return UI.box(t("Tanıtım faturası mahsupları"), `<p class="mu" style="margin-top:0">${t("Platformun otellere kestiği ve ödemeden mahsup edilen tanıtım faturaları, platformun DMC'ye ödeyeceği tutardan düşülür.")}</p>` + UI.tbl([t("Fatura"), t("Tarih"), ...(dmc == null ? [t("DMC")] : []), t("Otel"), [t("Tutar"), "num"], [t("EUR"), "num"]], L.map(x => `<tr><td>${U.esc(x.no)}</td><td>${I.fd(x.off.at)}</td>${dmc == null ? `<td>${U.esc(P.dmcName(x.off.dmc))}</td>` : ""}<td>${U.esc(x.hotel)}</td><td class="num">${I.fm(x.amt, x.cur)}</td><td class="num">${fE(x.off.e)}</td></tr>`))); };
const baseDp = VY.dp; VY.dp = () => baseDp() + offBox(null);
const baseRecv = VA.dmcRecv; VA.dmcRecv = dmc => baseRecv(dmc) + offBox(B4M.app.tidOf(dmc));
/* bildirimlerden git */
const baseGo = A.ntfGo; A.ntfGo = id => { const n = db().get("notifs", id); if (!n) return; const h = B4M.ctx.org == "h", go = (tab, x) => { Object.assign(S, { tab, sub: "", hs: 0 }, x || {}); };
  if (n.kind == "promo") { NT.markRead(id); S.ntf = false; return h ? go("acc", { acT: "fpro" }) : go("mtn"); }
  if (n.kind == "promoff") { NT.markRead(id); S.ntf = false; return go("mp"); }
  if (n.kind == "salmgr") { NT.markRead(id); S.ntf = false; return go("pw"); }
  return baseGo(id); };
if (typeof document != "undefined") { const st = document.createElement("style"); st.textContent = `.dlt{margin-top:2px}`; (document.head || document.documentElement).appendChild(st); }
