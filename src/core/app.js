/* Uygulama çekirdeği: depo örneği, oturum bağlamı, olay kuyruğu (entegrasyonlar için) ve işlem kaydı. */
const A = B4M.app = {};
A.STORAGE_KEY = "book4me-ai-v41";
/* oturum: org = "h" (Back Office) | "s" (DMC) | "a" (alıcı / satış hesabı), uid = kullanıcı, dmc = DMC firması, acct = satış ekranındaki alıcı hesabı */
B4M.ctx = { org: "", uid: 0, dmc: 0, acct: 0, support: null };
A.init = (adapter, seedFn) => { B4M.db = B4M.store.create(adapter || B4M.store.LocalAdapter(A.STORAGE_KEY)).load(seedFn || B4M.seed.run); return B4M.db; };
/* kiracı kimliği: DMC kökü ("P" = platform) */
A.tidOf = dmcId => { const db = B4M.db; let x = dmcId, n = 0, d; while ((d = db.get("dmcs", x)) && d.parent && n++ < 6) x = d.parent; return x || "P"; };
A.curTid = () => B4M.ctx.org == "h" ? "P" : B4M.ctx.dmc ? A.tidOf(B4M.ctx.dmc) : "P";
A.user = () => B4M.db.get("users", B4M.ctx.uid) || { id: 0, role: "", perms: [], name: "", org: "" };
/* olaylar: sistem standart olaylar üretir; açık entegrasyon adaptörleri bunları kuyruktan alıp kendi diline çevirir */
B4M.events = {
  emit(ev, ref, amt, cur, dmc) {
    const db = B4M.db, tid = dmc ? A.tidOf(dmc) : A.curTid();
    const e = db.add("events", { ev, ref: String(ref ?? ""), amt: amt || 0, cur: cur || "TRY", dmc: dmc || 0, tid, state: "Bekliyor", tries: 0, at: B4M.util.now(), out: {} });
    if (B4M.int && B4M.int.route) B4M.int.route(e);
    return e;
  }
};
/* işlem kaydı: kim, neyi, ne zaman yaptı */
B4M.audit = {
  log(action, ref, detail, tid) {
    const c = B4M.ctx, u = A.user();
    return B4M.db.add("audit", { at: B4M.util.now(), tid: tid || A.curTid(), uid: u.id || 0, who: u.name || (c.org ? "?" : "sistem"), org: c.org || "", action, ref: String(ref ?? ""), detail: detail || "", support: c.support ? c.support.by : "" });
  }
};
/* SHA-256 (eşzamanlı, bağımsız): şifre özetleri için */
B4M.util.sha256 = function (msg) {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const b = unescape(encodeURIComponent(msg)), l = b.length, w = [], H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const n = ((l + 9 + 63) >> 6) << 4, M = new Array(n).fill(0);
  for (let i = 0; i < l; i++) M[i >> 2] |= b.charCodeAt(i) << (24 - (i % 4) * 8);
  M[l >> 2] |= 0x80 << (24 - (l % 4) * 8); M[n - 1] = l * 8;
  const r = (x, k) => (x >>> k) | (x << (32 - k));
  for (let i = 0; i < n; i += 16) {
    let [a, bb, c, d, e, f, g, h] = H;
    for (let j = 0; j < 64; j++) {
      if (j < 16) w[j] = M[i + j] | 0; else { const s0 = r(w[j - 15], 7) ^ r(w[j - 15], 18) ^ (w[j - 15] >>> 3), s1 = r(w[j - 2], 17) ^ r(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0; }
      const S1 = r(e, 6) ^ r(e, 11) ^ r(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[j] + w[j]) | 0, S0 = r(a, 2) ^ r(a, 13) ^ r(a, 22), mj = (a & bb) ^ (a & c) ^ (bb & c), t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
};
B4M.util.pwHash = (pw, salt) => B4M.util.sha256(salt + "|" + pw);
