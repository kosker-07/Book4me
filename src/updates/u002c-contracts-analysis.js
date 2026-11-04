/* Yama 1 · kontratlar, Legal, gizlilikli fiyat analizi, H2H
   - Otel kontrat yönetimi (Product / Otel Kontrat) ile şirket sözleşme yönetimi (Commercial → Sözleşme takibi + Legal) ayrıdır.
   - Legal onaylı şirket sözleşmelerine özel şart ekler ve şartları değiştirir; her değişiklik sürüm olarak saklanır, karşı tarafa bildirilir.
   - Fiyat analizi: bir otelin platformdaki fiyatları tarih tarih; diğer DMC'lerin adı hiçbir yerde görünmez.
   - H2H: DMC'nin partner firmalarla doğrudan API bağlantısı (kendi ürünleri, kendi fiyatı). */
const db = () => B4M.db, { ok, no } = B4M.res, P = B4M.parties, PD = B4M.prod, PR = B4M.price, IN = B4M.int, NT = B4M.notif, Y1 = B4M.y1;
/* ---- otel kontratları ---- */
const HK = B4M.hk = {};
HK.of = h => { const S = h.seasons || [], from = S.length ? S.map(s => s.from).sort()[0] : "", to = S.length ? S.map(s => s.to).sort().slice(-1)[0] : "", doc = db().where("hkDocs", x => x.hid == h.id).slice(-1)[0] || null;
  return { h, dmc: h.sup, tid: B4M.app.tidOf(h.sup), from, to, cur: h.cur, seasons: S.length, stops: (h.stops || []).filter(s => s.to >= U.today()).length, spo: (h.spo || []).filter(s => s.on && s.st >= U.today()).length,
    st: !S.length ? "Sabit fiyat" : to < U.today() ? "Süresi doldu" : to <= U.addD(U.today(), 30) ? "30 gün içinde bitiyor" : "Aktif", doc }; };
HK.list = tid => db().all("hotels").filter(h => tid == "P" || B4M.app.tidOf(h.sup) == tid).map(HK.of).sort((a, b) => a.h.name.localeCompare(b.h.name));
HK.upload = (hid, name, data) => { const h = PD.H(hid); if (!h) return no("Otel bulunamadı."); if (!B4M.auth.can("hk") || (B4M.ctx.org != "h" && B4M.app.tidOf(B4M.ctx.dmc) != B4M.app.tidOf(h.sup))) return no("Bu işlem için yetkiniz yok."); if (!/^data:(application\/pdf|image\/)/.test(data || "")) return no("Yalnızca PDF veya görsel yükleyebilirsin.");
  db().add("hkDocs", { tid: B4M.app.tidOf(h.sup), hid, name, data, at: U.now(), by: B4M.app.user().name }); B4M.audit.log("hotel.contract.uploaded", hid, name, B4M.app.tidOf(h.sup)); return ok("İmzalı otel kontratı yüklendi."); };
/* ---- Legal: şirket sözleşmeleri ---- */
const LG = B4M.legal = {};
LG.can = () => B4M.ctx.org == "h" && B4M.auth.can("legal"); /* Legal yalnızca Back Office */
LG.ptid = c => c.p == "s" ? B4M.app.tidOf(c.pid) : (db().get("accounts", c.pid) || {}).buyer ? B4M.app.tidOf(db().get("accounts", c.pid).buyer) : "P";
LG.vers = cid => db().where("kVers", v => v.cid == cid).sort((a, b) => b.ver - a.ver);
LG.snap = (c, what, txt) => { const v = (LG.vers(c.id)[0] || { ver: 0 }).ver + 1; db().add("kVers", { tid: "P", ptid: LG.ptid(c), cid: c.id, ver: v, at: U.now(), by: B4M.app.user().name, what, txt: txt || "", terms: P.termsText(c) });
  NT.push({ tid: LG.ptid(c), depts: [], perms: [], title: "{no} sözleşmesinde değişiklik: {w}", tp: { no: c.no, w: what }, kind: "k", ref: c.id }); return v; };
LG.addClause = (cid, text) => { const c = P.K(cid); if (!c) return no("Sözleşme yok."); if (!LG.can()) return no("Bu işlem için Legal yetkisi gerekir."); text = String(text || "").trim(); if (text.length < 5) return no("Özel şart metnini girin.");
  (c.special = c.special || []).push({ id: db().seq(), text, at: U.now(), by: B4M.app.user().name }); const v = LG.snap(c, t("Özel şart eklendi"), text); B4M.audit.log("contract.legal.clause", c.no, text, "P"); return ok("Özel şart eklendi; sürüm {v} kaydedildi ve karşı tarafa bildirildi.", { v }); };
