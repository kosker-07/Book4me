/* Derleyici: modülleri sırayla tek bir HTML dosyasına (dist/index.html) birleştirir.
   Her modül kendi kapsamında (IIFE) çalışır; ortak ad alanı B4M'dir. */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, ".."), SRC = path.join(ROOT, "src");
const CORE = ["core/util.js", "core/i18n.js", "lang/tr.js", "lang/en.js", "lang/ar.js", "lang/ru.js", "core/store.js", "core/app.js",
  "data/loc.js", "data/xdemo.js",
  "domain/parties.js", "domain/auth.js", "domain/tenants.js", "domain/pricing.js", "domain/product.js", "domain/search.js", "domain/booking.js",
  "domain/accounting.js", "domain/ops.js", "domain/reports.js", "domain/integrations.js", "domain/agents.js", "domain/jobs.js",
  "readers/xlsx.js", "readers/xlparse.js", "readers/pdfx.js", "readers/ocr.js", "readers/impx.js", "domain/seed.js"];
const UI = ["ui/dom.js", "ui/brand.js", "ui/shell.js", "ui/v-common.js", "ui/v-product.js", "ui/v-sales.js", "ui/v-booking.js", "ui/v-acc.js", "ui/v-ops.js", "ui/v-dash.js",
  "ui/v-dmc.js", "ui/v-hq.js", "ui/v-int.js"];
/* güncellemeler (eklentiler): ana koda dokunmadan src/updates/ altına sırayla eklenir, açılıştan önce yüklenir */
const UPD = fs.existsSync(path.join(SRC, "updates")) ? fs.readdirSync(path.join(SRC, "updates")).filter(f => /^u\d+.*\.js$/.test(f)).sort().map(f => "updates/" + f) : [];
UI.push(...UPD, "ui/main.js");
const PRELUDE = `"use strict";const B4M=globalThis.B4M={util:{},i18n:{},data:{},env:{}};B4M.t=(s,p)=>B4M.i18n.t(s,p);B4M.esc=s=>B4M.util.esc(s);\n`;
const wrap = (f, code) => `\n/* ===== ${f} ===== */\n;(function(B4M,U,I,t,esc){${code}\n})(B4M,B4M.util,B4M.i18n,B4M.t,B4M.esc);\n`;
const bundle = files => PRELUDE + files.filter(f => fs.existsSync(path.join(SRC, f))).map(f => wrap(f, fs.readFileSync(path.join(SRC, f), "utf8"))).join("");
/* testler için: arayüz dışı güncellemeler (adı "-ui" içermeyenler) çekirdeğe eklenir */
const CORE_UPD = UPD.filter(f => !/-ui/.test(f));
module.exports = { CORE, UI, UPD, CORE_UPD, bundle, ROOT, SRC };
if (require.main === module) {
  const js = bundle([...CORE, ...UI]);
  const shell = fs.readFileSync(path.join(SRC, "ui/shell.html"), "utf8");
  if (js.includes("</script")) throw new Error("bundle contains </script");
  const html = shell.replace("/*@@APP@@*/", () => js);
  fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "dist/index.html"), html);
  console.log("dist/index.html", (html.length / 1024).toFixed(0) + " KB");
}
