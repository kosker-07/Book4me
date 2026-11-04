/* u007 · Pazar tanımı ve kontrat bazında satış kısıtı.
   - Fiyat listesinin pazarı başlıktan okunur ("... PRICE FOR EUROPE & UK") ve dosyadaki "Ülke-Pazar Tanımları" sayfasıyla ülkelere çevrilir;
     sayfa yoksa DMC'nin kayıtlı tanımı, o da yoksa sistemin varsayılan tanımı kullanılır.
   - Kontrat (sezon) yalnızca o pazardaki milliyetlere satılır: arama, fiyat, değişiklik, rebooking ve API (H2H dahil) aynı kuralı kullanır.
   - Aynı otelin farklı pazar fiyat listeleri ayrı kontrat olarak yan yana durur (sezon adına pazar eklenir), birbirini ezmez.
   - Milliyet bildirilmeyen satış sorgusunda pazarı kısıtlı kontratlar gösterilmez (güvenli taraf). Arayüz dışıdır. */
const db = () => B4M.db, PD = B4M.prod, XP = B4M.xp, IX = B4M.imp, SR = B4M.search, IN = B4M.int, { ok, no } = B4M.res;
const MK = B4M.mkt = {};
const N = s => XP.xU(s).replace(/[^A-Z]/g, "");
/* ülke adı (Türkçe / İngilizce) → ISO kodu */
MK.C = { DE: "Almanya|Germany|Deutschland", NL: "Hollanda|Netherlands|Holland", FR: "Fransa|France", ES: "İspanya|Spain", IT: "İtalya|Italy", BE: "Belçika|Belgium", AT: "Avusturya|Austria", CH: "İsviçre|Switzerland", FO: "Faroe Adaları|Faroe Islands|Faroe", PT: "Portekiz|Portugal", LU: "Lüksemburg|Luxembourg",
  MD: "Moldova", RS: "Sırbistan|Serbia", RO: "Romanya|Romania", HU: "Macaristan|Hungary", PL: "Polonya|Poland", CZ: "Çekya|Çek Cumhuriyeti|Czechia|Czech Republic", SK: "Slovakya|Slovakia", SI: "Slovenya|Slovenia", BG: "Bulgaristan|Bulgaria", XK: "Kosova|Kosovo", GR: "Yunanistan|Greece",
  AL: "Arnavutluk|Albania", MK: "Makedonya|Kuzey Makedonya|North Macedonia|Macedonia", BA: "Bosna-Hersek|Bosna Hersek|Bosnia and Herzegovina|Bosnia", ME: "Karadağ|Montenegro", HR: "Hırvatistan|Croatia", LV: "Letonya|Latvia", LT: "Litvanya|Lithuania", EE: "Estonya|Estonia",
  NO: "Norveç|Norway", SE: "İsveç|Sweden", FI: "Finlandiya|Finland", DK: "Danimarka|Denmark", IS: "İzlanda|Iceland", GB: "Birleşik Krallık|İngiltere|İskoçya|Galler|Kuzey İrlanda|United Kingdom|UK|England|Scotland|Wales|Great Britain", IE: "İrlanda|Ireland",
  RU: "Rusya|Russia", UA: "Ukrayna|Ukraine", GE: "Gürcistan|Georgia", AM: "Ermenistan|Armenia", BY: "Belarus|Beyaz Rusya", TJ: "Tacikistan|Tajikistan", TM: "Türkmenistan|Turkmenistan", KZ: "Kazakistan|Kazakhstan", UZ: "Özbekistan|Uzbekistan", KG: "Kırgızistan|Kyrgyzstan", AZ: "Azerbaycan|Azerbaijan",
  IR: "İran|Iran", IQ: "Irak|Iraq", IL: "İsrail|Israel", JO: "Ürdün|Jordan", AE: "BAE|Birleşik Arap Emirlikleri|UAE|United Arab Emirates", SA: "Suudi Arabistan|Saudi Arabia", KW: "Kuveyt|Kuwait", QA: "Katar|Qatar", BH: "Bahreyn|Bahrain", OM: "Umman|Oman", LB: "Lübnan|Lebanon",
  DZ: "Cezayir|Algeria", MA: "Fas|Morocco", TN: "Tunus|Tunisia", EG: "Mısır|Egypt", LY: "Libya", CN: "Çin|China", TW: "Tayvan|Taiwan", TH: "Tayland|Thailand", JP: "Japonya|Japan", VN: "Vietnam|Viet Nam", KR: "Güney Kore|Kore|South Korea|Korea", IN: "Hindistan|India",
  CA: "Kanada|Canada", US: "ABD|Amerika|USA|United States|America", TR: "Türkiye|Turkey|Türkiye Cumhuriyeti", CY: "Kıbrıs|Cyprus", MT: "Malta", AU: "Avustralya|Australia", BR: "Brezilya|Brazil", MX: "Meksika|Mexico", AR: "Arjantin|Argentina", ZA: "Güney Afrika|South Africa" };
