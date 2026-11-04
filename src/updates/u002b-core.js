/* Yama 1 · çekirdek
   - Yeni departmanlar: Product / Otel Kontrat, Commercial (Satış, Pazarlama, Sözleşme takibi, Legal). Eski Satış ve Kontrat Commercial'a taşınır.
   - Yeni yetkiler (yönetici kullanıcı bazında verir), açılışta veri taşıma ve örnek veri.
   - Parametreler (oranlar, eşikler) tek yerde ve düzenlenebilir.
   - Bildirimler: olaylardan ilgili departmana. */
const AU = B4M.auth, ST = B4M.store, db = () => B4M.db, { ok, no } = B4M.res, P = B4M.parties;
const Y1 = B4M.y1 = { hooks: [] };
/* ---- yeni koleksiyonlar ve kiracı kuralları ---- */
const NEWC = { notifs: r => [r.tid], expenses: r => [r.tid], salaries: r => [r.tid], salReq: r => [r.tid], bonusRules: r => [r.tid], promoAgr: r => [r.tid], promoInv: r => [r.tid],
  budgets: r => [r.tid], rbAuctions: r => ["P"], rbBids: r => ["P"], rbRev: r => ["P"], h2h: r => [r.tid], kVers: r => [r.tid, r.ptid], hkDocs: r => [r.tid] };
Object.keys(NEWC).forEach(c => { if (!ST.COLLS.includes(c)) ST.COLLS.push(c); ST.TENANT[c] = NEWC[c]; });
/* ---- departmanlar ---- */
Y1.OLD_H = ["Kontrat", "Satış"];
AU.DEPTS.h = ["DMC", "Product / Otel Kontrat", "Commercial", "Muhasebe", "Operasyon", "Rehber", "Diğer"];
const addP = (org, L) => L.forEach(p => { if (!AU.PERMS[org].some(x => x[0] == p[0])) AU.PERMS[org].push(p); });
addP("h", [["hk", "Product · Otel kontratları"], ["stop", "Product · Stop sale koyma / kaldırma"], ["spo", "Product · SPO oluşturma / durdurma"], ["fa", "Fiyat analizi"],
  ["cs", "Commercial · Satış"], ["mkt", "Commercial · Pazarlama ve tanıtım faturaları"], ["mkti", "Commercial · Tanıtım faturası onaylama"], ["kt", "Commercial · Sözleşme takibi"], ["legal", "Commercial · Legal (sözleşme değişikliği, özel şart)"],
  ["rb", "Rebooking yönetimi"], ["exp", "Muhasebe · Giderler"], ["sal", "Muhasebe · Maaşlar ve maaş talepleri"], ["bon", "Muhasebe · Prim kuralları"], ["fin", "Muhasebe · Finans raporları"]]);
addP("s", [["hk", "Product · Otel kontratları"], ["stop", "Product · Stop sale koyma / kaldırma"], ["spo", "Product · SPO oluşturma / durdurma"], ["fa", "Product · Fiyat analizi"], ["rbt", "Product · Fiyat takibi"],
  ["rb", "Rezervasyon · Rebooking teklifleri"], ["mkt", "Tanıtım faturaları"], ["exp", "Muhasebe · Giderler"], ["sal", "Muhasebe · Maaşlar ve maaş talepleri"], ["bon", "Muhasebe · Prim kuralları"], ["fin", "Muhasebe · Finans raporları"]]);
