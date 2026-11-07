# BED4BOOK / Book4me — Master Technical Specification

- Version: 1.1
- Date: 2026-11-07
- Status: implementation baseline + independent verification required
- Repository: `kosker-07/Book4me`

## 1. Product architecture and scope

BED4BOOK Core hosts independent business modules. Rebooking and RateRelay are separate commercial workflows and must not share their decision rules. They may share canonical reservations, identity, tenant/role authorization, currency, audit, notifications and supplier integration infrastructure.

Book4me's B2B search engine is a separate acquisition/booking capability. It searches supplier offers without reserving inventory, normalizes comparable offers and exposes only one lowest-priced eligible winner.

## 2. Global invariants

1. Search must never create a booking or hold/lock room, allotment, inventory or capacity.
2. A search result is a time-stamped price/availability observation, not a guarantee.
3. Rebooking and RateRelay must never cancel the source booking until the replacement booking is confirmed by its supplier with a booking reference.
4. No duplicate replacement, transfer or cancellation may result from retries; all external mutations require idempotency keys.
5. DMC participant responses must not reveal other DMC identities, bids, source agency or source supplier.
6. Existing unrelated Book4me functions must remain regression-safe.
7. Unknown commercial decisions must be reported, not silently hard-coded.
8. Mock tests do not prove real supplier integration. Production activation requires sandbox/production verification.

## 3. Rebooking System

### Purpose
Find a valid, commercially equivalent alternative for an existing reservation and replace the supplier only when the new booking is confirmed.

### Equivalence
Compare property, room/bed configuration, board, dates, occupancy/child ages, included services, taxes/mandatory fees, market/nationality, cancellation deadline and policy, payment terms and no-show conditions. A nominally lower price with worse conditions is not equivalent.

### Decision
Normalize all-in totals into a configured comparison currency with rate source/time recorded. Apply configurable minimum net saving and risk thresholds. Select one lowest valid equivalent offer; do not use an unapproved alternative fallback.

### Safe replacement sequence
1. Search and validate alternatives.
2. Recheck the selected alternative.
3. Create replacement booking.
4. Require supplier confirmation and booking reference.
5. Validate replacement details.
6. Only then request cancellation of the old booking.
7. If replacement confirmation fails, preserve old booking.
8. If old cancellation fails after replacement confirmation, raise a critical reconciliation task; never hide the double-booking exposure.

### Modes
Support recommendation/manual mode and explicitly configured automatic mode. Automatic mode must be controlled by management policy and feature flags.

## 4. RateRelay System

### Purpose
Offer eligible existing reservations to a blind bid pool of eligible DMCs. It is not Rebooking's continuous alternative search.

### Privacy and bids
Show only operational details needed to price the service. Hide source agency, source supplier, other DMC identities, bid values, bid count and ranking from participants. Enforce privacy in backend/API, exports, notifications and accessible logs—not only in UI. Participants can see only their own bid and its permitted status.

### Window and deadline
First valid bid starts a configurable 24-hour window. A new better valid bid may renew the window to 24 hours from receipt. The closing time must never exceed cancellation deadline minus a configurable safety buffer. When the safe cutoff is near, close immediately rather than waiting a further 24 hours.

### Winner and transfer
Select one lowest normalized all-in valid bid. Tie handling must be deterministic and approved; no arbitrary winner. Confirm replacement booking with winning DMC before cancelling source booking. If transfer confirmation fails, preserve source booking. If source cancellation fails after transfer, open critical reconciliation; do not select a second winner or create parallel transfers.

## 5. Search engine

See [Book4me Search Engine Specification](Cloude_Book4me_Arama_Motoru_Teknik_Sartname.md).

The search engine's non-negotiable rules:
- no search-time reservation hold or inventory lock;
- equivalent, valid offers only;
- one lowest normalized total-price winner;
- do not expose other offers as alternatives or fallback;
- recheck only the winner at booking time;
- if winner recheck fails, do not silently fall back to second place; request a new search;
- supplier confirmation is required before a booking is considered confirmed.

## 6. Shared Core

- One canonical reservation model and stable reservation ID.
- Separate source DMC, current supplier, sales channel, agency and sensitive customer fields.
- Explicit currency, taxes, commission, net/gross and included-fee fields.
- Store timestamps in UTC; preserve supplier timezone and exact cancellation deadline.
- Tenant-, role-, source- and object-level server authorization.
- Correlation ID, idempotency key and append-only audit trail for external operations.
- Feature flags and independent module enable/disable.
- Optimistic concurrency/version checks so Rebooking and RateRelay cannot change one reservation simultaneously.

## 7. Current implementation in this repository

### Added in this implementation pass
- `src/updates/u008-bed4book-core.js`: adapter-driven `B4M.rebookingV2` and `B4M.rateRelay` domain workflows.
- `tests/u008-bed4book.js`: workflow-level unit tests.
- `docs/CLAUDE_HANDOFF_BED4BOOK.md`: independent test and review instructions.

### Important legacy conflict
`src/updates/u002e-rebooking.js` is an older implementation and does not satisfy this master specification in several places: it includes a source-supplier right-to-match/hold concept, risk-group bid restrictions, and direct reassignment of the booking supplier without a confirmed replacement booking followed by source cancellation. Do not run legacy and v2 workflows concurrently for the same reservation. A controlled migration/cutover is still required.

### Explicit limitations
The new v2 module is adapter-driven. This commit does not wire actual supplier sandbox/production APIs, does not deliver server-side persistent scheduling, does not add the full Back Office or DMC UI, does not add database migrations or production RBAC, and has not been verified against live suppliers. Do not describe those capabilities as live or complete.

## 8. Test and rollout gates

1. Run `node tests/u008-bed4book.js`.
2. Run `node tests/unit.js` and relevant UI tests.
3. Run `node tools/build.js`.
4. Verify privacy across APIs, exports, notifications and logs.
5. Verify idempotency, concurrent close/bid races, retry and restart recovery.
6. Integrate supplier sandbox adapters and prove confirm/cancel semantics.
7. Pilot with selected DMCs and reconcile every transfer.
8. Enable production only after acceptance, security, performance, rollback and operations checks.

## 9. Open management decisions

- RateRelay cancellation-deadline safety buffer.
- Tie-break policy for equal bids.
- Bid update/withdrawal rules and timer behavior.
- Mandatory non-price commercial terms in bids.
- Rebooking minimum net saving, exchange-rate source and refresh cadence.
- Accounting treatment for cancellation/rebooking costs and platform revenue.
- Actual supplier sandbox/production endpoints, credentials and permissions.

## 10. Source documents

- [Rebooking + RateRelay requirements (PDF-derived specification)](BED4BOOK_Rebooking_RateRelay_Teknik_Sartname.md)
- [Book4me search engine specification](Cloude_Book4me_Arama_Motoru_Teknik_Sartname.md)
- [Claude handoff and verification](CLAUDE_HANDOFF_BED4BOOK.md)