MK.IDX = {}; Object.entries(MK.C).forEach(([c, s]) => s.split("|").forEach(n => { MK.IDX[N(n)] = c; }));
MK.iso = name => { const k = N(name); if (!k) return null; if (/^[A-Z]{2}$/.test(String(name).trim())) return String(name).trim().toUpperCase(); return MK.IDX[k] || null; };
/* varsayılan pazar tanımı (sektörde yaygın): ana pazar, alt pazar, ülke */
MK.DEF = [["EUROPE", "WEST EUROPE", "DE NL FR ES IT BE AT CH FO PT LU"], ["EUROPE", "EAST EUROPE", "MD RS RO HU PL CZ SK SI"], ["EUROPE", "BALKAN", "BG XK GR AL MK BA ME HR"], ["EUROPE", "BALTIC", "LV LT EE"], ["EUROPE", "NORDIC", "NO SE FI DK IS"],
  ["UK", "UK", "GB IE FO"], ["CIS", "CIS", "RU UA GE AM BY"], ["CIS", "TURK STATES", "TJ TM KZ UZ KG AZ"], ["MENA", "MIDDLE EAST", "IR IQ IL JO AE SA KW QA BH OM LB"], ["MENA", "NORTH AFRICA", "DZ MA TN EG LY"], ["OTHER", "ASIA", "CN TW TH JP VN KR IN"], ["OTHER", "AMERICA", "CA US"]]
  .flatMap(([m, s, L]) => L.split(" ").map(c => ({ main: m, market: s, nat: c })));
/* "Ülke-Pazar Tanımları" sayfası: yan yana bloklar (MAIN MARKET · MARKET · NATIONALITY), değerler aşağı doğru devam eder */
MK.parseSheet = rows => { const H = (rows[0] || []).map(v => XP.xU(v)), out = [], unknown = []; const starts = H.map((v, j) => /MAIN ?MARKET|ANA PAZAR/.test(v) ? j : -1).filter(j => j >= 0);
  starts.forEach((s0, bi) => { const end = bi + 1 < starts.length ? starts[bi + 1] : H.length, cols = H.slice(s0, end); const natC = s0 + cols.findIndex(v => /NATIONALITY|MILLIYET|ULKE/.test(v)), mkC = s0 + cols.findIndex((v, j) => j > 0 && /^MARKET$|^PAZAR$/.test(v)); if (natC < s0) return;
    let main = "", mk = ""; for (let i = 1; i < rows.length; i++) { const r = rows[i] || [], m = String(r[s0] ?? "").trim(), k = mkC >= s0 ? String(r[mkC] ?? "").trim() : "", n = String(r[natC] ?? "").trim(); if (m) { main = XP.xU(m); mk = ""; } if (k) mk = XP.xU(k); if (!n || !main) continue;
      const c = MK.iso(n); if (c) out.push({ main, market: mk || main, nat: c }); else unknown.push(n); } });
  /* bloğun ana pazar sütunu yoksa (yalnızca MARKET · NATIONALITY) */
  H.forEach((v, j) => { if (/^MARKET$/.test(v) && !starts.some(s => j > s && j < s + 3)) { const nc = j + 1; let mk = ""; for (let i = 1; i < rows.length; i++) { const r = rows[i] || [], k = String(r[j] ?? "").trim(), n = String(r[nc] ?? "").trim(); if (k) mk = XP.xU(k); if (!n || !mk) continue; const c = MK.iso(n); if (c && !out.some(x => x.market == mk && x.nat == c)) out.push({ main: mk, market: mk, nat: c }); } } });
  return { rows: out, unknown: U.uniq(unknown) }; };