LG.delClause = (cid, id) => { const c = P.K(cid); if (!LG.can()) return no("Bu işlem için Legal yetkisi gerekir."); const x = (c.special || []).find(s => s.id == id); if (!x) return no("");
  c.special = c.special.filter(s => s.id != id); const v = LG.snap(c, t("Özel şart kaldırıldı"), x.text); return ok("Özel şart kaldırıldı; sürüm {v} kaydedildi.", { v }); };
LG.saveTerms = (cid, o) => { if (!LG.can()) return no("Bu işlem için Legal yetkisi gerekir."); const r = P.saveK(cid, o); if (r.ok) LG.snap(P.K(cid), t("Şartlar değiştirildi"), o.extra || ""); return r; };
/* sözleşme metni: özel şartlar ve tedarik maddesi */
const baseTerms = P.termsText;
P.termsText = c => { let s = baseTerms(c); const n = (s.match(/^\d+\./gm) || []).length;
  const L = [`${n + 1}. ${t("TEDARİK: book4me ai, hizmeti aynı otel, oda tipi, pansiyon ve tarihlerde, eşit veya daha iyi iptal şartıyla eşdeğer bir tedarikçiden sağlayabilir. Bu durumda satış fiyatı, rezervasyon numarası ve şartlar değişmez.")}`];
  (c.special || []).forEach((x, i) => L.push(`${n + 2 + i}. ${t("ÖZEL ŞART")}: ${x.text}`)); return s.trimEnd() + "\n" + L.join("\n") + "\n"; };
/* ---- gizlilikli fiyat analizi ---- */
const FA = B4M.fa = {};
FA.key = h => h.name.toLowerCase() + "|" + h.city.toLowerCase();
FA.groups = () => { const m = {}; db().all("hotels").filter(h => PR.supOK(h.sup, "h")).forEach(h => (m[FA.key(h)] ??= []).push(h)); return m; };
FA.hotelPrice = (h, d, n, o, nat) => { const ns = U.nights(d, U.addD(d, n)), q = { ag: 0, nat: nat || "", a: d, b: U.addD(d, n) }; let best = null;
  h.rooms.forEach(r => { if (o.ad + o.ch > r.cap || o.ad > (r.ma ?? r.cap) || o.ch > (r.mc ?? r.cap) || (q.nat && !PD.mkOK(h.mk, q.nat)) || B4M.search.avail(r, ns) <= 0) return; const tot = PD.stayT(h, r, ns, "r", q, o); if (tot == null) return; const e = PR.cv(tot, h.cur, "EUR"); if (!best || e < best.e) best = { e, tot, cur: h.cur, room: r.type }; }); return best; };
