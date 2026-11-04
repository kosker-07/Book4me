/* Ortak yardımcılar: tarih, sayı, metin. DOM'a bağımlı değildir (Node testlerinde de çalışır). */
U.CUR = ["TRY", "USD", "EUR", "GBP", "CHF", "JPY", "CAD", "AUD", "CNY", "AED", "SGD"];
U.BOARD = ["Oda kahvaltı", "Yarım pansiyon", "Tam pansiyon", "Her şey dahil", "Ultra her şey dahil"];
U.VEH = { "Sedan": 3, "VIP": 6, "Minivan": 7, "Minibüs": 15, "Midibüs": 27, "Otobüs": 46 };
U.SV = ["h", "t", "f", "u"];
U.SVN = { h: "Otel", t: "Transfer", f: "Uçak", u: "Tur" };
U.AYT = "Antalya Havalimanı (AYT)";
U.IST = "İstanbul Havalimanı (IST)";
/* saat dilimi bağımsız gün hesabı (ISO yyyy-mm-dd) */
U._now = null; /* testler için sabitlenebilir */
U.nowDate = () => U._now ? new Date(U._now) : new Date();
U.today = () => U.nowDate().toISOString().slice(0, 10);
U.now = () => U.nowDate().toISOString().slice(0, 16).replace("T", " ");
U.addD = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
U.nights = (a, b) => { const r = []; let d = a; while (d && b && d < b && r.length < 120) { r.push(d); d = U.addD(d, 1); } return r; };
U.dRange = (f, t) => { const r = []; let d = f; while (d && d <= t && r.length < 400) { r.push(d); d = U.addD(d, 1); } return r; };
U.wd = d => { const x = new Date(d + "T12:00:00Z").getUTCDay(); return x == 0 ? 7 : x; };
U.ymAdd = (k, n) => { const [y, m] = k.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
U.r2 = x => Math.round(x * 100) / 100;
U.esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
U.norm = k => String(k == null ? "" : k).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
U.mt = (q, s) => { q = U.norm(q || "").trim(); if (!q) return true; const t = U.norm(s || ""); return q.split(/\s+/).every(w => t.includes(w)); };
U.hsh = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).toUpperCase().padStart(8, "0"); };
U.isMail = v => /.+@.+\..+/.test(v || "");
U.clone = o => JSON.parse(JSON.stringify(o));
U.uniq = a => [...new Set(a)];
U.sumBy = (L, f) => L.reduce((s, x) => s + (f(x) || 0), 0);
/* para birimine göre toplam: [[tutar, pb], ...] → {pb: toplam} */
U.byCur = L => { const m = {}; L.forEach(([v, c]) => { if (v) m[c] = (m[c] || 0) + v; }); return m; };
U.pad = (n, w) => String(n).padStart(w, "0");
U.slug = s => U.norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