MK.defs = tid => { const d = db().cfg("mkdef") || {}; return (d[tid] && d[tid].rows && d[tid].rows.length) ? d[tid].rows : MK.DEF; };
MK.saveDefs = (tid, rows, src) => { const d = { ...(db().cfg("mkdef") || {}) }; d[tid] = { rows, src: src || "", at: U.now() }; db().cfg("mkdef", d); };
/* başlıktaki pazar metni → ülke listesi */
MK.label = txt => { const s = XP.xU(txt); const m = s.match(/\bFOR\s+(.+)$/) || s.match(/\bMARKETS?\s*[:\-]?\s*(.+)$/) || s.match(/\bPAZAR(?:I|LARI)?\s*[:\-]?\s*(.+)$/); return m ? m[1].replace(/\b(MARKETS?|PAZAR(?:I|LARI)?)\b/g, "").trim() : ""; };
MK.resolve = (txt, defs) => { const lbl = MK.label(txt); if (!lbl || /^(ALL|WORLD ?WIDE|TUM|GLOBAL)/.test(lbl)) return null; const toks = lbl.split(/\s*(?:&|\/|,|\+|\bAND\b|\bVE\b)\s*/).map(x => x.trim()).filter(Boolean), list = new Set(), miss = [];
  toks.forEach(tk => { const hit = defs.filter(r => r.main == tk || r.market == tk); if (hit.length) hit.forEach(r => list.add(r.nat)); else { const c = MK.iso(tk); if (c) list.add(c); else miss.push(tk); } });
  return { mode: "only", list: [...list].sort(), label: toks.map(x => XP.xTitle(x).replace(/\bUk\b/, "UK").replace(/\bCis\b/, "CIS").replace(/\bMena\b/, "MENA")).join(" & "), miss }; };
/* milliyet listesi: pazar tanımındaki tüm ülkeler arama ve satışta seçilebilir */
(() => { const have = new Set(PD.NAT.map(x => x[0])), add = Object.keys(MK.C).filter(c => !have.has(c)).map(c => [c, MK.C[c].split("|")[0]]).sort((a, b) => a[1].localeCompare(b[1], "tr")); const xx = PD.NAT.findIndex(x => x[0] == "XX"); PD.NAT.splice(xx < 0 ? PD.NAT.length : xx, 0, ...add); })();
/* ---- kontrat (sezon) bazında satış kuralı ---- */
MK.seasonOK = (s, nat, q) => { const m = s.mk; if (!m || m.mode == "all" || !(m.list || []).length) return true; if (!nat) return !(q && q.ag) && !MK.strict; return PD.mkOK(m, nat); };
MK.view = (h, q) => { const Sn = h.seasons || []; if (!Sn.some(s => s.mk && s.mk.mode != "all")) return h; return { ...h, seasons: Sn.filter(s => MK.seasonOK(s, q && q.nat, q)) }; };
const baseStay = PD.stayT; PD.stayT = (h, r, ns, rt, q, o) => baseStay(MK.view(h, q || {}), r, ns, rt, q, o);
MK.sellable = (h, q, ns) => { const v = MK.view(h, q); if (!(h.seasons || []).length || v === h) return true; return !ns || !ns.length ? v.seasons.length > 0 : ns.every(d => v.seasons.some(s => s.periods.some(p => d >= p.from && d <= p.to))); };
/* ---- içe aktarma: başlıktan pazar, sayfadan tanım ---- */
const baseBook = XP.xBook; XP.xBook = sheets => { const B = baseBook(sheets), ms = sheets.find(s => XP.isMarket && XP.isMarket(s)) || sheets.find(s => /PAZAR|MARKET/.test(XP.xU(s.name)) && (s.rows || []).slice(0, 2).some(r => (r || []).some(v => /MAIN ?MARKET|NATIONALITY/.test(XP.xU(v)))));
  const P = ms ? MK.parseSheet(ms.rows || []) : null; B.mkSheet = P && P.rows.length ? { name: ms.name, rows: P.rows, unknown: P.unknown } : null;
  if (B.mkSheet) { B.extra = B.extra || []; B.extra.push(["{s}: {n} ülke {m} pazara ayrıldı; fiyat listeleri yalnızca kendi pazarlarındaki milliyetlere satılır.", { s: ms.name, n: U.uniq(P.rows.map(r => r.nat)).length, m: U.uniq(P.rows.map(r => r.market)).length }]); if (P.unknown.length) B.extra.push(["Tanınmayan ülke adları (pazara eklenmedi): {l}", { l: P.unknown.join(", ") }]); }
  B.hotels.forEach(h => MK.tag(h, B.mkSheet ? B.mkSheet.rows : null)); return B; };
MK.tag = (h, rows) => { const src = [h.meta && h.meta.season, h.meta && h.meta.market, h.season].filter(Boolean).find(x => MK.label(x)); h.mkTxt = src || ""; if (!src) { h.mk2 = null; return; }
  const dm = B4M.ctx && B4M.ctx.dmc ? B4M.app.tidOf(B4M.ctx.dmc) : null, m = MK.resolve(src, rows || (dm ? MK.defs(dm) : MK.DEF)); h.mk2 = m;
  if (m) { if (!/·/.test(h.season || "")) h.season = `${h.season} · ${m.label}`; if (m.miss.length) { h.W.push(["w", "Pazar “{m}” tanımlı değil; bu kısım için ülke bulunamadı. Kaydetmeden önce pazar tanımını kontrol edin.", { m: m.miss.join(", ") }]); if (h.st == "ok") h.st = "w"; }
    if (!m.list.length) { h.W.push(["e", "Fiyat listesinin pazarı ({m}) hiçbir ülkeyle eşleşmedi; yanlış milliyete satılmaması için kaydedilemez.", { m: m.label }]); h.st = "e"; } } };
