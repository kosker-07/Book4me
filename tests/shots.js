const { chromium } = require("playwright"), path = require("path");
(async () => {
  const br = await chromium.launch(), out = process.argv[2] || "/home/claude/shots", steps = JSON.parse(process.argv[3] || "[]");
  const pg = await br.newPage({ viewport: { width: +(process.env.W || 1280), height: 900 }, colorScheme: process.env.DARK ? "dark" : "light" });
  await pg.route(/^https?:\/\//, r => r.abort()); pg.on("pageerror", e => console.log("ERR", e.message));
  await pg.goto("file://" + path.join(__dirname, "../dist/index.html") + (process.env.HASH || ""));
  for (const [name, js] of steps) { await pg.evaluate(js); await pg.waitForTimeout(150); await pg.screenshot({ path: `${out}/${name}.png`, fullPage: !!process.env.FULL }); }
  await br.close();
})();
