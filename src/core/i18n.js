/* Dil altyapısı: tüm metinler dil dosyalarından gelir (gettext yaklaşımı: kaynak metin Türkçe, anahtar olarak kullanılır).
   Ekrana sonradan çeviri uygulanmaz; her metin t() ile çizim anında seçilen dilde üretilir. */
Object.assign(I, { lang: "tr", dicts: { tr: {}, en: {}, ar: {}, ru: {} }, missing: new Set() });
I.LANGS = [["tr", "Türkçe"], ["en", "English"], ["ar", "العربية"], ["ru", "Русский"]];
I.LOC = { tr: "tr-TR", en: "en-GB", ar: "ar-EG-u-nu-latn", ru: "ru-RU" };
I.set = l => { I.lang = I.dicts[l] ? l : "tr"; };
I.dir = () => I.lang == "ar" ? "rtl" : "ltr";
/* t("Merhaba {ad}", {ad:"Ali"}) */
I.t = (s, p) => {
  if (s == null) return "";
  s = String(s);
  let x = s;
  if (I.lang != "tr") { const d = I.dicts[I.lang]; if (d && d[s] != null) x = d[s]; else if (s.trim() && /[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(s)) I.missing.add(s); }
  if (p) x = x.replace(/\{(\w+)\}/g, (m, k) => p[k] != null ? p[k] : m);
  return x;
};
/* parametreleri de çevir: parametre değeri dil dosyasında varsa o dilde yazılır */
I.tp = (s, p) => { if (!p || I.lang == "tr") return I.t(s, p); const d = I.dicts[I.lang] || {}, q = {}; Object.keys(p).forEach(k => q[k] = typeof p[k] == "string" && d[p[k]] != null ? d[p[k]] : p[k]); return I.t(s, q); };
/* sayılı ifadeler: tn(3,"gece") → "3 gece" / "3 nights" / "3 ليلة" / "3 ночи" */
I.PL = {};
I.tn = (n, w) => {
  const x = I.PL[w], v = +n;
  if (I.lang == "tr" || !x) return `${n} ${I.lang == "tr" ? w : I.t(w)}`;
  if (I.lang == "en") return `${n} ${v == 1 ? x[0] : x[1]}`;
  if (I.lang == "ar") return `${n} ${x[2]}`;
  const m10 = v % 10, m100 = v % 100, f = m10 == 1 && m100 != 11 ? x[3] : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? x[4] : x[5];
  return `${n} ${f}`;
};
/* para ve tarih biçimi seçilen dile göre */
I.num = (a, d = 2) => (+a || 0).toLocaleString(I.LOC[I.lang], { minimumFractionDigits: 0, maximumFractionDigits: d });
I.fm = (a, c) => I.num(a, c == "JPY" ? 0 : 2) + " " + (c || "");
I.fd = d => { if (!d || !/^\d{4}-\d\d-\d\d/.test(d)) return d || ""; const [y, m, dd] = d.slice(0, 10).split("-"); const tm = d.length > 10 ? " " + d.slice(11, 16) : ""; return (I.lang == "en" || I.lang == "ar" ? `${dd}/${m}/${y}` : `${dd}.${m}.${y}`) + tm; };
I.fdr = (a, b) => b ? `${I.fd(a)} → ${I.fd(b)}` : I.fd(a);
I.MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
I.MSHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
I.WD = ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"];
I.DAYN = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
