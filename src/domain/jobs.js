/* Zamanlanmış işler: çevrimdışı modelde açılışta günde bir kez ve Back Office'ten elle çalışır; sunucuya geçişte gece çalışan iş olur. */
const JB = B4M.jobs = {};
const db = () => B4M.db, { ok } = B4M.res;
JB.nightly = (by) => {
  const r = { at: U.now(), by: by || "sistem" };
  r.sweep = B4M.book.sweep();
  if (B4M.int.isOn("P", "tcmb")) { B4M.int.tcmbPull(); r.rates = 1; }
  r.deliver = B4M.int.deliver().p.n;
  r.agents = ["P", ...db().where("dmcs", d => !d.parent).map(d => d.id)].reduce((s, tid) => s + (db().where("agents", a => a.tid == tid && a.on).length ? B4M.agents.run(tid).p.n : 0), 0);
  r.remind = B4M.agents.remind();
  db().cfg("lastNightly", U.today()); db().add("jobs", { ...r, tid: "P" });
  return ok("Gece işleri çalıştı: ön ödeme/iptal taraması, kur, entegrasyon kuyruğu, agentlar ({n} yeni iş).", { n: r.agents }, { r });
};
JB.runIfDue = () => { if (db().cfg("lastNightly") != U.today()) return JB.nightly(); return null; };
