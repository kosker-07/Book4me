/* Yama 2b · rezervasyona müdahale. Yönetici kullanıcı bazında verir; departman şablonlarına girmez, firma yöneticisinde hepsi vardır.
   mud  = üstlenme + misafir/not/oda/tarih/kişi değişikliği, tedarikçi onayı beklemeden ve iptal süresi geçmiş olsa da
   mudf = fiyatı elle düzeltme, iptal cezasını kaldırma (iade)
   mudt = tedarikçi değiştirme (rebooking'in elle hali; yalnızca Back Office)
   Kapsam: DMC yalnızca kendi şirketinin (kök + alt) tedarikçi olduğu rezervasyonlara, Back Office hepsine. Satış hesabı müdahale edemez.
   Her müdahalede: gerekçe zorunlu (en az 10 karakter), öncesi/sonrası işlem kaydına, tutar değişirse cari fark kaydı, taraflara bildirim,
   bekleyen değişiklik talebi kapanır; kesilmiş fatura varsa "fark faturası gerekli" işareti ve Muhasebe'ye bildirim. */
const db = () => B4M.db, { ok, no } = B4M.res, AU = B4M.auth, BK = B4M.book, P = B4M.parties, PR = B4M.price, NT = B4M.notif, X = B4M.bkx;
const IV = B4M.iv = {};
AU.PERMS.h.push(["mud", "Rezervasyona müdahale"], ["mudf", "Rezervasyon · fiyat ve ceza"], ["mudt", "Rezervasyon · tedarikçi değiştirme"]);
AU.PERMS.s.push(["mud", "Rezervasyona müdahale"], ["mudf", "Rezervasyon · fiyat ve ceza"]);
IV.side = b => { const s = X.side(b); return s == "h" || s == "sup" ? s : ""; };
IV.can = (b, k) => { const s = IV.side(b); if (!s) return false; if (k == "mudt" && s != "h") return false; return AU.can(k); };
const why = r => { r = String(r || "").trim(); return r.length >= 10 ? r : null; };
const snap = b => ({ guests: [...(b.guests || [])], note: b.note || "", a: b.a, b: b.b || "", room: b.room, desc: b.desc, total: b.total, cur: b.cur, cost: b.cost, costCur: b.costCur, status: b.status, sup: b.sup });
const log = (b, what, reason, before) => { const u = B4M.app.user(), after = snap(b); (b.mods = b.mods || []).push({ at: U.now(), by: u.name, txt: `${what} · gerekçe: ${reason}`, iv: 1 });
  const d = JSON.stringify({ what, reason, before, after }); B4M.audit.log("booking.intervene", b.no, d); if (b.sellerT && b.sellerT != B4M.app.curTid()) B4M.audit.log("booking.intervene", b.no, d, b.sellerT);
  const o = X.order(b); if (o.inv) { b.ivInv = { at: U.now(), what }; NT.push({ tid: "P", depts: ["Muhasebe"], perms: ["acc"], title: "{no}: müdahale sonrası fark faturası gerekli ({w})", tp: { no: b.no, w: what }, kind: "ivinv", ref: b.id }); }
  if (b.pendingMod) { const r = db().get("modreq", b.pendingMod); if (r && r.state == "Bekliyor") { r.state = "Müdahale ile kapandı"; r.done = U.now(); } b.pendingMod = null; } };
const tell = (b, what) => { const st = P.rootOf("s", b.sup), acc = db().get("accounts", P.rootOf("a", b.ag)) || {};
  NT.push({ tid: st, depts: ["Rezervasyon"], perms: ["r"], title: "{no} rezervasyonuna müdahale edildi: {w}", tp: { no: b.no, w: what }, kind: "iv", ref: b.id });
  if (acc.buyer) NT.push({ tid: B4M.app.tidOf(acc.buyer), depts: ["Rezervasyon"], perms: ["by", "r"], title: "{no} rezervasyonunuz güncellendi: {w}", tp: { no: b.no, w: what }, kind: "iv", ref: b.id }); };
/* ---- üstlenme ---- */
IV.claim = (id, force) => { const b = db().get("bookings", id); if (!b || !IV.can(b, "mud")) return no("Bu rezervasyonu üstlenme yetkiniz yok."); const u = B4M.app.user();
  if (b.owner && b.owner.uid != u.id && !force) return no("Bu rezervasyonu {n} üstlenmiş.", { n: b.owner.name });
  const prev = b.owner; b.owner = { uid: u.id, name: u.name, at: U.now(), tid: B4M.app.curTid() }; B4M.audit.log("booking.claim", b.no, prev ? `${prev.name} → ${u.name}` : u.name);
  if (prev && prev.uid != u.id) NT.push({ tid: prev.tid || B4M.app.curTid(), depts: [], perms: [], uid: prev.uid, title: "{no} rezervasyonunu {n} devraldı", tp: { no: b.no, n: u.name }, kind: "iv", ref: b.id });
  return ok("{no} sizde. Diğer kullanıcılar sorumlu olarak adınızı görür.", { no: b.no }); };
