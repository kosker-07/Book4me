/* Yama 2b · Yama 1'den eksik kalanlar (iş kuralları). Arayüz dışı; Node testlerinde de yüklenir.
   E  gelen H2H bağlantısı açılınca tedarikçi API kaydı otomatik kurulur ve bağlanır (test edip açılır) · test konsolu için IN.call kullanılır
   K  tanıtım anlaşması: otel, dönem, tutar, hizmetler; anlaşmadan fatura kesilir
   L  rebooking puanı otomatik: teslim oranı, başarısız teyit/ceza, ödeme gecikmesi, hacim; ağırlıklar Parametreler'de; gece işinde güncellenir */
const db = () => B4M.db, { ok, no } = B4M.res, H2 = B4M.h2h, IN = B4M.int, FN = B4M.fin, RB = B4M.rb, Y1 = B4M.y1, P = B4M.parties, BK = B4M.book, AU = B4M.auth;
/* ---- E: gelen H2H → tedarikçi API ---- */
const baseAdd = H2.add; H2.add = (tid, o) => { const r = baseAdd(tid, o); if (!r.ok || !r.x || r.x.dir != "gelen") return r; const x = r.x;
  const url = /^https:\/\/[^\s]+\.[^\s]+/.test(o.url || "") ? o.url : `https://h2h.${(x.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "partner")}.example/api`;
  const a = db().add("apis", { sv: "h", name: x.name + " (H2H)", proto: IN.APP[0], url, auth: IN.APA[0], key: o.key ? "••••" + String(o.key).slice(-4) : "••••h2h", cur: o.cur || "EUR", env: x.env, mk: 0, timeout: 8, cache: 0, on: false, search: false, test: "Test edilmedi", map: [], h2h: x.id, tid });
  x.api = a.id; B4M.audit.log("h2h.api.bound", x.id, a.name, tid);
  return ok("H2H bağlantısı oluşturuldu ve tedarikçi API adaptörüne bağlandı ({n}). Entegrasyonlar → Tedarikçi API'den test edip açabilirsiniz.", { n: a.name }, { x, api: a }); };
/* mevcut gelen bağlantılar için de (bir kez) */
H2.bindAll = () => { db().where("h2h", x => x.dir == "gelen" && !x.api).forEach(x => { const a = db().add("apis", { sv: "h", name: x.name + " (H2H)", proto: IN.APP[0], url: `https://h2h.${x.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "partner"}.example/api`, auth: IN.APA[0], key: "••••h2h", cur: "EUR", env: x.env, mk: 0, timeout: 8, cache: 0, on: false, search: false, test: "Test edilmedi", map: [], h2h: x.id, tid: x.tid }); x.api = a.id; }); };
H2.EPS = ["content.hotels", "search.hotels", "book", "cancel"];
/* ---- K: tanıtım anlaşması ---- */
const can = k => { const u = B4M.app.user(); return !!u.id && (u.role == "admin" || AU.can(k)); };
FN.addAgr = (tid, o) => { if (String(FN.myTid()) != String(tid)) return no("Bu şirketin kayıtlarına erişiminiz yok."); if (!can("mkt")) return no("Tanıtım anlaşması için yetkiniz yok.");
  const h = db().get("hotels", +o.hid), amt = +o.amt; if (!h) return no("Oteli seçin."); if (!(amt > 0)) return no("Tutarı girin."); if (!o.from || !o.to || o.to < o.from) return no("Geçerli bir dönem girin.");
  const x = db().add("promoAgr", { tid, hid: h.id, hotel: h.name, from: o.from, to: o.to, amt: U.r2(amt), cur: o.cur || "EUR", svc: String(o.svc || "").trim() || "Tanıtım hizmeti", st: "Aktif", inv: [], by: B4M.app.user().name, at: U.now() });
  B4M.audit.log("promo.agreement", x.id, `${x.hotel} ${x.from}–${x.to}`, tid); return ok("Tanıtım anlaşması kaydedildi.", {}, { x }); };
FN.invAgr = id => { const x = db().get("promoAgr", id); if (!x || x.st != "Aktif") return no("Anlaşma aktif değil."); const r = FN.addPromo(x.tid, { hid: x.hid, amt: x.amt, cur: x.cur, d: U.today(), period: `${x.from} – ${x.to}`, desc: x.svc });
  if (r.ok && r.x) { r.x.agr = x.id; x.inv.push(r.x.id); } return r; };
FN.endAgr = id => { const x = db().get("promoAgr", id); if (!x || String(FN.myTid()) != String(x.tid) || !can("mkt")) return no("Bu işlem için yetkiniz yok."); x.st = "Sona erdi"; x.end = U.now(); return ok("Anlaşma sonlandırıldı."); };
/* ---- L: otomatik puan ---- */
Object.assign(Y1.DEF, { rbAuto: 1, rbBase: 40, rbWDel: 40, rbWFail: 10, rbWPay: 15, rbWVol: 20 });
RB.calcScore = tid => { const p = RB.prof(tid); if (!p) return null; const yAgo = U.addD(U.today(), -365), d90 = U.addD(U.today(), -90);
  const del = p.wins + p.fails ? p.wins / (p.wins + p.fails) : 1, fails = Math.min(4, (p.pen || []).filter(x => (x.at || "").slice(0, 10) >= yAgo).length);
  const late = db().where("orders", o => { const a = db().get("accounts", P.rootOf("a", o.ag)) || {}; return a.buyer && B4M.app.tidOf(a.buyer) == tid && !o.auto && BK.oDue(o) > 0 && o.due < U.today(); }).length;
  const vol = db().where("bookings", b => b.oid && P.rootOf("s", b.sup) == tid && b.status == "Onaylı" && (b.at || "").slice(0, 10) >= d90).length;
  const fresh = !p.wins && !p.fails && !vol, parts = { del: U.r2(Y1.prm("rbWDel") * del), fail: -Y1.prm("rbWFail") * fails, pay: late ? -Y1.prm("rbWPay") : 0, vol: Math.min(Y1.prm("rbWVol"), vol * 2) };
  const score = fresh ? Y1.prm("rbNewScore") : Math.max(0, Math.min(100, Math.round(Y1.prm("rbBase") + parts.del + parts.fail + parts.pay + parts.vol)));
  return { score, parts, n: { del: U.r2(del * 100), fails, late, vol }, fresh }; };
RB.autoScoreAll = () => { if (!Y1.prm("rbAuto")) return 0; let n = 0; db().where("dmcs", d => !d.parent).forEach(d => { const c = RB.calcScore(d.id); if (!c) return; const p = RB.prof(d.id); if (p.score != c.score) { p.scoreLog = (p.scoreLog || []).slice(-11); p.scoreLog.push({ at: U.now(), from: p.score, to: c.score }); p.score = c.score; n++; } p.scoreAt = U.now(); }); return n; };
if (B4M.jobs && B4M.jobs.nightly) { const bn = B4M.jobs.nightly; B4M.jobs.nightly = (...a) => { const r = bn(...a); try { RB.autoScoreAll(); } catch (e) { console.error(e); } return r; }; }
/* açılışta bir kez: mevcut gelen H2H bağlantılarını API'ye bağla */
const baseInit = B4M.app.init; B4M.app.init = (...a) => { const d = baseInit(...a); try { if (!d.cfg("u005h2h")) { H2.bindAll(); d.cfg("u005h2h", 1); d.commit(); } } catch (e) { console.error(e); } return d; };
