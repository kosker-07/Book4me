/* Node test yükleyicisi: arayüz dışındaki tüm modülleri (veri, iş kuralları, okuyucular) bir sanal bağlamda çalıştırır. */
const vm = require("vm"), zlib = require("zlib");
const { CORE, CORE_UPD, bundle } = require("./build.js");
module.exports = function load(opts = {}) {
  const ctx = { console, TextDecoder, TextEncoder, URL, setTimeout, clearTimeout, structuredClone, Intl, Date, Math, JSON };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(bundle([...CORE, ...(opts.noUpd ? [] : CORE_UPD)]), ctx, { filename: "b4m-core.js" });
  const B = ctx.B4M; B.env.inflateRaw = async u8 => new Uint8Array(zlib.inflateRawSync(Buffer.from(u8)));
  if (opts.now) B.util._now = opts.now;
  if (opts.init !== false) B.app.init(B.store.MemoryAdapter());
  return B;
};
