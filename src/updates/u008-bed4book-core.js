/* BED4BOOK v2: safe Rebooking + anonymous RateRelay.
 * Adapter-driven by design: no search-time inventory hold/lock and no fake supplier confirmation.
 * Existing legacy B4M.rb remains untouched until migration tests approve cutover.
 */
(function () {
  const B = B4M, db = () => B.db, now = () => U.now();
  const clone = x => JSON.parse(JSON.stringify(x));
  const fail = (code, message, extra) => ({ ok: false, code, message, ...(extra || {}) });
  const pass = (data, message) => ({ ok: true, message, data });
  const inFlight = new Map();
  const idem = async (key, op) => {
    if (!key) return fail("IDEMPOTENCY_KEY_REQUIRED", "Idempotency key is required.");
    const d = db(), old = d.find("b4mOps", x => x.key === key);
    if (old) return old.result;
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = (async () => {
      const result = await op();
      d.add("b4mOps", { key, at: now(), result });
      return result;
    })();
    inFlight.set(key, pending);
    try { return await pending; } finally { inFlight.delete(key); }
  };
  const price = x => Number(x && x.normalizedTotal);
  const valid = x => x && x.available === true && Number.isFinite(price(x)) && price(x) >= 0 &&
    x.equivalence && x.equivalence.property && x.equivalence.room &&
    x.equivalence.board && x.equivalence.occupancy && x.equivalence.dates &&
    x.equivalence.cancellation && x.equivalence.payment && x.equivalence.market;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const choose = offers => {
    const candidates = (offers || []).filter(valid);
    if (!candidates.length) return null;
    candidates.sort((a, b) => price(a) - price(b) ||
      String(a.supplierId).localeCompare(String(b.supplierId)) ||
      String(a.offerId).localeCompare(String(b.offerId)));
    return candidates[0];
  };

  const RB2 = B.rebookingV2 = {
    version: 2,
    // Adapter contract: searchAlternatives(reservation), createReplacement(offer, idemKey),
    // cancelOld(reservation, idemKey). These must call a real supplier sandbox/production API.
    async evaluate(reservation, adapters, opts) {
      if (!reservation || !adapters || typeof adapters.searchAlternatives !== "function")
        return fail("ADAPTER_MISSING", "Reservation and search adapter are required.");
      const offers = await adapters.searchAlternatives(clone(reservation));
      const winner = choose(offers);
      if (!winner) return fail("NO_EQUIVALENT_OFFER", "No valid equivalent alternative was found.");
      const current = Number(reservation.normalizedTotal);
      const saving = current - price(winner);
      const minSaving = Math.max(0, Number((opts || {}).minimumSaving || 0));
      if (!(saving > minSaving)) return fail("SAVING_BELOW_THRESHOLD", "Net saving does not exceed the configured threshold.", { saving });
      return pass({ winner: clone(winner), saving, evaluatedAt: now() }, "A single eligible lowest-price offer was selected.");
    },
    async execute(reservation, evaluation, adapters, idempotencyKey) {
      if (!idempotencyKey) return fail("IDEMPOTENCY_KEY_REQUIRED", "A unique idempotency key is required.");
      if (!reservation || !evaluation || !evaluation.data || !evaluation.data.winner)
        return fail("INVALID_EVALUATION", "A successful evaluation is required.");
      if (!adapters || typeof adapters.createReplacement !== "function" || typeof adapters.cancelOld !== "function")
        return fail("ADAPTER_MISSING", "Replacement-booking and cancellation adapters are required.");
      return idem("rebooking:" + idempotencyKey, async () => {
        const winner = evaluation.data.winner;
        // Critical ordering: confirm replacement first; never cancel the old booking before this returns confirmed.
        const created = await adapters.createReplacement(clone(winner), idempotencyKey);
        if (!created || created.confirmed !== true || !created.bookingReference)
          return fail("REPLACEMENT_NOT_CONFIRMED", "Replacement supplier did not provide a confirmed booking reference. Existing booking remains active.");
        const checked = created.details || {};
        if (checked.propertyId && checked.propertyId !== winner.equivalence.property)
          return fail("REPLACEMENT_MISMATCH", "Confirmed replacement does not match the selected property. Existing booking was not cancelled.", { replacementReference: created.bookingReference });
        const cancelled = await adapters.cancelOld(clone(reservation), idempotencyKey + ":cancel-old");
        if (!cancelled || cancelled.confirmed !== true)
          return fail("OLD_CANCELLATION_FAILED", "Replacement is confirmed, but cancellation of the old booking failed. Manual reconciliation is required.", { replacementReference: created.bookingReference, oldBookingReference: reservation.bookingReference });
        return pass({ replacementReference: created.bookingReference, oldBookingReference: reservation.bookingReference, saving: evaluation.data.saving }, "Rebooking completed; both supplier confirmations are recorded.");
      });
    }
  };

  const RR = B.rateRelay = {
    version: 1,
    DEFAULT_WINDOW_MS: 24 * 60 * 60 * 1000,
    // Create opportunity from an existing booking. No supplier inventory is held.
    open(input, policy) {
      if (!input || !input.reservationId || !input.cancellationDeadline || !input.equivalence)
        return fail("INVALID_OPPORTUNITY", "Reservation, cancellation deadline and equivalence are required.");
      const deadline = Date.parse(input.cancellationDeadline);
      if (!Number.isFinite(deadline) || deadline <= Date.now())
        return fail("DEADLINE_PASSED", "Cancellation deadline must be in the future.");
      const p = policy || {}, buffer = Math.max(0, Number(p.safetyBufferMs || 0));
      const closeAt = Math.min(Date.now() + Math.max(60000, Number(p.windowMs || RR.DEFAULT_WINDOW_MS)), deadline - buffer);
      if (closeAt <= Date.now()) return fail("INSUFFICIENT_TIME", "Not enough time remains before the safe cancellation cutoff.");
      const x = db().add("rateRelayOpportunities", {
        reservationId: input.reservationId, equivalence: clone(input.equivalence),
        cancellationDeadline: input.cancellationDeadline, closeAt: new Date(closeAt).toISOString(),
        state: "OPEN", bids: [], winnerBidId: null, createdAt: now(), updatedAt: now()
      });
      return pass({ opportunityId: x.id, closeAt: x.closeAt }, "Anonymous RateRelay opportunity opened.");
    },
    submit(opportunityId, bid, actor, policy) {
      const x = db().get("rateRelayOpportunities", opportunityId);
      if (!x || x.state !== "OPEN") return fail("OPPORTUNITY_CLOSED", "This opportunity is not open.");
      if (Date.now() >= Date.parse(x.closeAt)) return fail("BIDDING_CLOSED", "The safe bidding cutoff has passed.");
      if (!actor || !actor.dmcId || !bid || !Number.isFinite(+bid.total) || +bid.total <= 0 || !bid.currency)
        return fail("INVALID_BID", "A valid DMC identity, positive total and currency are required.");
      if (String(actor.dmcId) === String((policy || {}).sourceDmcId))
        return fail("SOURCE_DMC_BLOCKED", "The source DMC cannot bid on its own opportunity.");
      const normalized = typeof (policy || {}).normalize === "function" ? policy.normalize(bid) : Number(bid.normalizedTotal);
      if (!Number.isFinite(normalized) || normalized <= 0)
        return fail("NORMALIZATION_REQUIRED", "A trusted normalized total is required.");
      const prior = x.bids.find(b => String(b.dmcId) === String(actor.dmcId) && b.state === "VALID");
      if (prior && normalized >= prior.normalizedTotal) return fail("BID_NOT_IMPROVED", "A DMC may only replace its active bid with a lower normalized total.");
      const currentBest = x.bids.filter(b => b.state === "VALID").reduce((m, b) => Math.min(m, b.normalizedTotal), Infinity);
      if (prior) prior.state = "SUPERSEDED";
      const row = { id: db().seq(), dmcId: String(actor.dmcId), normalizedTotal: normalized,
        currency: bid.currency, total: +bid.total, receivedAt: now(), state: "VALID" };
      x.bids.push(row); x.updatedAt = now();
      // Extend the window only when a new valid bid improves the current best.
      if (normalized < currentBest) {
        const buffer = Math.max(0, Number((policy || {}).safetyBufferMs || 0));
        const proposed = Date.now() + Math.max(60000, Number((policy || {}).windowMs || RR.DEFAULT_WINDOW_MS));
        x.closeAt = new Date(Math.min(proposed, Date.parse(x.cancellationDeadline) - buffer)).toISOString();
      }
      return pass({ bidId: row.id, accepted: true }, "Bid accepted. Other DMC bids and identities remain private.");
    },
    // Participant view returns only their own bid status; never leaks competitors or source identities.
    participantView(opportunityId, dmcId) {
      const x = db().get("rateRelayOpportunities", opportunityId);
      if (!x) return fail("NOT_FOUND", "Opportunity not found.");
      return pass({ opportunityId: x.id, state: x.state, closeAt: x.closeAt,
        myBids: x.bids.filter(b => String(b.dmcId) === String(dmcId)).map(b => ({ id: b.id, total: b.total, currency: b.currency, state: b.state })) });
    },
    async close(opportunityId, adapters, idempotencyKey) {
      const x = db().get("rateRelayOpportunities", opportunityId);
      if (!x) return fail("NOT_FOUND", "Opportunity not found.");
      if (x.state !== "OPEN") return fail("NOT_OPEN", "Opportunity is already closed.");
      if (Date.now() < Date.parse(x.closeAt)) return fail("WINDOW_ACTIVE", "Bidding window is still active.");
      x.state = "CLOSING"; x.updatedAt = now();
      const bids = x.bids.filter(b => b.state === "VALID").sort((a, b) => a.normalizedTotal - b.normalizedTotal ||
        Date.parse(a.receivedAt) - Date.parse(b.receivedAt) || a.id - b.id);
      if (!bids.length) { x.state = "NO_WINNER"; return pass({ state: x.state }, "No valid bids; existing reservation remains unchanged."); }
      const winner = bids[0];
      if (!adapters || typeof adapters.transferAndConfirm !== "function") {
        x.state = "OPEN";
        return fail("TRANSFER_ADAPTER_MISSING", "A real transfer adapter is required; no winner was committed.");
      }
      const transfer = await adapters.transferAndConfirm({ reservationId: x.reservationId, winningBid: clone(winner), idempotencyKey });
      if (!transfer || transfer.confirmed !== true || !transfer.bookingReference) {
        x.state = "TRANSFER_FAILED";
        return fail("TRANSFER_NOT_CONFIRMED", "Winning DMC did not confirm the replacement; existing booking must remain active.", { winningDmcId: winner.dmcId });
      }
      if (typeof adapters.cancelSource !== "function") {
        x.state = "RECONCILIATION_REQUIRED";
        return fail("SOURCE_CANCEL_ADAPTER_MISSING", "Replacement confirmed; source cancellation requires manual reconciliation.", { bookingReference: transfer.bookingReference });
      }
      const cancelled = await adapters.cancelSource(x.reservationId, idempotencyKey + ":source-cancel");
      if (!cancelled || cancelled.confirmed !== true) {
        x.state = "RECONCILIATION_REQUIRED";
        return fail("SOURCE_CANCEL_FAILED", "Replacement confirmed but source cancellation failed; manual reconciliation required.", { bookingReference: transfer.bookingReference });
      }
      x.winnerBidId = winner.id; x.state = "TRANSFERRED"; x.transferredAt = now();
      x.transferReference = transfer.bookingReference; x.updatedAt = now();
      return pass({ state: x.state, bookingReference: transfer.bookingReference }, "RateRelay transfer completed.");
    }
  };
})();