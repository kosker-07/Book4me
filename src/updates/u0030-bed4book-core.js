/* BED4BOOK Core · Rebooking + RateRelay
 * Domain orchestration layer. Supplier connectivity is injected through registered adapters;
 * this module never pretends that demo data is a live supplier confirmation.
 */
const B4M_BED = B4M.bed4book = {};
const db = () => B4M.db;
const now = () => U.now();
const r2 = n => U.r2(+n || 0);
const eur = (amount, currency) => r2(B4M.price.cv(+amount || 0, currency || "EUR", "EUR"));
const result = (ok, msg, data) => ({ ok, msg, ...(data || {}) });
const keyOf = x => String(x && (x.id || x.no) || "");
B4M_BED.version = "1.0.0";
B4M_BED.config = {
  rateRelayWindowMs: 24 * 60 * 60 * 1000,
  rateRelayExtendWithinMs: 60 * 60 * 1000,
  rateRelayExtensionMs: 60 * 60 * 1000,
  rateRelaySafetyBufferMs: 15 * 60 * 1000,
  rebookingMinSavingEur: 0,
  currency: "EUR"
};
B4M_BED.adapters = Object.create(null);
B4M_BED.registerSupplier = (supplierId, adapter) => {
  if (!supplierId || !adapter || typeof adapter.quote !== "function" ||
      typeof adapter.recheck !== "function" || typeof adapter.book !== "function" ||
      typeof adapter.cancel !== "function") throw new Error("Supplier adapter must implement quote, recheck, book and cancel.");
  B4M_BED.adapters[String(supplierId)] = adapter;
  return true;
};
B4M_BED.audit = (type, ref, payload) => db().add("bed4bookAudit", {
  type, ref: String(ref || ""), payload: U.clone(payload || {}), at: now()
});
B4M_BED.sameTerms = (old, offer) => {
  const a = old.equivalence || old, b = offer.equivalence || offer;
  const fields = ["propertyKey", "roomKey", "boardKey", "checkIn", "checkOut", "occupancyKey", "marketKey", "cancellationKey", "paymentKey"];
  return fields.every(k => String(a[k] ?? "") === String(b[k] ?? ""));
};
B4M_BED.validOffer = (old, offer) => {
  if (!offer || offer.available !== true || offer.total == null || !(+offer.total > 0) || !offer.currency) return false;
  if (!B4M_BED.sameTerms(old, offer)) return false;
  if (offer.cancellableUntil && old.cancellableUntil && offer.cancellableUntil < old.cancellableUntil) return false;
  return true;
};

/* Rebooking is deliberately a two-phase replacement:
 * confirm the replacement first; only then request cancellation of the old booking.
 */