IV.release = id => { const b = db().get("bookings", id), u = B4M.app.user(); if (!b || !b.owner) return no(""); if (b.owner.uid != u.id && !IV.can(b, "mud")) return no("Yetkiniz yok."); B4M.audit.log("booking.release", b.no, b.owner.name); b.owner = null; return ok("Rezervasyon bırakıldı."); };
/* ---- düzeltme: misafir, not, oda, tarih, kişi sayısı ---- */
IV.fix = (id, s, reason) => { const b = db().get("bookings", id); if (!b || !IV.can(b, "mud")) return no("Bu rezervasyona müdahale yetkiniz yok."); const r = why(reason); if (!r) return no("Gerekçe yazın (en az 10 karakter).");
  if (b.status != "Onaylı") return no("Yalnızca aktif rezervasyonda düzeltme yapılır; iptal cezası için Fiyat ve ceza bölümünü kullanın.");
  const names = (s.names || []).map(x => String(x || "").trim()).filter(Boolean); if (!names.length) return no("En az bir misafir adı girin.");
  if (b.kind == "f" && names.join("|") != (b.guests || []).join("|")) return no("Uçak biletlerinde isim değişikliği yapılamaz; yalnızca not güncellenebilir.");
  const before = snap(b), st = { ...s, names }; let q = { ok: true, price: false }, warn = "";
  const dateCh = s.a && (s.a != b.a || (s.b || "") != (b.b || "")), roomCh = b.kind == "h" && s.rid && (+s.rid != b.room || (s.rt == "n") != (b.cxd < 0));
  if (b.kind == "h" && (dateCh || roomCh || names.length != (b.guests || []).length)) {
    const SR = B4M.search, av = SR.avail; let miss = false; SR.avail = (...a) => { const v = av(...a); if (v < 1) miss = true; return Math.max(1, v); };
    try { q = BK.mdQuote(b, { a: s.a || b.a, b: s.b || b.b, rid: s.rid || b.room, rt: s.rt || (b.cxd < 0 ? "n" : "r") }); } finally { SR.avail = av; }
    if (!q.ok) return no(q.msg); if (miss) warn = "müsaitlik yok (overbooking)"; st.a = st.a || b.a; st.b = st.b || b.b; st.rid = st.rid || b.room; st.rt = st.rt || (b.cxd < 0 ? "n" : "r"); }
  const ch = BK.mdChanges(b, st, q); if (b.kind != "h" && dateCh) ch.push(`tarih ${b.a} → ${s.a}`); if (names.length != (b.guests || []).length) ch.push(`kişi sayısı ${(b.guests || []).length} → ${names.length}`); if (!ch.length) return no("Değişiklik yok.");
  const txt = U.uniq(ch).join(", ") + (q.diff ? ` · fark ${I.fm(q.diff, b.cur)}` : "") + (warn ? ` · ${warn}` : "");
  BK.mdApply(b, st, q, "Müdahale: " + txt, B4M.app.user().name); b.mods.pop();
  if (b.kind != "h" && dateCh) { b.a = s.a; if (b.b) b.b = s.b || b.b; }
  log(b, txt, r, before); tell(b, txt); return ok(warn ? "Düzeltme uygulandı (uyarı: {w}). Taraflara bildirildi." : "Düzeltme uygulandı ve taraflara bildirildi.", { w: warn }); };
