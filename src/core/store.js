/* Veri katmanı: tüm okuma/yazma bu arayüzden geçer.
   Çevrimdışı modelde LocalAdapter (tarayıcı depolaması) veya MemoryAdapter kullanılır.
   Sunucuya geçişte yalnızca adaptör değişir (ServerAdapter iskeleti aşağıda); ekranlar ve iş kuralları aynı kalır.
   Veri ayrımı: her kayıt bir kiracıya (DMC kökü) aittir; scope(tid) yalnızca o kiracının kayıtlarını döndürür. */
const ST = B4M.store = {};
const SCHEMA_VERSION = 1;
ST.COLLS = ["dmcs", "accounts", "users", "hotels", "transfers", "tours", "gprod", "gsales", "opSup", "contracts", "bookings", "orders",
  "ledger", "topups", "modreq", "mail", "events", "apis", "banks", "zones", "audit", "licenses", "announcements", "integrations",
  "agents", "approvals", "commissions", "cinvoices", "apiKeys", "apiLog", "bankTx", "supportLog", "jobs"];
/* kiracı kuralları: kaydın hangi kiracılara görünür olduğunu söyler ("P" = platform) */
ST.TENANT = {
  dmcs: r => [r.tid], accounts: r => [r.tid], users: r => [r.tid], hotels: r => [r.tid], transfers: r => [r.tid], tours: r => [r.tid],
  gprod: r => [r.tid], gsales: r => [r.tid], opSup: r => [r.tid], contracts: r => [r.tid], bookings: r => [r.sellerT, r.buyerT],
  orders: r => [r.tid], ledger: r => [r.tid], topups: r => [r.tid], modreq: r => [r.sellerT, r.buyerT], mail: r => [r.tid], events: r => [r.tid],
  audit: r => [r.tid], licenses: r => [r.tid], integrations: r => [r.tid], agents: r => [r.tid], approvals: r => [r.tid],
  commissions: r => [r.tid], cinvoices: r => [r.tid], apiKeys: r => [r.tid], apiLog: r => [r.tid], bankTx: r => [r.tid], supportLog: r => [r.tid]
};
/* ---- adaptörler ---- */
ST.MemoryAdapter = function () { let doc = null; return { name: "memory", read: () => doc ? JSON.parse(doc) : null, write: s => { doc = JSON.stringify(s); return true; }, clear: () => { doc = null; } }; };
ST.LocalAdapter = function (key) {
  const mem = ST.MemoryAdapter();
  const ls = () => { try { return globalThis.localStorage || null; } catch (e) { return null; } };
  return {
    name: "local",
    read() { try { const l = ls(); const v = l && l.getItem(key); return v ? JSON.parse(v) : mem.read(); } catch (e) { return mem.read(); } },
    write(s) { mem.write(s); try { const l = ls(); if (!l) return true; l.setItem(key, JSON.stringify(s)); return true; } catch (e) { return false; } },
    clear() { mem.clear(); try { const l = ls(); l && l.removeItem(key); } catch (e) { } }
  };
};
/* Sunucu adaptörü iskeleti: aynı arayüz, veriyi REST uç noktasından okur/yazar. İlk sürümde kullanılmaz. */
ST.ServerAdapter = function (baseUrl, token) {
  return {
    name: "server",
    read() { throw new Error("ServerAdapter: çevrimdışı modelde kullanılmaz (" + baseUrl + ")"); },
    write() { throw new Error("ServerAdapter: çevrimdışı modelde kullanılmaz"); },
    clear() { }
  };
};
/* ---- depo ---- */
ST.create = function (adapter) {
  let S = null;
  const db = {
    adapter,
    load(seedFn) {
      S = adapter.read();
      if (!S || S.v !== SCHEMA_VERSION) { S = ST.empty(); if (seedFn) seedFn(db); db.commit(); }
      ST.COLLS.forEach(c => { if (!S.c[c]) S.c[c] = []; });
      return db;
    },
    reset(seedFn) { adapter.clear(); S = ST.empty(); if (seedFn) seedFn(db); db.commit(); return db; },
    seq() { return ++S.seq; },
    all(c) { return S.c[c] || (S.c[c] = []); },
    get(c, id) { return db.all(c).find(x => x.id == id); },
    find(c, f) { return db.all(c).find(f); },
    where(c, f) { return f ? db.all(c).filter(f) : db.all(c).slice(); },
    add(c, o) { if (o.id == null) o.id = db.seq(); db.all(c).push(o); return o; },
    put(c, o) { const L = db.all(c), i = L.findIndex(x => x.id == o.id); if (i >= 0) L[i] = o; else L.push(o); return o; },
    del(c, f) { const L = db.all(c), keep = L.filter(x => typeof f == "function" ? !f(x) : x.id != f); const n = L.length - keep.length; S.c[c] = keep; return n; },
    /* tekil ayarlar (kurlar, kurallar, sayaçlar…) */
    cfg(k, v) { if (v !== undefined) S.cfg[k] = v; return S.cfg[k]; },
    counter(k) { S.cfg["n_" + k] = (S.cfg["n_" + k] || 0) + 1; return S.cfg["n_" + k]; },
    commit() { return adapter.write(S); },
    snapshot() { return JSON.parse(JSON.stringify(S)); },
    size() { try { return JSON.stringify(S).length; } catch (e) { return 0; } },
    /* kiracı görünümü: DMC kullanıcıları yalnızca kendi verisini görür */
    scope(tid) {
      if (tid === "P" || tid == null) return db;
      const vis = (c, r) => { const f = ST.TENANT[c]; return !f || f(r).includes(tid); };
      return {
        tid, all: c => db.all(c).filter(r => vis(c, r)), get: (c, id) => { const r = db.get(c, id); return r && vis(c, r) ? r : undefined; },
        find: (c, f) => db.all(c).find(r => vis(c, r) && f(r)), where: (c, f) => db.all(c).filter(r => vis(c, r) && (!f || f(r))),
        add: (c, o) => { if (ST.TENANT[c] && o.tid == null) o.tid = tid; return db.add(c, o); }
      };
    }
  };
  return db;
};
ST.empty = () => ({ v: SCHEMA_VERSION, seq: 200, c: {}, cfg: {} });