B4M_BED.rebooking = {};
const RB = B4M_BED.rebooking;
RB.create = async (bookingId, opts = {}) => {
  const old = db().get("bookings", bookingId);
  if (!old || old.status !== "Onaylı" || old.kind !== "h") return result(false, "Only an active hotel booking can be rebooked.");
  const prior = db().find("bed4bookRebookings", x => x.bookingId === bookingId && ["searching","rechecking","booking_new","cancelling_old"].includes(x.state));
  if (prior) return result(false, "A rebooking operation is already in progress.", { operation: prior });
  const op = db().add("bed4bookRebookings", { bookingId, oldSupplierId: old.sup, state: "searching", createdAt: now(), idempotencyKey: opts.idempotencyKey || "rb-" + bookingId + "-" + now() });
  B4M_BED.audit("rebooking.started", op.id, { bookingId });
  try {
    const adapters = Object.entries(B4M_BED.adapters).filter(([id]) => String(id) !== String(old.sup));
    const offers = (await Promise.all(adapters.map(async ([supplierId, adapter]) => {
      try { return (await adapter.quote(old)).map(o => ({ ...o, supplierId })); }
      catch (error) { B4M_BED.audit("rebooking.quote_error", op.id, { supplierId, error: String(error) }); return []; }
    }))).flat().filter(o => B4M_BED.validOffer(old, o))
      .map(o => ({ ...o, totalEur: eur(o.total, o.currency) }))
      .sort((a,b) => a.totalEur - b.totalEur || String(a.supplierId).localeCompare(String(b.supplierId)));
    const oldCostEur = eur(old.cost, old.costCur || old.cur);
    const winner = offers.find(o => oldCostEur - o.totalEur >= (+B4M_BED.config.rebookingMinSavingEur || 0));
    if (!winner) { op.state = "no_better_offer"; op.finishedAt = now(); return result(true, "No equivalent eligible offer met the saving threshold.", { operation: op }); }
    op.state = "rechecking"; op.winnerSupplierId = winner.supplierId; op.winnerQuote = U.clone(winner);
    const adapter = B4M_BED.adapters[String(winner.supplierId)];
    const checked = await adapter.recheck(winner, old);
    if (!checked || checked.available !== true || eur(checked.total, checked.currency) !== winner.totalEur || !B4M_BED.validOffer(old, checked)) {
      op.state = "recheck_failed"; op.finishedAt = now(); B4M_BED.audit("rebooking.recheck_failed", op.id, {});
      return result(false, "Winning offer changed or failed revalidation. The existing booking remains untouched.", { operation: op });
    }
    op.state = "booking_new";
    const created = await adapter.book(checked, { idempotencyKey: op.idempotencyKey });
    if (!created || created.confirmed !== true || !created.confirmationNumber) {
      op.state = "new_booking_failed"; op.finishedAt = now();
      return result(false, "Replacement supplier did not confirm the new booking. Existing booking remains untouched.", { operation: op });
    }
    op.newConfirmationNumber = created.confirmationNumber;
    op.newSupplierBookingId = created.bookingId || null;
    op.state = "cancelling_old";
    const oldAdapter = B4M_BED.adapters[String(old.sup)];
    if (!oldAdapter) {
      op.state = "manual_reconciliation";
      op.error = "Old supplier cancellation adapter is not registered.";
      B4M_BED.audit("rebooking.manual_reconciliation", op.id, { reason: op.error });
      return result(false, "New booking is confirmed, but old supplier cancellation could not be initiated. Manual reconciliation required.", { operation: op });
    }
    const cancelled = await oldAdapter.cancel(old, { idempotencyKey: op.idempotencyKey + "-cancel-old" });
    if (!cancelled || cancelled.confirmed !== true) {
      op.state = "manual_reconciliation";
      op.error = "Replacement confirmed; cancellation of old booking was not confirmed.";
      B4M_BED.audit("rebooking.manual_reconciliation", op.id, { reason: op.error, newConfirmationNumber: created.confirmationNumber });
      return result(false, "Replacement is confirmed, but the old booking cancellation is not. Manual reconciliation required; do not retry booking automatically.", { operation: op });
    }
    old.rbHistory = old.rbHistory || [];
    old.rbHistory.push({ at: now(), oldSupplierId: old.sup, oldConfirmation: old.vch || old.no, newSupplierId: winner.supplierId, newConfirmation: created.confirmationNumber, oldCost: old.cost, oldCurrency: old.costCur || old.cur, newCost: checked.total, newCurrency: checked.currency });
    old.sup = winner.supplierId; old.cost = checked.total; old.costCur = checked.currency; old.vch = created.confirmationNumber;
    op.state = "completed"; op.finishedAt = now();
    B4M_BED.audit("rebooking.completed", op.id, { oldBookingId: bookingId, newConfirmationNumber: created.confirmationNumber });
    return result(true, "Replacement confirmed and old booking cancellation confirmed.", { operation: op, confirmationNumber: created.confirmationNumber });
  } catch (error) {
    op.state = "failed"; op.error = String(error); op.finishedAt = now();
    B4M_BED.audit("rebooking.error", op.id, { error: String(error) });
    return result(false, "Rebooking failed safely. Check operation details before retrying.", { operation: op });
  }
};
RB.get = id => db().get("bed4bookRebookings", id) || null;
RB.pendingReconciliation = () => db().where("bed4bookRebookings", x => x.state === "manual_reconciliation");