const baseVal = XP.xVal; XP.xVal = h => { baseVal(h); if (h.mk2) { if (h.mk2.miss.length && !h.W.some(w => /tanımlı değil/.test(w[1]))) { h.W.push(["w", "Pazar “{m}” tanımlı değil; bu kısım için ülke bulunamadı. Kaydetmeden önce pazar tanımını kontrol edin.", { m: h.mk2.miss.join(", ") }]); if (h.st == "ok") h.st = "w"; } if (!h.mk2.list.length) h.st = "e"; } return h; };
const baseLoad = IX.load; IX.load = (S, sheets, src) => { const r = baseLoad(S, sheets, src); S.mkSheet = (XP.xBook.last || {}).mkSheet || null; return r; };
const baseSave = IX.save; IX.save = (S, dmc) => { const pick = Object.keys(S.sel).map(Number).map(i => S.hotels[i]).filter(h => h && h.st != "e"), r = baseSave(S, dmc); if (!r || !r.ok) return r; const tid = B4M.app.tidOf(dmc);
  if (S.mkSheet) MK.saveDefs(tid, S.mkSheet.rows, S.mkSheet.name); let n = 0;
  pick.forEach(h => { const x = IX.ex(h, dmc); if (!x || !h.mk2) return; const s = (x.seasons || []).slice().reverse().find(q => q.name.endsWith("· " + h.mk2.label)) || (x.seasons || [])[x.seasons.length - 1]; if (s) { s.mk = { mode: "only", list: h.mk2.list.slice(), label: h.mk2.label, adj: {} }; n++; } });
  if (n) db().commit(); if (S.done) S.done.mk = n; return r; };
/* ---- elle düzenleme (DMC) ---- */
MK.setSeason = (hid, sid, o) => { const h = PD.H(hid), s = h && (h.seasons || []).find(q => q.id == sid); if (!s) return no("Sezon bulunamadı."); const u = B4M.app.user(); if (B4M.ctx.org == "s" && B4M.app.tidOf(h.sup) != B4M.app.tidOf(B4M.ctx.dmc)) return no("Bu işlem için yetkiniz yok."); if (!(u.role == "admin" || B4M.auth.can("h") || B4M.auth.can("hk"))) return no("Bu işlem için yetkiniz yok.");
  if (o.all) { s.mk = { mode: "all", list: [], adj: {}, label: "" }; B4M.audit.log("season.market", h.name + " · " + s.name, "tüm pazarlar"); return ok("Bu kontrat tüm pazarlara açıldı."); }
  const defs = MK.defs(B4M.app.tidOf(h.sup)), list = U.uniq([...(o.markets || []).flatMap(m => defs.filter(r => r.market == m || r.main == m).map(r => r.nat)), ...(o.nats || [])]).sort(); if (!list.length) return no("En az bir pazar veya ülke seçin.");
  s.mk = { mode: "only", list, label: (o.markets || []).map(m => XP.xTitle(m)).join(" & ") || t("Seçili ülkeler"), adj: {} }; B4M.audit.log("season.market", h.name + " · " + s.name, s.mk.label + ": " + list.join(",")); return ok("Pazar kaydedildi: {n} ülke.", { n: list.length }); };
/* ---- API: milliyet alanı (nationality ya da nat) zorunlu kabul edilir; yoksa kısıtlı kontratlar gösterilmez ---- */
const baseCall = IN.call; IN.call = (key, ep, body) => { body = { ...(body || {}) }; const raw = body.nationality ?? body.nat; let warn = "";
  if (raw != null && raw !== "") { const c = MK.iso(raw); if (!c) return { status: 400, body: { error: "invalid_nationality", hint: "ISO 3166-1 alpha-2 (ör. DE, GB, RU)" } }; body.nat = c; } else if (/^search\.|^book$|^price\.confirm$/.test(ep)) { body.nat = ""; warn = "nationality_missing: market-restricted contracts excluded"; }
  delete body.nationality; MK.strict = true; let r; try { r = baseCall(key, ep, body); } finally { MK.strict = false; } if (warn && r && r.status == 200 && r.body && typeof r.body == "object") r.body.warning = warn; return r; };
