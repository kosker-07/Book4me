/* u001 · Platform logosu yükleme alanı
   Back Office → "Platform markası" sekmesinden logo yüklenir. Yeni logo eskisinin yerine geçer: önceki yükleme silinir, saklanmaz.
   Logo; üst bant, giriş ekranı ve platform belgelerinde (fatura, voucher, sözleşme) görünür. DMC'lerin kendi logoları ayrıdır (Yönetim → Marka ve alan adı). */
const UI = B4M.ui, A = UI.A, S = UI.S, BRU = B4M.uiBrand, VH = B4M.vHQ, AU = B4M.auth, db = () => B4M.db;
AU.PERMS.h.push(["br", "Platform markası"]);
VH.TABS.splice(VH.TABS.findIndex(x => x[0] == "us"), 0, ["br", "Platform markası"]);
BRU.pLogo = () => (db() && db().cfg("platformLogo")) || "";
const baseLogo = BRU.logo, baseDoc = BRU.docHead, baseBody = VH.body;
BRU.logo = (x, sz = 52) => !x && BRU.pLogo() ? `<img class="plogo" src="${U.esc(BRU.pLogo())}" alt="book4me ai" style="height:${sz}px;max-width:280px;object-fit:contain;display:block">` : baseLogo(x, sz);
BRU.docHead = (dmc, sub, right) => { if (dmc || !BRU.pLogo()) return baseDoc(dmc, sub, right);
  return `<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:2px solid #B8862B;padding-bottom:12px;margin-bottom:16px"><div style="display:flex;gap:12px;align-items:center"><img src="${U.esc(BRU.pLogo())}" alt="book4me ai" style="height:46px;max-width:220px;object-fit:contain"><div style="color:#5d7075">www.book4me-ai.com · ${sub}</div></div><div style="text-align:end">${right}</div></div>`; };
VH.body = k => k == "br" ? VH.pBrand() : baseBody(k);
VH.pBrand = () => { const L = BRU.pLogo(), can = B4M.app.user().role == "admin" || AU.can("br");
  return UI.box(t("Platform markası"), `<p class="mu" style="margin-top:0">${t("Yüklediğiniz logo eskisinin yerine geçer ve hemen tüm platform ekranlarına, giriş sayfasına ve platform belgelerine yansır. Önceki logo saklanmaz.")}</p>
  <div class="row" style="align-items:center;gap:16px"><div style="padding:12px;border:1px solid var(--ln);border-radius:10px;background:#fff;min-width:200px;display:flex;justify-content:center">${L ? `<img src="${U.esc(L)}" alt="" style="max-height:80px;max-width:260px;object-fit:contain">` : BRU.amblem(64, "pb") + BRU.word()}</div>
  ${can ? `<label class="g" style="cursor:pointer;padding:8px 14px;border:1px solid var(--ln);border-radius:8px">${t("Logo yükle (PNG, JPG veya SVG)")}<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style="display:none" ${UI.c("pLogo")}></label>` : ""}</div>
  <p class="mu" style="margin:10px 0 0">${t("Öneri: şeffaf arka planlı, yatay logo; en az 400 piksel genişlik.")}</p>`); };
/* şeffaflığı korumak için PNG olarak küçültülür */
const pngSmall = (f, max) => new Promise((okk, bad) => { const r = new FileReader(); r.onload = e => { const im = new Image(); im.onload = () => { const sc = Math.min(1, max / Math.max(im.width, im.height)), cn = document.createElement("canvas"); cn.width = Math.round(im.width * sc); cn.height = Math.round(im.height * sc); cn.getContext("2d").drawImage(im, 0, 0, cn.width, cn.height); okk(cn.toDataURL("image/png")); }; im.onerror = () => bad(new Error("img")); im.src = e.target.result; }; r.onerror = () => bad(new Error("read")); r.readAsDataURL(f); });
A.pLogo = async (a, el) => { const f = el.files[0]; if (!f) return false; if (!/^image\//.test(f.type)) return B4M.res.no("Yalnızca görsel yükleyebilirsin.");
  const data = /svg/.test(f.type) ? await UI.readData(f) : await pngSmall(f, 800); db().cfg("platformLogo", data); B4M.audit.log("brand.platformLogo", "P", f.name, "P"); return B4M.res.ok("Yeni logo yüklendi; eski logo silindi."); };
