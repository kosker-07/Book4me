/* Yama 1 · A2 — eski Excel (.xls, BIFF8) ve CSV fiyat listeleri.
   Kendi okuyucumuz: OLE2 (Compound File) kabından "Workbook" akışını çıkarır, BIFF8 kayıtlarını okur.
   Çıktı .xlsx okuyucusuyla aynı biçimdedir: [{name, rows}], tarih biçimli hücreler Date olur. */
const X = B4M.xlsx, IX = B4M.imp;
const XL = B4M.xls = {};
const u16 = (b, o) => b[o] | (b[o + 1] << 8), u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
/* OLE2 kabı */
XL.cfb = buf => {
  const b = new Uint8Array(buf); if (u32(b, 0) != 0xE011CFD0 || u32(b, 4) != 0xE11AB1A1) throw new Error("okunamadı");
  const ss = 1 << u16(b, 0x1E), mss = 1 << u16(b, 0x20), nFat = u32(b, 0x2C), dir0 = u32(b, 0x30), cutoff = u32(b, 0x38), mf0 = u32(b, 0x3C), nMf = u32(b, 0x40); let dif = u32(b, 0x44), nDif = u32(b, 0x48);
  const sec = i => 512 + i * ss, fatSecs = []; for (let i = 0; i < 109 && fatSecs.length < nFat; i++) { const v = u32(b, 0x4C + i * 4); if (v < 0xFFFFFFFA) fatSecs.push(v); }
  while (nDif-- > 0 && dif < 0xFFFFFFFA && fatSecs.length < nFat) { for (let i = 0; i < ss / 4 - 1 && fatSecs.length < nFat; i++) { const v = u32(b, sec(dif) + i * 4); if (v < 0xFFFFFFFA) fatSecs.push(v); } dif = u32(b, sec(dif) + ss - 4); }
  const fat = []; fatSecs.forEach(s => { for (let i = 0; i < ss / 4; i++) fat.push(u32(b, sec(s) + i * 4)); });
  const chain = (s, F) => { const L = []; let n = 0; while (s < 0xFFFFFFFA && n++ < 1e6) { L.push(s); s = F[s]; } return L; };
  const read = (s, size) => { const L = chain(s, fat), out = new Uint8Array(L.length * ss); L.forEach((x, i) => out.set(b.subarray(sec(x), sec(x) + ss), i * ss)); return size != null ? out.subarray(0, size) : out; };
  const dirB = read(dir0), ents = []; for (let o = 0; o + 128 <= dirB.length; o += 128) { const nl = u16(dirB, o + 0x40); let name = ""; for (let i = 0; i < nl / 2 - 1; i++) name += String.fromCharCode(u16(dirB, o + i * 2)); ents.push({ name, type: dirB[o + 0x42], start: u32(dirB, o + 0x74), size: u32(dirB, o + 0x78) }); }
  const root = ents.find(e => e.type == 5), mini = root && root.size ? read(root.start, root.size) : new Uint8Array(0), mfat = [];
  if (nMf) { const m = read(mf0); for (let i = 0; i < m.length / 4; i++) mfat.push(u32(m, i * 4)); }
  const get = e => { if (e.size >= cutoff) return read(e.start, e.size); const L = chain(e.start, mfat), out = new Uint8Array(L.length * mss); L.forEach((x, i) => out.set(mini.subarray(x * mss, x * mss + mss), i * mss)); return out.subarray(0, e.size); };
  return { ents, get };
};
/* BIFF8 */
const DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const isDateFmt = s => /[dmyhs]/i.test(String(s).replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")) && !/[0#?]/.test(String(s).replace(/"[^"]*"|\[[^\]]*\]/g, "").replace(/[dmyhs]+/gi, ""));
XL.read = buf => {
  const C = XL.cfb(buf), e = C.ents.find(x => /^(workbook|book)$/i.test(x.name)); if (!e) throw new Error("okunamadı"); const w = C.get(e);
  const recs = []; for (let o = 0; o + 4 <= w.length;) { const ty = u16(w, o), ln = u16(w, o + 2); recs.push({ ty, o: o + 4, ln }); o += 4 + ln; }
  const sst = [], fmts = {}, xfs = [], sheets = []; let d1904 = false, codepage = 1252;
  /* SST CONTINUE kayıtlarıyla bölünebilir: parçaları ardışık okuyan akış */
  const strm = (i0) => { let ri = i0, r = recs[ri], p = r.o; const next = () => { ri++; r = recs[ri]; p = r.o; return r && r.ty == 0x3C; };
    const need = () => { if (p >= r.o + r.ln) next(); };
    return { u8() { need(); return w[p++]; }, u16() { const lo = this.u8(), hi = this.u8(); return lo | (hi << 8); }, u32() { const a = this.u16(), b2 = this.u16(); return (a | (b2 << 16)) >>> 0; },
      chars(n, wide) { let s = ""; while (n > 0) { if (p >= r.o + r.ln) { next(); wide = (w[p++] & 1) == 1; } const avail = r.o + r.ln - p, take = Math.min(n, wide ? avail >> 1 : avail); for (let i = 0; i < take; i++) { s += String.fromCharCode(wide ? u16(w, p) : w[p]); p += wide ? 2 : 1; } n -= take; } return s; },
      skip(n) { while (n > 0) { need(); const k = Math.min(n, r.o + r.ln - p); p += k; n -= k; } } }; };
  const ustr = (o, lenBytes) => { const n = lenBytes == 1 ? w[o] : u16(w, o); let q = o + lenBytes; const fl = w[q++], wide = fl & 1, rich = fl & 8, ext = fl & 4; if (rich) q += 2; if (ext) q += 4; let s = ""; for (let i = 0; i < n; i++) { s += String.fromCharCode(wide ? u16(w, q) : w[q]); q += wide ? 2 : 1; } return s; };
  for (let i = 0; i < recs.length; i++) { const { ty, o } = recs[i];
    if (ty == 0x22) d1904 = u16(w, o) == 1; else if (ty == 0x42) codepage = u16(w, o);
    else if (ty == 0x41E) fmts[u16(w, o)] = ustr(o + 2, 2);
    else if (ty == 0xE0) xfs.push(u16(w, o + 2));
    else if (ty == 0x85) sheets.push({ pos: u32(w, o), kind: w[o + 5], name: ustr(o + 6, 1) });
    else if (ty == 0xFC) { const S = strm(i); S.u32(); const n = S.u32(); for (let k = 0; k < n; k++) { const cch = S.u16(), fl = S.u8(); const cr = fl & 8 ? S.u16() : 0, ex = fl & 4 ? S.u32() : 0; sst.push(S.chars(cch, (fl & 1) == 1)); S.skip(cr * 4 + ex); } }
  }
  const isDate = xf => { const f = xfs[xf]; return f != null && (DATE_FMT.has(f) || (fmts[f] != null && isDateFmt(fmts[f]))); };
  const toDate = v => new Date(Math.round(((d1904 ? v + 1462 : v) - 25569) * 864e5));
  const num = (v, xf) => isDate(xf) && v > 0 ? toDate(v) : +(+v).toPrecision(15);
  const rk = v => { let n; if (v & 2) n = v >> 2; else { const a = new ArrayBuffer(8), dv = new DataView(a); dv.setUint32(4, v & 0xFFFFFFFC, true); dv.setUint32(0, 0, true); n = dv.getFloat64(0, true); } return v & 1 ? n / 100 : n; };
  const dbl = o => new DataView(w.buffer, w.byteOffset + o, 8).getFloat64(0, true);
  return sheets.filter(s => s.kind == 0).map(s => {
    const cells = [], refs = []; let mr = -1, mc = -1, i = recs.findIndex(r => r.o - 4 == s.pos), pend = null; if (i < 0) return { name: s.name, rows: [] };
    const put = (r, c, v) => { cells.push([r, c, v]); if (r > mr) mr = r; if (c > mc) mc = c; };
    for (i++; i < recs.length; i++) { const { ty, o, ln } = recs[i]; if (ty == 0x0A) break;
      if (ty == 0xFD) put(u16(w, o), u16(w, o + 2), sst[u32(w, o + 6)] ?? null);
      else if (ty == 0x203) put(u16(w, o), u16(w, o + 2), num(dbl(o + 6), u16(w, o + 4)));
      else if (ty == 0x27E) put(u16(w, o), u16(w, o + 2), num(rk(u32(w, o + 6)), u16(w, o + 4)));
      else if (ty == 0xBD) { const r = u16(w, o), c0 = u16(w, o + 2), n = (ln - 6) / 6; for (let k = 0; k < n; k++) put(r, c0 + k, num(rk(u32(w, o + 4 + k * 6 + 2)), u16(w, o + 4 + k * 6))); }
      else if (ty == 0x204) put(u16(w, o), u16(w, o + 2), ustr(o + 6, 2));
      else if (ty == 0x205) put(u16(w, o), u16(w, o + 2), w[o + 7] ? null : !!w[o + 6]);
      else if (ty == 0x06) { const r = u16(w, o), c = u16(w, o + 2), xf = u16(w, o + 4), cce = u16(w, o + 20), t0 = w[o + 22]; if (cce == 5 && (t0 == 0x24 || t0 == 0x44 || t0 == 0x64)) refs.push([r, c, u16(w, o + 23), u16(w, o + 25) & 0x3FFF, xf]); if (u16(w, o + 12) == 0xFFFF) { const k = w[o + 6]; if (k == 0) pend = [r, c]; else if (k == 1) put(r, c, !!w[o + 8]); } else put(r, c, num(dbl(o + 6), xf)); }
      else if (ty == 0x207 && pend) { put(pend[0], pend[1], ustr(o, 2)); pend = null; }
    }
    const rows = mr < 0 ? [] : Array.from({ length: mr + 1 }, () => Array(mc + 1).fill(null)); cells.forEach(([r, c, v]) => { rows[r][c] = typeof v == "string" && !v.trim() ? null : v; });
    /* önbellek değeri yazılmamış tek başvurulu formüller (=C18 gibi): başvurulan hücrenin değeri */
    for (let k = 0; k < 3; k++) refs.forEach(([r, c, rr, cc]) => { const v = (rows[rr] || [])[cc]; if ((rows[r][c] === 0 || rows[r][c] == null) && v != null && v !== 0) rows[r][c] = v; });
    return { name: s.name, rows };
  });
};
/* CSV fiyat listesi: tek sayfa; sayısal metinler sayıya çevrilir */
XL.csv = (text, name) => { const R = X.csv(text).map(r => r.map(v => { const s = String(v ?? "").trim(); if (!s) return null; const n = s.replace(/\s/g, ""); return /^-?\d+([.,]\d+)?$/.test(n) ? +n.replace(",", ".") : s; })); return [{ name: String(name || "CSV").replace(/\.[^.]+$/, ""), rows: R }]; };
/* dosya okuma: .xls ve .csv eklendi; diğer türler eskisi gibi */
const baseRead = IX.readFiles;
IX.readFiles = async (S, F, prog) => {
  F = [...(F || [])]; if (!F.length) return { ok: false };
  const ext = F.filter(f => /\.(xls|csv)$/i.test(f.name)); if (!ext.length) return baseRead(S, F, prog);
  if (F.some(f => !/\.(xlsx|xlsm|xls|csv|pdf|jpe?g|png|webp|bmp)$/i.test(f.name))) return { ok: false, msg: "Excel (.xlsx, .xls), CSV, PDF veya fotoğraf (.jpg, .png) yükleyebilirsiniz." };
  const sh = [], msg = [];
  for (const f of ext) { try { if (/\.csv$/i.test(f.name)) XL.csv(await f.text(), f.name).forEach(s => sh.push(s)); else XL.read(await f.arrayBuffer()).forEach(s => sh.push(s)); } catch (e) { msg.push(`${f.name}: ${t("okunamadı")}`); } }
  const rest = F.filter(f => !ext.includes(f));
  if (rest.length) { const T = IX.blank(); const r = await baseRead(T, rest, prog); if (r.ok && T.src) { /* diğer dosyaların sayfalarını yeniden okumak yerine birleştir */ T.hotels.forEach(h => S.hotels.push(h)); } if (r.msg) msg.push(r.msg); }
  S.busy = false; if (!sh.length) return { ok: false, msg: msg.join(" · ") || "Dosyada okunabilir sayfa bulunamadı." };
  const keep = S.hotels.slice(); IX.load(S, sh, F.map(f => f.name).join(", ")); if (rest.length) keep.forEach(h => S.hotels.push(h)); S.fileMsg = msg; return { ok: true, n: S.hotels.length };
};
