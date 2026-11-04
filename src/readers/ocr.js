/* OCR: taranmış PDF ve fotoğraflar. Görüntü temizleme ve okunan değerlerin düzeltilmesi bizim kurallarımızla yapılır;
   karakter tanıma için tarayıcıda çalışan açık kaynaklı Tesseract motoru kullanılır (yapay zekâ servisi yok, okuma başına maliyet yok). */
const OC = B4M.ocr = {};
OC.URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"; OC.W = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js"; OC.C = "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1";
let _w = null;
OC.load = () => { if (globalThis.Tesseract) return Promise.resolve(); return new Promise((okk, bad) => { const s = document.createElement("script"); s.src = OC.URL; s.onload = () => okk(); s.onerror = () => bad(new Error("load")); document.head.appendChild(s); }); };
OC.worker = async prog => { await OC.load(); if (_w) return _w; _w = await Tesseract.createWorker("eng+tur", 1, { workerPath: OC.W, corePath: OC.C, logger: m => { if (prog && m.status) prog(m); } }); await _w.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" }); return _w; };
/* görüntü ön işleme: gri ton → Otsu eşikleme → uzun yatay/dikey tablo çizgilerini silme (RGBA dizisi üzerinde, DOM'suz) */
OC.prepPixels = (d, W, H) => {
  const g = new Uint8Array(W * H), hist = new Float64Array(256);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; g[j] = v; hist[v]++; }
  let s1 = 0; for (let k = 0; k < 256; k++) s1 += k * hist[k]; let wB = 0, sB = 0, mx = 0, thr = 128;
  for (let k = 0; k < 256; k++) { wB += hist[k]; if (!wB) continue; const wF = W * H - wB; if (!wF) break; sB += k * hist[k]; const mB = sB / wB, mF = (s1 - sB) / wF, bt = wB * wF * (mB - mF) * (mB - mF); if (bt > mx) { mx = bt; thr = k; } }
  const dk = new Uint8Array(W * H); for (let j = 0; j < W * H; j++) dk[j] = g[j] <= thr ? 1 : 0;
  const rm = new Uint8Array(W * H), mh = Math.max(40, W / 25 | 0), mv = Math.max(40, H / 25 | 0);
  for (let y = 0; y < H; y++) { let s = -1; for (let x = 0; x <= W; x++) { const on = x < W && dk[y * W + x]; if (on && s < 0) s = x; else if (!on && s >= 0) { if (x - s >= mh) for (let k = s; k < x; k++) rm[y * W + k] = 1; s = -1; } } }
  for (let x = 0; x < W; x++) { let s = -1; for (let y = 0; y <= H; y++) { const on = y < H && dk[y * W + x]; if (on && s < 0) s = y; else if (!on && s >= 0) { if (y - s >= mv) for (let k = s; k < y; k++) rm[k * W + x] = 1; s = -1; } } }
  for (let j = 0, i = 0; j < W * H; j++, i += 4) { const v = dk[j] && !rm[j] ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  return { thr };
};
OC.prep = cv => { const cx = cv.getContext("2d", { willReadFrequently: true }), im = cx.getImageData(0, 0, cv.width, cv.height); OC.prepPixels(im.data, cv.width, cv.height); cx.putImageData(im, 0, 0); return cv; };
/* OCR sözcüklerini satır satır düzelt: tablo çizgisi artıkları, tarih ayırıcıları, kayıp ondalık nokta */
const oNum = s => /^-?\d+([.,]\d+)?$/.test(s), oDate = s => /^\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}$/.test(s);
OC.fix = items => {
  let fix = 0, L = [];
  if (items.length && items.every(x => x.ln != null)) { const m = new Map(); items.forEach(x => { if (!m.has(x.ln)) m.set(x.ln, []); m.get(x.ln).push(x); }); L = [...m.values()].map(it => { const ys = it.map(x => x.y).sort((a, b) => a - b), y = ys[ys.length >> 1], hs = it.map(x => x.h).sort((a, b) => a - b), h = hs[hs.length >> 1]; return { y, it: it.sort((a, b) => a.x - b.x).map(x => ({ ...x, y, h })) }; }).sort((a, b) => a.y - b.y); }
  else items.slice().sort((a, b) => a.y - b.y || a.x - b.x).forEach(x => { const l = L[L.length - 1]; if (l && Math.abs(x.y - l.y) <= Math.max(2, .5 * Math.min(x.h, l.h))) l.it.push(x); else L.push({ y: x.y, it: [x] }); });
  const out = []; L.forEach(l => {
    let it = l.it.map(x => {
      let v = x.s.replace(/[£€#](?=\s*\d)|^[£€#]$/g, "+").replace(/^[|\[\]{}«»"“”'`_~—–]+(?=[\dA-Za-zÇĞİÖŞÜçğıöşü(])/, "").replace(/^[(](?=[A-Za-zÇĞİÖŞÜ])/, "").replace(/(?<=\d)[|\[\]{}"“”'`_~—–°«»]+$/, "").replace(/\bch[i1l]d\b/gi, "chd");
      const m = v.match(/^[.,:]?(\d+[.,]\d+|\d+)[.,:;A-Za-z]{1,2}$/); if (m && !/^\d+[.,]\d+$/.test(v) && !/[A-Za-z]{2}/.test(v.replace(m[1], ""))) { v = m[1]; fix++; } else if (/^[.,]\d+[.,]?\d*$/.test(v)) { v = v.slice(1); fix++; }
      return { ...x, s: v };
    }).filter(x => x.s && !/^[|\[\]_~—–=\-:;.,'"“”`<>©®°*\\\/]+$/.test(x.s));
    const nd = it.filter(x => oDate(x.s)).length;
    if (nd >= 3) it.forEach(x => { if (oDate(x.s)) return; const g = x.s.replace(/\D/g, ""); let r = null; if (g.length == 6) r = g; else if (g.length == 8 && /[17]/.test(g[2]) && /[17]/.test(g[5])) r = g.slice(0, 2) + g.slice(3, 5) + g.slice(6); else if (g.length == 7 && /[17]/.test(g[2])) r = g.slice(0, 2) + g.slice(3); else if (g.length == 7 && /[17]/.test(g[4])) r = g.slice(0, 4) + g.slice(5); if (r && +r.slice(0, 2) >= 1 && +r.slice(0, 2) <= 31 && +r.slice(2, 4) >= 1 && +r.slice(2, 4) <= 12) { x.s = `${r.slice(0, 2)}/${r.slice(2, 4)}/${r.slice(4)}`; x.fx = 1; fix++; } });
    const nums = it.filter(x => oNum(x.s)), dec = nums.filter(x => /[.,]\d+$/.test(x.s));
    if (nums.length >= 4 && dec.length >= nums.length * .4) { const dl = {}; dec.forEach(x => { const k = x.s.split(/[.,]/)[1].length; dl[k] = (dl[k] || 0) + 1; }); const k = +Object.entries(dl).sort((a, b) => b[1] - a[1])[0][0], ip = Math.max(...dec.map(x => x.s.split(/[.,]/)[0].length)); nums.forEach(x => { if (/^\d+$/.test(x.s) && x.s.length > ip && x.s.length - k >= 1) { x.s = x.s.slice(0, x.s.length - k) + "." + x.s.slice(x.s.length - k); x.fx = 1; fix++; } }); }
    out.push(...it);
  });
  const D = out.filter(x => /^\d+[.,]\d+$/.test(x.s));
  if (D.length >= 10) { const dl = {}, il = D.map(x => x.s.split(/[.,]/)[0].length).sort((a, b) => a - b), ip = il[Math.floor(il.length * .95)]; D.forEach(x => { const k = x.s.split(/[.,]/)[1].length; dl[k] = (dl[k] || 0) + 1; }); const k = +Object.entries(dl).sort((a, b) => b[1] - a[1])[0][0]; out.forEach(x => { if (/^\d+$/.test(x.s) && x.s.length >= ip + k && x.s.length >= 4 && x.s.length - k >= 1 && !x.fx) { x.s = x.s.slice(0, x.s.length - k) + "." + x.s.slice(x.s.length - k); x.fx = 1; fix++; } }); }
  return { items: out, fix };
};
/* Tesseract TSV çıktısını (sunucu tarafı veya test) sözcük listesine çevirir */
OC.fromTsv = tsv => String(tsv).trim().split("\n").slice(1).map(l => l.split("\t")).filter(c => c[0] == "5" && c[11] && c[11].trim()).map(c => ({ s: c[11].trim(), x: +c[6], w: +c[8], y: +c[7] + +c[9], h: +c[9], c: +c[10], ln: c[2] + "-" + c[3] + "-" + c[4] }));
OC.canvas = async (cv, prog) => {
  const w = await OC.worker(prog); OC.prep(cv); const { data } = await w.recognize(cv); const W = [];
  (data.lines || []).forEach((l, li) => (l.words || []).forEach(x => { if (x.text && x.text.trim()) W.push({ s: x.text.trim(), x: x.bbox.x0, w: x.bbox.x1 - x.bbox.x0, y: x.bbox.y1, h: x.bbox.y1 - x.bbox.y0, c: x.confidence, ln: li }); }));
  if (!W.length) (data.words || []).forEach(x => { if (x.text && x.text.trim()) W.push({ s: x.text.trim(), x: x.bbox.x0, w: x.bbox.x1 - x.bbox.x0, y: x.bbox.y1, h: x.bbox.y1 - x.bbox.y0, c: x.confidence }); });
  const r = OC.fix(W); return { items: r.items, fix: r.fix, low: W.filter(x => x.c < 60 && /\d/.test(x.s)).length };
};
OC.pdf = async (buf, prog) => {
  const lib = await B4M.pdfx.load(), doc = await lib.getDocument({ data: buf }).promise, P = []; let fix = 0, low = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1 }), sc = Math.min(4, Math.max(2, 2400 / vp.width)), v2 = pg.getViewport({ scale: sc }), cv = document.createElement("canvas"); cv.width = v2.width | 0; cv.height = v2.height | 0;
    await pg.render({ canvasContext: cv.getContext("2d"), canvas: cv, viewport: v2 }).promise; prog && prog({ status: t("Sayfa {i}/{n} okunuyor", { i, n: doc.numPages }), progress: (i - 1) / doc.numPages });
    const r = await OC.canvas(cv, m => prog && prog({ status: `${i}/${doc.numPages}: ${m.status}`, progress: ((i - 1) + (m.progress || 0)) / doc.numPages })); P.push({ items: r.items }); fix += r.fix; low += r.low;
  }
  return { pages: P, fix, low };
};
OC.image = async (file, prog) => {
  const url = URL.createObjectURL(file);
  try { const img = await new Promise((okk, bad) => { const i = new Image(); i.onload = () => okk(i); i.onerror = () => bad(new Error("img")); i.src = url; }); const sc = Math.min(3, Math.max(1, 2400 / img.naturalWidth)), cv = document.createElement("canvas"); cv.width = img.naturalWidth * sc | 0; cv.height = img.naturalHeight * sc | 0; const cx = cv.getContext("2d"); cx.imageSmoothingQuality = "high"; cx.drawImage(img, 0, 0, cv.width, cv.height); const r = await OC.canvas(cv, prog); return { pages: [{ items: r.items }], fix: r.fix, low: r.low }; }
  finally { URL.revokeObjectURL(url); }
};