Object.assign(AU.TPL.h, { "Product / Otel Kontrat": ["hk", "stop", "spo", "e", "fa", "res"], Commercial: ["s", "a", "k", "e", "pr", "lic", "cs", "mkt", "kt", "res"], Muhasebe: ["res", "acc", "int", "exp", "sal", "bon", "fin", "mkti"] });
AU.TPL.s.Product = U.uniq([...AU.TPL.s.Product, "hk", "stop", "spo", "fa", "rbt"]); AU.TPL.s.Rezervasyon = U.uniq([...AU.TPL.s.Rezervasyon, "rb"]); AU.TPL.s.Muhasebe = U.uniq([...AU.TPL.s.Muhasebe, "exp", "sal", "bon", "fin", "mkt"]);
/* kısım dashboard'ları yeni departmanlarda da çalışsın */
if (B4M.rep && B4M.rep.DBSEC) { const H = B4M.rep.DBSEC.h; H.Commercial = U.uniq([...(H.Kontrat || []), ...(H["Satış"] || [])]); H["Product / Otel Kontrat"] = ["sales", "mix", "dmc"]; const N = B4M.rep.DBNOTE && B4M.rep.DBNOTE.h; if (N) { N.Commercial = N.Commercial || N["Satış"] || ""; N["Product / Otel Kontrat"] = N["Product / Otel Kontrat"] || N.DMC || ""; } }
/* ---- parametreler: tek yerde, Back Office'ten değiştirilebilir ---- */
Y1.DEF = { sgkEr: 21.75, unempEr: 2, rbPenalty: 10, rbMinPct: 2, rbMinEur: 10, rbA: 80, rbB: 50, rbNewScore: 65, turizmPayi: 0.075 };
Y1.prm = k => { const p = db().cfg("y1prm") || {}; return p[k] ?? Y1.DEF[k]; };
Y1.setPrm = (k, v) => { const p = { ...(db().cfg("y1prm") || {}) }; if (v === "" || v == null || isNaN(+v)) return no("Geçerli bir değer girin."); p[k] = +v; db().cfg("y1prm", p); B4M.audit.log("param.updated", k, String(v), "P"); return ok("Kaydedildi."); };
/* ---- açılış kancası: veri taşıma (her açılışta, tekrar edilebilir) ve bir kez örnek veri ---- */
Y1.migrate = () => {
  const d = db(); d.where("users", u => u.org == "h" && Y1.OLD_H.includes(u.dept)).forEach(u => { u.dept = "Commercial"; u.perms = U.uniq([...(u.perms || []), "cs", "kt"]); });
  d.where("users", u => u.org == "s" && (u.perms || []).includes("h") && !u.y1).forEach(u => { u.perms = U.uniq([...u.perms, "hk", "stop", "spo", "fa", "rbt"]); });
  d.where("users", u => u.org == "s" && (u.perms || []).includes("r") && !u.y1).forEach(u => { u.perms = U.uniq([...u.perms, "rb"]); });
  d.where("users", u => (u.perms || []).includes("acc") && !u.y1).forEach(u => { u.perms = U.uniq([...u.perms, "exp", "sal", "bon", "fin", ...(u.org == "s" ? ["mkt"] : ["mkti"])]); });
  d.where("users", u => u.org == "h" && (u.perms || []).includes("k") && !u.y1).forEach(u => { u.perms = U.uniq([...u.perms, "kt"]); });
  d.where("users", u => u.org == "h" && (u.perms || []).includes("e") && !u.y1).forEach(u => { u.perms = U.uniq([...u.perms, "hk", "fa"]); });
  d.all("users").forEach(u => { u.y1 = 1; });
};
Y1.ready = () => { if (!db()) return; Y1.migrate(); if (!db().cfg("y1seed")) { Y1.hooks.forEach(f => { try { f.seed && f.seed(); } catch (e) { console.error(e); } }); db().cfg("y1seed", 1); } Y1.hooks.forEach(f => { try { f.ready && f.ready(); } catch (e) { console.error(e); } }); db().commit(); };
const baseInit = B4M.app.init; B4M.app.init = (...a) => { const r = baseInit(...a); const d = B4M.db, br = d.reset; d.reset = fn => { const x = br(fn); Y1.ready(); return x; }; Y1.ready(); return r; };
/* ---- bildirimler ---- */
const NT = B4M.notif = {};
NT.push = o => db().add("notifs", { tid: o.tid || "P", depts: o.depts || [], perms: o.perms || [], title: o.title, tp: o.tp || {}, kind: o.kind || "", ref: o.ref ?? "", at: U.now(), read: [] });
NT.tidOfUser = u => u.org == "h" ? "P" : u.org == "s" ? B4M.app.tidOf(u.oid) : "a" + u.oid;
NT.forUser = u => { u = u || B4M.app.user(); if (!u.id) return []; const tid = NT.tidOfUser(u); return db().where("notifs", n => n.tid == tid && (u.role == "admin" || n.depts.includes(u.dept) || n.perms.some(p => (u.perms || []).includes(p)) || (!n.depts.length && !n.perms.length))).sort((a, b) => b.id - a.id); };
NT.unread = u => { u = u || B4M.app.user(); return NT.forUser(u).filter(n => !n.read.includes(u.id)); };
NT.markRead = (id, u) => { u = u || B4M.app.user(); const n = db().get("notifs", id); if (n && !n.read.includes(u.id)) n.read.push(u.id); return ok(""); };
NT.markAll = u => { u = u || B4M.app.user(); NT.unread(u).forEach(n => n.read.push(u.id)); return ok("Tümü okundu olarak işaretlendi."); };
/* olay → bildirim kuralları */
NT.RULES = {
  "hotel.created": (e) => { const h = db().get("hotels", +e.ref); if (!h) return; NT.push({ tid: "P", depts: ["Product / Otel Kontrat"], perms: ["hk"], title: "Yeni otel: {h} ({c})", tp: { h: h.name, c: h.city }, kind: "hotel", ref: h.id });
    db().where("dmcs", d => !d.parent && d.id != B4M.app.tidOf(h.sup)).forEach(d => NT.push({ tid: d.id, depts: ["Product"], perms: ["fa"], title: "Platforma yeni otel eklendi: {h} ({c}). Fiyat analizinden karşılaştırabilirsiniz.", tp: { h: h.name, c: h.city }, kind: "fa", ref: h.id })); },
  "hotel.contract.imported": (e) => NT.RULES["hotel.created"](e),
  "dmc.created": (e) => { const d = db().get("dmcs", +e.ref); if (d) NT.push({ tid: "P", depts: ["Commercial", "DMC"], perms: ["cs", "s"], title: "Yeni müşteri DMC: {n}", tp: { n: d.name }, kind: "dmc", ref: d.id }); },
  "subdmc.created": (e) => NT.RULES["dmc.created"](e),
  "account.created": (e) => { const a = db().get("accounts", +e.ref); if (a) NT.push({ tid: "P", depts: ["Commercial"], perms: ["cs", "a"], title: "Yeni satış hesabı: {n}", tp: { n: a.name }, kind: "acct", ref: a.id }); },
  "contract.signed.party": (e) => { const c = db().find("contracts", k => k.no == e.ref); if (c) NT.push({ tid: "P", depts: ["Commercial"], perms: ["kt", "k"], title: "{no} karşı taraf imzaladı; belge onayı bekliyor", tp: { no: c.no }, kind: "k", ref: c.id }); }
};
const baseEmit = B4M.events.emit; B4M.events.emit = function (ev, ...a) { const e = baseEmit.call(this, ev, ...a); try { const f = NT.RULES[ev]; if (f && db()) f(e); } catch (er) { console.error(er); } return e; };
/* ---- yetki yardımcıları ---- */
Y1.can = k => AU.can(k);
Y1.isBO = () => B4M.ctx.org == "h";
/* stop ve SPO artık ayrı yetki */
const PD = B4M.prod, guard = (fn, k, m) => { const base = PD[fn]; PD[fn] = (...a) => { const u = B4M.app.user(); if (u.id && u.role != "admin" && !AU.can(k)) return no(m); return base(...a); }; };
guard("stopAdd", "stop", "Stop sale için yetkiniz yok."); guard("stopDel", "stop", "Stop sale için yetkiniz yok."); guard("delStop", "stop", "Stop sale için yetkiniz yok.");
guard("spoAdd", "spo", "SPO için yetkiniz yok."); guard("spoTog", "spo", "SPO için yetkiniz yok."); guard("spoDel", "spo", "SPO için yetkiniz yok.");