/* ---- fiyat ve ceza ---- */
IV.price = (id, o, reason) => { const b = db().get("bookings", id); if (!b || !IV.can(b, "mudf")) return no("Fiyat düzeltme yetkiniz yok."); const r = why(reason); if (!r) return no("Gerekçe yazın (en az 10 karakter).");
  const side = IV.side(b), before = snap(b), ord = X.order(b); let cost = o.cost === "" || o.cost == null ? b.cost : +o.cost, total = o.total === "" || o.total == null ? b.total : +o.total;
  if (!(cost >= 0) || !(total > 0)) return no("Geçerli bir tutar girin.");
  if (side == "sup" && !b.own && cost != b.cost) total = U.r2(b.total * (b.cost ? cost / b.cost : 1)); /* DMC kendi fiyatını değiştirir; alıcı fiyatı markup'larla orantılı */
  if (cost == b.cost && total == b.total) return no("Değişiklik yok.");
  const diff = U.r2(total - b.total), old = b.mg || {}; b.cost = U.r2(cost); b.total = U.r2(total);
  const mg = PR.margins(b.sup, b.ag, b.kind, b.cost, b.costCur, b.total, b.cur);
  if (!PR.isOwnBuy(b.ag, b.sup)) { if (PR.agOwner(b.ag)) mg.dm = U.r2(b.total - PR.cv(b.cost, b.costCur, b.cur) - (old.pa || 0)); else mg.hq = U.r2(b.total - PR.cv(b.cost + (mg.ps || 0), b.costCur, b.cur) - (old.pa || 0)); mg.pa = old.pa || 0; }
  b.mg = { ...old, ...mg, rb: old.rb }; b.mgManual = 1; const c2 = BK.bkCost(b); if (c2) b.dbuy = c2;
  if (diff && ord.id) { ord.total = U.r2(ord.total + diff); BK.ledger(b.ag, b.cur, diff > 0 ? "Fiyat düzeltmesi · {no}" : "Fiyat düzeltmesi iadesi · {no}", { no: b.no }, diff > 0 ? diff : 0, diff < 0 ? -diff : 0, ord.due); }
  if (B4M.acc.commOnModify) B4M.acc.commOnModify(b);
  const txt = `fiyat ${I.fm(before.total, b.cur)} → ${I.fm(b.total, b.cur)} · alış ${I.fm(before.cost, b.costCur)} → ${I.fm(b.cost, b.costCur)}`;
  B4M.events.emit("booking.modified", b.no, diff, b.cur, b.sup); log(b, txt, r, before); tell(b, side == "h" ? txt : `fiyat ${I.fm(b.total, b.cur)}`); return ok("Fiyat düzeltildi; fark cariye işlendi."); };
IV.waive = (id, reason) => { const b = db().get("bookings", id); if (!b || !IV.can(b, "mudf")) return no("Ceza kaldırma yetkiniz yok."); const r = why(reason); if (!r) return no("Gerekçe yazın (en az 10 karakter).");
  if (b.status != "İptal (cezalı)") return no("Bu rezervasyonda iptal cezası yok."); const before = snap(b); b.status = "İptal"; b.waived = { at: U.now(), by: B4M.app.user().name };
  BK.ledger(b.ag, b.cur, "İptal cezası kaldırıldı · {no} – tutar iadesi", { no: b.no }, 0, b.total); if (B4M.acc.commOnCancel) B4M.acc.commOnCancel(b, false);
  B4M.events.emit("booking.modified", b.no, -b.total, b.cur, b.sup); const txt = `iptal cezası kaldırıldı, ${I.fm(b.total, b.cur)} iade`; log(b, txt, r, before); tell(b, txt); return ok("İptal cezası kaldırıldı; tutar cariye iade olarak işlendi."); };
/* ---- tedarikçi değiştirme (elle rebooking) ---- */
IV.targets = b => db().all("hotels").filter(h => (h.rooms || []).length && PR.supOK(h.sup, "h"));
IV.move = (id, o, reason) => { const b = db().get("bookings", id); if (!b || !IV.can(b, "mudt")) return no("Tedarikçi değiştirme yalnızca Back Office'te ve yetkiyle yapılır."); const r = why(reason); if (!r) return no("Gerekçe yazın (en az 10 karakter).");
  if (b.kind != "h" || b.status != "Onaylı") return no("Yalnızca aktif otel rezervasyonu taşınabilir."); const h = db().get("hotels", +o.hid), rm = h && (h.rooms || []).find(x => x.id == +o.rid), amt = +o.amt;
  if (!h || !rm) return no("Otel ve oda seçin."); if (!(amt > 0)) return no("Yeni alış tutarını girin."); if (h.id == b.hid && rm.id == b.room) return no("Değişiklik yok.");
  const before = snap(b), on = (b.desc.match(/oda (\d+)/) || [0, 1])[1], cur = o.cur || h.cur || b.costCur;
  B4M.rb.swap(b, { sup: h.sup, hid: h.id, room: rm.id, amt: U.r2(amt), cur, sdl: o.sdl || b.sdl, e: PR.cv(amt, cur, "EUR") }, "manual", 0);
  b.desc = `${h.name} – ${rm.type} (oda ${on})${b.cxd < 0 ? " · iade edilemez" : ""}`; const c2 = BK.bkCost(b); if (c2) b.dbuy = c2;
  const txt = `tedarikçi ${P.dmcName(before.sup)} → ${P.dmcName(h.sup)} · ${h.name} / ${rm.type} · alış ${I.fm(amt, cur)}`;
  log(b, txt, r, before); const acc = db().get("accounts", P.rootOf("a", b.ag)) || {}; if (acc.buyer) NT.push({ tid: B4M.app.tidOf(acc.buyer), depts: ["Rezervasyon"], perms: ["by", "r"], title: "{no} rezervasyonunuz güncellendi: {w}", tp: { no: b.no, w: `${h.name} / ${rm.type}` }, kind: "iv", ref: b.id });
  return ok("Rezervasyon {d} firmasına taşındı; satış fiyatı, rezervasyon no ve voucher no değişmedi.", { d: P.dmcName(h.sup) }); };