/* RateRelay: anonymized reverse-offer pool. Supplier identities never appear in public projections. */
B4M_BED.rateRelay = {};
const RR = B4M_BED.rateRelay;
RR.create = (bookingId, opts = {}) => {
  const b = db().get("bookings", bookingId);
  if (!b || b.kind !== "h" || b.status !== "Onaylı") return result(false, "An active hotel booking is required.");
  const existing = db().find("rateRelayPools", x => x.bookingId === bookingId && x.state === "open");
  if (existing) return result(false, "An open RateRelay pool already exists.", { pool: existing });
  const pool = db().add("rateRelayPools", {
    bookingId, state: "open", createdAt: now(), firstOfferAt: null, closesAt: null,
    safetyCloseAt: b.dl ? Date.parse(b.dl + "T23:59:59") - B4M_BED.config.rateRelaySafetyBufferMs : null,
    equivalence: U.clone(opts.equivalence || {
      propertyKey: String(b.hid), roomKey: String(b.room), boardKey: String(b.board || ""),
      checkIn: b.a, checkOut: b.b, occupancyKey: JSON.stringify([...(b.guests || [])].sort()),
      marketKey: String(b.nat || ""), cancellationKey: String(b.dl || ""), paymentKey: String(b.paymentKey || "")
    }),
    baselineEur: eur(b.cost, b.costCur || b.cur), winnerBidId: null, version: 1
  });
  B4M_BED.audit("raterelay.created", pool.id, { bookingId });
  return result(true, "RateRelay pool created.", { pool });
};
RR.publicPool = id => {
  const p = db().get("rateRelayPools", id);
  if (!p || p.state !== "open") return null;
  return { id: p.id, state: p.state, closesAt: p.closesAt, version: p.version, baselineEur: p.baselineEur };
};
RR.submit = (poolId, supplierId, offer) => {
  const p = db().get("rateRelayPools", poolId);
  if (!p || p.state !== "open") return result(false, "RateRelay pool is not open.");
  if (p.safetyCloseAt && now() >= p.safetyCloseAt) { p.state = "closed_safety"; return result(false, "Safety cutoff reached."); }
  if (!B4M_BED.sameTerms({ equivalence: p.equivalence }, offer) || offer.available !== true || !(+offer.total > 0) || !offer.currency)
    return result(false, "Offer does not match the required product and terms.");
  const totalEur = eur(offer.total, offer.currency);
  if (!(totalEur < p.baselineEur - 0.004)) return result(false, "Offer must improve the current normalized total.");
  const prior = db().where("rateRelayBids", x => x.poolId === poolId && String(x.supplierId) === String(supplierId) && x.state === "valid");
  prior.forEach(x => x.state = "superseded");
  const bid = db().add("rateRelayBids", { poolId, supplierId: String(supplierId), total: +offer.total, currency: offer.currency, totalEur, state: "valid", createdAt: now(), offer: U.clone(offer) });
  const first = !p.firstOfferAt;
  if (first) { p.firstOfferAt = now(); p.closesAt = now() + B4M_BED.config.rateRelayWindowMs; }
  else if (p.closesAt - now() <= B4M_BED.config.rateRelayExtendWithinMs) {
    p.closesAt = Math.min(now() + B4M_BED.config.rateRelayExtensionMs, p.safetyCloseAt || Infinity);
  }
  p.version++;
  B4M_BED.audit("raterelay.bid_received", poolId, { bidId: bid.id, version: p.version });
  return result(true, "Offer accepted.", { bidId: bid.id, closesAt: p.closesAt });
};
RR.close = poolId => {
  const p = db().get("rateRelayPools", poolId);
  if (!p || p.state !== "open") return result(false, "RateRelay pool is not open.");
  if (p.closesAt && now() < p.closesAt && !(p.safetyCloseAt && now() >= p.safetyCloseAt)) return result(false, "Offer window is still open.");
  const bids = db().where("rateRelayBids", x => x.poolId === poolId && x.state === "valid").sort((a,b) => a.totalEur - b.totalEur || a.id - b.id);
  if (!bids.length) { p.state = "closed_no_offer"; p.closedAt = now(); return result(true, "Pool closed without a valid offer."); }
  p.winnerBidId = bids[0].id; p.state = "closed_winner"; p.closedAt = now();
  bids.slice(1).forEach(x => x.state = "not_selected");
  B4M_BED.audit("raterelay.closed", poolId, { winnerBidId: p.winnerBidId });
  return result(true, "Lowest comparable valid offer selected.", { winner: { bidId: bids[0].id, totalEur: bids[0].totalEur } });
};
RR.winnerForBackOffice = poolId => {
  const p = db().get("rateRelayPools", poolId);
  if (!p || !p.winnerBidId) return null;
  const b = db().get("rateRelayBids", p.winnerBidId);
  return b ? { bidId: b.id, supplierId: b.supplierId, total: b.total, currency: b.currency, totalEur: b.totalEur } : null;
};
RR.sweep = () => {
  let closed = 0;
  db().where("rateRelayPools", p => p.state === "open" && ((p.closesAt && now() >= p.closesAt) || (p.safetyCloseAt && now() >= p.safetyCloseAt))).forEach(p => { if (RR.close(p.id).ok) closed++; });
  return closed;
};
RR.publicBids = poolId => db().where("rateRelayBids", x => x.poolId === poolId && x.state === "valid").map(x => ({ total: x.total, currency: x.currency, totalEur: x.totalEur, createdAt: x.createdAt }));
B4M_BED.health = () => ({
  version: B4M_BED.version,
  registeredSupplierAdapters: Object.keys(B4M_BED.adapters).length,
  rebookingManualReconciliation: RB.pendingReconciliation().length,
  openRateRelayPools: db().where("rateRelayPools", x => x.state === "open").length
});
