/* Operasyon ve rehber: rehber ürünleri (satış ve alış fiyatları), hizmet tedarikçileri, rehber satışları (telefon), operasyon düzenlemesi ve onayı,
   tedarikçiye otomatik e-posta, rehber kasası, acente kanalına açılan rehber ürünleri, DMC uçuş API bağlantısı. */
const OP = B4M.ops = {};
const db = () => B4M.db, { ok, no } = B4M.res, PR = B4M.price, P = B4M.parties;
const now = () => U.now(), today = () => U.today();
OP.gp = id => db().get("gprod", id) || { name: "(silinmiş ürün)", sale: { ad: 0, ch: 0, cur: "EUR" }, buy: [], days: [] };
OP.os = id => db().get("opSup", id);
OP.myP = dmc => db().where("gprod", p => p.dmc == dmc);
OP.myOS = dmc => db().where("opSup", x => x.dmc == dmc);
OP.myGS = dmc => db().where("gsales", x => x.dmc == dmc);
OP.guides = dmc => db().where("users", u => u.org == "s" && u.oid == dmc && u.role != "admin" && (u.perms || []).includes("gs"));
OP.amt = (u, pr, s) => U.r2(u == "araç" ? (+pr.ad || 0) : (+pr.ad || 0) * s.ad + (+pr.ch || 0) * s.ch);
OP.sale = s => OP.amt(OP.gp(s.pid).unit, s.sale, s);
OP.cost = s => s.buy ? OP.amt(OP.gp(s.pid).unit, s.buy, s) : null;
OP.stT = st => ({ "Yeni": "Operasyonda", "Düzenlendi": "Onay bekliyor", "Onaylandı": "Onaylandı, tedarikçiye gönderildi", "İptal": "İptal" })[st] || st;
OP.paxT = s => I.tn(s.ad, "yetişkin") + (s.ch ? " + " + I.tn(s.ch, "çocuk") : "") + (s.inf ? " + " + I.tn(s.inf, "bebek") : "");
OP.log = (s, tt, p) => (s.log = s.log || []).push({ at: now(), t: tt, p: p || {} });
OP.best = (p, ad, ch) => { const L = (p.buy || []).filter(b => b.ad > 0 && OP.os(b.sid)).map(b => ({ ...b, t: OP.amt(p.unit, b, { ad, ch }) })).sort((a, b) => PR.cv(a.t, a.cur, "EUR") - PR.cv(b.t, b.cur, "EUR")); return L[0] || null; };
OP.nextNo = () => `RH${today().slice(2, 4)}-${U.pad(db().counter("gs"), 6)}`;
/* ---- rehber paneli ---- */
OP.firstDay = p => { let d = U.addD(today(), 1); for (let i = 0; i < 7 && !p.days.includes(U.wd(d)); i++) d = U.addD(d, 1); return d; };
OP.gdSave = (dmc, gid, f) => {
  const p = OP.gp(f.pid); if (!String(f.cust || "").trim()) return no("Misafir adını girin."); if (!String(f.hotel || "").trim()) return no("Otel adını girin."); if (!f.d || f.d < today()) return no("Geçerli bir tarih seçin."); if (!p.days.includes(U.wd(f.d))) return no("Bu ürün seçilen gün yapılmıyor.");
  if (p.unit == "araç" && f.ad + f.ch + f.inf > (p.max || 8)) return no("Kişi sayısı araç kapasitesini aşıyor."); const bb = OP.best(p, f.ad, f.ch); if (!bb) return no("Bu ürünün alış fiyatı tanımlı değil; alış ve satış tamamlanmadan satış oluşturulamaz. Operasyona bildirin.");
  const s = db().add("gsales", { dmc, tid: B4M.app.tidOf(dmc), no: OP.nextNo(), gid, pid: p.id, d: f.d, cust: f.cust.trim(), phone: (f.phone || "").trim(), hotel: f.hotel.trim(), room: (f.room || "").trim(), ad: f.ad, ch: f.ch, inf: f.inf, sale: { ...p.sale }, paid: !!f.paid, pm: f.paid ? f.pm : "", note: (f.note || "").trim(), at: now(), st: "Yeni", sid: bb.sid, buy: { ad: bb.ad, ch: bb.ch || 0, cur: bb.cur }, pick: p.time || "", pickAt: f.hotel.trim(), cashIn: false, log: [] });
  s.total = OP.sale(s); OP.log(s, s.paid ? "Rehber {g} satışı girdi · ödeme alındı ({m})" : "Rehber {g} satışı girdi · ödeme alınmadı", { g: (db().get("users", gid) || {}).name, m: s.pm });
  B4M.events.emit("guide.sale.created", s.id, s.total, s.sale.cur, dmc); return ok("Satış kaydedildi", null, { s });
};
OP.gdPaid = (id, pm) => { const s = db().get("gsales", id); s.paid = true; s.pm = pm; OP.log(s, "Rehber ödemeyi aldı ({m})", { m: pm }); return ok("Ödeme alındı olarak işaretlendi ({m}).", { m: t(pm) }); };
OP.gdCancel = id => { const s = db().get("gsales", id); if (s.st != "Yeni") return no("Operasyona alınmış satışı yalnızca operasyon iptal edebilir."); s.st = "İptal"; OP.log(s, "Rehber satışı iptal etti"); return ok("Satış iptal edildi."); };
/* ---- operasyon ---- */
OP.rhEdit = (id, o, by) => { const s = db().get("gsales", id); if (!o.sid) return no("Tedarikçi seçin."); if (!(+o.ad > 0)) return no("Alış fiyatını girin."); const was = s.st; Object.assign(s, { sid: +o.sid, buy: { ad: +o.ad, ch: +o.ch || 0, cur: o.cur }, pick: (o.pick || "").trim(), pickAt: (o.pickAt || "").trim(), opNote: (o.note || "").trim(), st: "Düzenlendi", opBy: by }); OP.log(s, "{b} düzenledi: {s}, alış {a}", { b: by, s: OP.os(s.sid).name, a: I.fm(OP.cost(s), s.buy.cur) }); return ok(was == "Yeni" ? "Düzenlendi; yönetici onayına gönderildi." : "Düzenleme güncellendi."); };
OP.mail = (s, kind) => {
  const o = OP.os(s.sid), p = OP.gp(s.pid), c = OP.cost(s);
  B4M.mail.send({ dmc: s.dmc, sup: o && o.sup || 0, gs: s.id, to: o ? o.email || "" : "", subj: `${kind} ${s.no} – ${p.name} – ${s.d}`, tid: B4M.app.tidOf(s.dmc),
    body: `Sayın ${o ? o.name : "tedarikçi"},\n\n${kind == "İptal" ? "Aşağıdaki rezervasyon iptal edilmiştir." : "Aşağıdaki rezervasyonu onayınıza sunarız."}\n\nRezervasyon no: ${s.no}\nHizmet: ${p.name}\nTarih: ${s.d}\nAlış saati / yeri: ${s.pick || "—"} · ${s.pickAt || s.hotel}\nMisafir: ${s.cust}${s.phone ? " · " + s.phone : ""}\nOtel / oda: ${s.hotel}${s.room ? " / " + s.room : ""}\nKişi: ${s.ad} yetişkin${s.ch ? " + " + s.ch + " çocuk" : ""}\nAlış fiyatı: ${I.fm(c, s.buy.cur)}\nNot: ${s.opNote || "—"}\n\n${P.dmcName(s.dmc)} Operasyon` });
  return o && U.isMail(o.email);
};
OP.rhApprove = (id, by) => { const s = db().get("gsales", id), o = OP.os(s.sid); if (s.st != "Düzenlendi") return no("Önce operasyon düzenlemesi yapılmalı."); if (!o || !U.isMail(o.email)) return no("Tedarikçinin e-posta adresi sistemde tanımlı değil. Operasyon → Hizmet tedarikçileri ekranından ekleyin."); s.st = "Onaylandı"; s.okBy = by; s.okAt = now(); OP.mail(s, "Rezervasyon"); OP.log(s, "{b} onayladı; {o} ({e}) adresine alış fiyatıyla e-posta gönderildi", { b: by, o: o.name, e: o.email }); B4M.events.emit("guide.sale.approved", s.id, OP.cost(s), s.buy.cur, s.dmc); return ok("Onaylandı; {o} firmasına e-posta gönderildi.", { o: o.name }); };
OP.rhCancel = (id, by) => { const s = db().get("gsales", id), sent = s.st == "Onaylandı"; s.st = "İptal"; if (sent) OP.mail(s, "İptal"); OP.log(s, sent ? "{b} iptal etti; tedarikçiye iptal e-postası gönderildi" : "{b} iptal etti", { b: by }); return ok(sent ? "İptal edildi; tedarikçiye iptal e-postası gönderildi." : "Satış iptal edildi."); };
/* ---- ürünler ---- */
OP.addProd = (dmc, o) => { if (!o.name) return no("Ürün adını girin."); if (!(+o.ad > 0)) return no("Satış fiyatını girin."); const p = db().add("gprod", { dmc, tid: B4M.app.tidOf(dmc), kind: o.kind, unit: o.unit, name: o.name, region: o.region || "", time: o.time || "", days: [1, 2, 3, 4, 5, 6, 7], sale: { ad: +o.ad, ch: +o.ch || 0, cur: o.cur }, chAge: "3-11", max: 7, buy: [], active: true, desc: "" }); return ok("Ürün eklendi; şimdi tedarikçi ve alış fiyatı ekleyin.", null, { p }); };
OP.setP = (id, k, v) => { const p = OP.gp(id); p[k] = k == "max" ? Math.max(1, +v || 1) : typeof v == "string" ? v.trim() : v; OP.sync(p); return ok("Kaydedildi."); };
OP.setSale = (id, k, v) => { const p = OP.gp(id); p.sale[k] = k == "cur" ? v : Math.max(0, +v || 0); OP.sync(p); return ok("Satış fiyatı güncellendi; rehberler yeni fiyatı hemen görür."); };
OP.togDay = (id, d) => { const p = OP.gp(id); p.days = p.days.includes(d) ? p.days.filter(x => x != d) : [...p.days, d].sort(); OP.sync(p); return ok(""); };
OP.addBuy = (dmc, id) => { const p = OP.gp(id); if (!OP.myOS(dmc).length) return no("Önce Operasyon → Hizmet tedarikçileri ekranından firma tanımlayın."); p.buy.push({ sid: OP.myOS(dmc)[0].id, ad: 0, ch: 0, cur: p.sale.cur }); return ok(""); };
OP.setBuy = (id, i, k, v) => { OP.gp(id).buy[i][k] = k == "cur" ? v : +v; OP.sync(OP.gp(id)); return ok(""); };
OP.delBuy = (id, i) => { OP.gp(id).buy.splice(i, 1); OP.sync(OP.gp(id)); return ok(""); };
OP.addSup = (dmc, n, e, ph) => { if (!n) return no("Firma adını girin."); if (!U.isMail(e)) return no("Geçerli bir e-posta adresi girin; onaylanan satışlar buraya gider."); db().add("opSup", { dmc, tid: B4M.app.tidOf(dmc), name: n, email: e, phone: ph || "", sup: 0 }); return ok("Tedarikçi eklendi."); };
OP.setSup = (id, k, v) => { if (k == "email" && v && !U.isMail(String(v).trim())) return no("Geçerli bir e-posta adresi girin."); OP.os(id)[k] = typeof v == "string" ? v.trim() : v; return ok("Kaydedildi."); };
OP.addGuide = (dmc, n, e, r) => { if (!n) return no("Ad soyad girin."); if (e && !U.isMail(e)) return no("Geçerli bir e-posta girin."); const pw = B4M.auth.tempPw(); B4M.auth.addUserRaw({ org: "s", oid: dmc, name: n, email: e, role: "user", dept: "Rehber", perms: ["gs"], unit: r || "", tid: B4M.app.tidOf(dmc), pw }); B4M.events.emit("user.created", n, 0, "TRY", dmc); return ok("Rehber hesabı açıldı. Geçici şifre: {pw}", { pw }); };
OP.togGuide = id => { const g = db().get("users", id); g.active = !g.active; return ok(g.active ? "Kullanıcı aktif." : "Kullanıcı pasif; giriş yapamaz."); };
OP.cashIn = (dmc, gid, by) => { const L = OP.myGS(dmc).filter(s => s.gid == gid && s.paid && s.pm == "Nakit" && !s.cashIn && s.st != "İptal"); L.forEach(s => { s.cashIn = true; OP.log(s, "Nakit firma kasasına teslim alındı ({b})", { b: by }); }); B4M.events.emit("guide.cash.received", gid, L.reduce((a, s) => a + s.total, 0), "EUR", dmc); return ok("{n} satışın nakdi teslim alındı.", { n: L.length }); };
OP.supPaid = (id, by) => { const s = db().get("gsales", id); s.supPaid = today(); OP.log(s, "Hizmet tedarikçisine ödendi ({b})", { b: by }); return ok("Ödeme işaretlendi."); };
OP.payables = dmc => OP.myGS(dmc).filter(s => s.st == "Onaylandı" && s.buy);
/* rehber ürünlerini acentelere aç: platform turu olarak yayınla (önümüzdeki 120 gün) */
OP.sync = p => {
  const i = db().all("tours").findIndex(x => x.gp == p.id), ch = p.ch || {}, on = p.active && p.kind == "u" && (ch.hq || ch.own) && (p.net || {}).ad > 0 && !!OP.best(p, 1, 0);
  if (!on) { const T = db().all("tours"); if (i >= 0 && !db().find("bookings", b => b.tid == T[i].id)) db().del("tours", T[i].id); else if (i >= 0) T[i].chs = { hq: false, own: false }; return; }
  const ds = []; let d = today(); for (let k = 0; k < 120; k++) { if (p.days.includes(U.wd(d))) ds.push(d); d = U.addD(d, 1); }
  const x = i >= 0 ? db().all("tours")[i] : db().add("tours", { sup: p.dmc, tid: B4M.app.tidOf(p.dmc), gp: p.id });
  Object.assign(x, { name: p.name, city: p.region || "Antalya", dur: p.time ? `hareket ${p.time}` : "1 gün", price: p.net.ad, cur: p.sale.cur, quota: p.quota || 40, dates: ds, cxd: 1, chs: { hq: !!ch.hq, own: !!ch.own } });
};
OP.setCh = (id, k, v) => { const p = OP.gp(id); p.ch = { ...(p.ch || {}), [k]: v }; let msg = ""; if (v && !((p.net || {}).ad > 0)) { p.net = { ad: U.r2(p.sale.ad * .8) }; msg = "Acente net fiyatı satış fiyatının %80'i olarak önerildi; değiştirebilirsiniz."; } OP.sync(p); return ok(msg); };
OP.setNet = (id, v) => { const p = OP.gp(id); p.net = { ad: Math.max(0, +v || 0) }; OP.sync(p); return ok("Acente net fiyatı kaydedildi."); };
OP.setQ = (id, v) => { const p = OP.gp(id); p.quota = Math.max(1, +v || 1); OP.sync(p); return ok(""); };
/* acente rezervasyonu → DMC rehberlik satış kaydı */
OP.fromBooking = b => {
  if (b.kind != "u") return; const x = db().get("tours", b.tid); if (!x || !x.gp) return; const p = OP.gp(x.gp), n = (b.guests || []).length || 1;
  const s = { dmc: p.dmc, tid: B4M.app.tidOf(p.dmc), src: "ag", ag: b.ag, bno: b.no, bid: b.id, no: OP.nextNo(), gid: 0, pid: p.id, d: b.a, cust: (b.guests || [])[0] || "", phone: "", hotel: "", room: "", ad: n, ch: 0, inf: 0, sale: { ad: x.price, ch: 0, cur: x.cur }, paid: true, pm: "Acente", note: b.note || "", at: now(), st: "Yeni", sid: 0, buy: null, pick: p.time || "", pickAt: "", cashIn: true, log: [] };
  const bb = OP.best(p, n, 0); if (bb) { s.sid = bb.sid; s.buy = { ad: bb.ad, ch: bb.ch || 0, cur: bb.cur }; }
  s.total = U.r2(x.price * n); OP.log(s, "Acente rezervasyonu {no} ({a}) ile geldi", { no: b.no, a: P.accName(b.ag) }); db().add("gsales", s);
};
OP.onBookingCancel = b => { const s = db().find("gsales", x => x.bid == b.id); if (!s || s.st == "İptal") return; const sent = s.st == "Onaylandı"; s.st = "İptal"; if (sent) OP.mail(s, "İptal"); OP.log(s, "Acente rezervasyonu iptal edildi"); };
/* ---- DMC uçuş API bağlantısı ---- */
OP.saveApi = (dmc, o) => { const s = db().get("dmcs", dmc); if (!/^https:\/\/.+/.test(o.url || "")) return no("API adresi https:// ile başlamalı."); if (!o.key) return no("API anahtarını gir."); s.api = { name: o.name || "Uçuş API", url: o.url, key: o.key, on: !!o.on, test: (s.api || {}).test || "" }; B4M.events.emit("supplier.api.saved", dmc, 0, "TRY", dmc); return ok("API bağlantısı kaydedildi."); };
OP.testApi = dmc => { const s = db().get("dmcs", dmc); if (!s.api || !s.api.url) return no("Önce bağlantıyı kaydet."); s.api.test = now(); const n = B4M.search.apiFlights("İstanbul (IST)", "Antalya (AYT)", U.addD(today(), 7), 1, { ag: 0 }).length; return ok("Test başarılı (simülasyon): örnek rotada {n} uçuş döndü.", { n }); };
OP.saveMail = (dmc, v) => { if (!U.isMail(v)) return no("Geçerli bir e-posta adresi gir."); db().get("dmcs", dmc).email = v; return ok("Bildirim adresi kaydedildi."); };
