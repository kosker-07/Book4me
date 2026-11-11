/* Açılış: veri katmanını kur, dili seç, olayları bağla, günlük işleri çalıştır ve ilk ekranı çiz. */
const UI = B4M.ui;
B4M.boot = () => {
  B4M.app.init();
  B4M.auth.restore();
  let l = ""; try { l = localStorage.getItem("b4m-lang") || ""; } catch (e) { }
  if (!l) l = "tr";
  I.set(l);
  UI.bind(document);
  try { const r = B4M.jobs.runIfDue(); if (r) B4M.db.commit(); } catch (e) { console.error(e); }
  window.addEventListener("hashchange", () => { UI.render(); });
  /* fiyat listesi: sürükle-bırak */
  document.addEventListener("dragover", ev => { if (ev.target.closest && ev.target.closest("#ixdrop")) { ev.preventDefault(); ev.target.closest("#ixdrop").classList.add("on"); } });
  document.addEventListener("dragleave", ev => { const d = ev.target.closest && ev.target.closest("#ixdrop"); if (d) d.classList.remove("on"); });
  document.addEventListener("drop", ev => { const d = ev.target.closest && ev.target.closest("#ixdrop"); if (!d) return; ev.preventDefault(); d.classList.remove("on"); UI.run("ixFiles", { files: ev.dataTransfer.files }, d, ev); });
  /* süresi geçen ödemeler: açıkken dakikada bir kontrol */
  setInterval(() => { try { if (B4M.book.sweep()) { B4M.db.commit(); UI.render(); } } catch (e) { } }, 60000);
  UI.render();
};
if (typeof document != "undefined") { if (document.readyState == "loading") document.addEventListener("DOMContentLoaded", B4M.boot); else B4M.boot(); }