FA.analyze = o => { const G = FA.groups()[o.key] || [], tid = o.tid, n = Math.max(1, +o.n || 1), oc = { ad: Math.max(1, +o.ad || 2), ch: 0, ages: [] }, ds = U.dRange(o.from, o.to).slice(0, 62);
  const rows = ds.map(d => { const L = G.map(h => ({ mine: tid != "P" && B4M.app.tidOf(h.sup) == tid, p: FA.hotelPrice(h, d, n, oc, o.nat) })).filter(x => x.p).sort((a, b) => a.p.e - b.p.e);
    const my = L.find(x => x.mine), v = L.map(x => x.p.e); return { d, n: L.length, my: my ? my.p.e : null, rank: my ? L.indexOf(my) + 1 : null, min: v.length ? v[0] : null, max: v.length ? v[v.length - 1] : null, avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null,
      offers: L.map((x, i) => ({ label: x.mine ? "Siz" : "Teklif " + (L.filter(y => !y.mine).indexOf(x) + 1), e: x.p.e, mine: x.mine })) }; });
  const got = rows.filter(r => r.n), my = got.filter(r => r.my != null);
  return { rows, days: got.length, dmcs: G.length, mine: G.some(h => tid != "P" && B4M.app.tidOf(h.sup) == tid), cheapest: my.filter(r => r.rank == 1).length, gapAvg: my.length ? my.reduce((s, r) => s + (r.my - r.min), 0) / my.length : null };
};
FA.portfolio = (tid, from, to, n, nat) => { const G = FA.groups(); return Object.entries(G).filter(([, L]) => tid == "P" || L.some(h => B4M.app.tidOf(h.sup) == tid)).map(([key, L]) => { const r = FA.analyze({ key, from, to, n, ad: 2, nat, tid }); return { key, name: L[0].name, city: L[0].city, comp: L.length, ...r }; }).sort((a, b) => a.name.localeCompare(b.name)); };
/* ---- H2H ---- */
const H2 = B4M.h2h = {};
const myT = tid => B4M.ctx.org == "s" && B4M.app.tidOf(B4M.ctx.dmc) == tid && B4M.auth.can("int");
H2.list = tid => db().where("h2h", x => x.tid == tid).reverse();
H2.add = (tid, o) => { if (!myT(tid)) return no("Bu işlem için yetkiniz yok."); if (!o.name || !o.name.trim()) return no("Partner firma adını girin."); const lim = Math.max(1, +o.limit || 60);
  const x = db().add("h2h", { tid, name: o.name.trim(), dir: o.dir == "gelen" ? "gelen" : "giden", env: o.env == "Canlı" ? "Canlı" : "Test", limit: lim, on: true, at: U.now(), key: "" });
  if (x.dir == "giden") { x.key = (x.env == "Canlı" ? "h2h_live_" : "h2h_test_") + U.sha256(tid + "|" + x.id + "|" + Math.random()).slice(0, 24); db().add("apiKeys", { tid, h2h: x.id, dmc: tid, env: x.env, key: x.key, on: true, at: U.now(), limit: lim }); }
  B4M.audit.log("h2h.created", x.id, x.name, tid); return ok(x.dir == "giden" ? "H2H bağlantısı oluşturuldu. Partnere verilecek anahtar: {k}" : "H2H bağlantısı oluşturuldu. Partnerin API bilgilerini Bağlantılar → Tedarikçi API'den girin.", { k: x.key }, { x }); };
H2.tog = id => { const x = db().get("h2h", id); if (!x || !myT(x.tid)) return no("Bu işlem için yetkiniz yok."); x.on = !x.on; const k = db().find("apiKeys", y => y.h2h == id); if (k) k.on = x.on; return ok(x.on ? "Bağlantı açıldı." : "Bağlantı kapatıldı."); };
const baseCall = IN.call;
IN.call = (key, ep, body) => { const k = db().find("apiKeys", x => x.key == key); if (!k || !k.h2h) return baseCall(key, ep, body);
  const lg = (st, res) => { db().add("apiLog", { tid: k.tid, at: U.now(), key: key.slice(0, 12) + "…", ep, st, ms: 20 + (parseInt(U.hsh(ep + U.now()), 16) % 80), h2h: k.h2h }); return { status: st, body: res }; };
  if (!k.on) return lg(401, { error: "invalid_key" }); const used = db().where("apiLog", x => x.key == key.slice(0, 12) + "…" && x.at == U.now()).length; if (used >= (k.limit || 60)) return lg(429, { error: "rate_limited", limit: k.limit });
  const mine = h => B4M.app.tidOf(h.sup) == k.dmc;
  if (ep == "content.hotels") return lg(200, { hotels: db().all("hotels").filter(mine).map(h => ({ code: "H" + h.id, name: h.name, city: h.city, zone: h.zone, stars: h.stars, board: h.board, rooms: h.rooms.map(r => r.type) })) });
  if (ep == "search.hotels") { const b = body || {}, a = b.ci || U.addD(U.today(), 30), z = b.co || U.addD(a, 3), n = Math.max(1, U.nights(a, z).length), oc = { ad: +b.ad || 2, ch: 0, ages: [] };
    return lg(200, { currency: "EUR", nights: n, hotels: db().all("hotels").filter(h => mine(h) && (!b.city || U.norm(h.city + " " + h.zone).includes(U.norm(b.city)))).map(h => { const p = FA.hotelPrice(h, a, n, oc, b.nat); return p ? { code: "H" + h.id, name: h.name, city: h.city, total: U.r2(p.tot), currency: p.cur, room: p.room } : null; }).filter(Boolean) }); }
  if (ep == "book" || ep == "cancel") return k.env != "Canlı" ? lg(200, { test: true, confirmationNo: "TEST-" + U.hsh(JSON.stringify(body || {})).slice(0, 8) }) : lg(501, { error: "live_booking_requires_server", hint: "Canlı H2H rezervasyonu sunucuya geçişte açılır." });
  return lg(404, { error: "unknown_endpoint" });
};
