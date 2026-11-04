/* Yama 2a · çekirdek: kullanıcı tercihleri (filtre, sütun, menü), rezervasyon tarih yardımcıları, rezervasyonu kimin görebileceği,
   dashboard için oluşturma / seyahat tarihi seçimi. Arayüz dışıdır; Node testlerinde de yüklenir. */
const db = () => B4M.db, P = B4M.parties, BK = B4M.book, RP = B4M.rep;
/* ---- kullanıcı tercihleri: veri katmanında (cfg "up"), kullanıcı bazında; sunucuya geçişte de taşınır ---- */
const PF = B4M.pref = {};
PF.all = uid => { const m = db().cfg("up") || {}; return m[uid] || {}; };
PF.get = (uid, k, def) => { const v = PF.all(uid)[k]; return v === undefined ? def : v; };
PF.set = (uid, k, v) => { if (!uid) return; const m = { ...(db().cfg("up") || {}) }; m[uid] = { ...(m[uid] || {}), [k]: v }; if (v === undefined || v === null) delete m[uid][k]; db().cfg("up", m); };
/* ---- rezervasyon tarihleri ---- */
const RB2 = B4M.bkx = {};
RB2.order = b => db().get("orders", b.oid) || {};
RB2.created = b => RB2.order(b).at || b.at || "";
RB2.travel = b => [b.a || "", b.b || ""];
RB2.nights = b => b.a && b.b ? Math.max(0, Math.round((new Date(b.b + "T12:00:00Z") - new Date(b.a + "T12:00:00Z")) / 864e5)) : 0;
RB2.daysTo = b => b.a ? Math.round((new Date(b.a + "T12:00:00Z") - new Date(U.today() + "T12:00:00Z")) / 864e5) : null;
RB2.byNo = no => db().find("bookings", b => b.no == no);
/* kim görebilir: Back Office (res yetkisi) hepsini; DMC kendi (kök + alt) tedarik ettiğini ve kendi alıcı hesabıyla aldığını; yetki ayrıca kontrol edilir */
RB2.side = (b, c) => { c = c || B4M.ctx; if (!b || !c.uid) return ""; if (c.org == "h") return "h";
  if (c.org == "s") { const root = B4M.app.tidOf(c.dmc); if (P.rootOf("s", b.sup) == root && (c.dmc == root || b.sup == c.dmc || P.parentOf("s", b.sup) == c.dmc)) return "sup"; const acc = db().get("accounts", P.rootOf("a", b.ag)) || {}; if (acc.buyer == c.dmc || acc.buyer == root) return "buy"; if (b.own && (b.own == c.dmc || b.own == root)) return "sup"; }
  return ""; };
RB2.canSee = (b, u) => { const c = B4M.ctx, s = RB2.side(b); if (!s) return false; u = u || B4M.app.user(); const can = k => u.role == "admin" || (u.perms || []).includes(k);
  return s == "h" ? can("res") : s == "sup" ? can("r") || can("or") : can("by") || can("r"); };
/* ---- dashboard: oluşturma tarihine göre (varsayılan) veya seyahat tarihine göre ---- */
RP.basis = "";
const baseOd = RP.od; RP.od = o => { if (RP.basis != "t") return baseOd(o); const L = (o.items || []).map(id => db().get("bookings", id)).filter(Boolean).map(b => b.a).filter(Boolean).sort(); return L[0] || baseOd(o); };
const baseRows = RP.rsRows; RP.rsRows = dmc => { const R = baseRows(dmc); if (RP.basis == "t") R.forEach(r => { r.at0 = r.at; r.at = r.d || r.at; }); return R; };
