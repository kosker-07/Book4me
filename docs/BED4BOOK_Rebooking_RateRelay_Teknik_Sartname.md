# BED4BOOK — Rebooking System + RateRelay System
## PDF-derived requirements transcription
- Source: BED4BOOK_Teknik_Sartname.pdf
- Source version/date: 1.0 / 7 November 2026
- This Markdown is a working transcription of the uploaded PDF requirements; refer to the PDF for original page layout.

## Scope
Two independent commercial modules under BED4BOOK Core. They share user, reservation, authorization, audit, reporting and integration infrastructure, but their business rules remain separate.

## Core and security
- Canonical reservation model; retain source DMC, current supplier, sales channel and agency/customer sensitive fields separately.
- Explicit currency, tax, commission, net/gross and included-fee treatment.
- UTC timestamps; preserve supplier timezone and exact cancellation deadline.
- Correlation IDs and idempotency keys on external calls.
- Append-only audit log.
- Feature flags and independent module operation.
- Server-side tenant, role, source and object authorization; UI hiding alone is insufficient.
- Prevent uncontrolled concurrent supplier changes on the same reservation using operation lock or optimistic concurrency/version checks.

## Reservation model
Minimum fields: reservation ID, supplier booking reference, hotel, destination/region, room, board, dates, occupancy/guest count, currency, total price, cancellation policy/deadline, current supplier, source agency, status and timestamps.
Required state concepts include ACTIVE, UNDER_REVIEW, REBOOKING_SEARCH, REBOOKING_PENDING, RATЕRELAY_OPEN, TRANSFER_PENDING, TRANSFERRED, CANCEL_PENDING, CANCELLED, FAILED and EXPIRED. Adapt naming to existing code while preserving explicit state transitions.

## Rebooking System
- Continuously or on configured intervals search for a more advantageous valid alternative for an existing reservation.
- Compare property, room/capacity, board, dates, occupancy, child ages, bed/view/services, taxes/mandatory fees, cancellation/no-show and payment terms.
- Normalize currencies with a defined FX source and timestamp.
- Calculate net advantage after replacement cost, cancellation/rebooking fees, FX, taxes and platform costs.
- Minimum saving, risk thresholds and automatic permission are configurable; do not invent non-zero hard-coded defaults.
- Support recommendation mode and automatic mode.
- Sequence: revalidate alternative; create replacement; obtain supplier confirmation/reference; verify room/date/occupancy/price/cancellation; only then cancel old booking.
- If replacement is unconfirmed, keep old booking. If old cancellation fails after replacement confirmation, raise Back Office alarm and expose double-cost risk.

## RateRelay System
- Offer eligible existing reservations to an anonymous bid pool for relevant DMCs; this is distinct from Rebooking's continuous alternative search.
- Participants may see operational details needed to price, but never source agency, current supplier, other DMC identities, bids, count or ranking.
- Privacy must cover UI, API payloads, exports, notifications and accessible logs.
- Any authorized DMC may bid unless a future explicit management policy says otherwise. No source-DMC right to hold/match or see competitor bids.
- Bids include total price, currency, validity, included taxes/fees and required commercial terms.
- First valid bid starts 24 hours. A better valid bid renews the window while cancellation deadline is sufficiently far away.
- Close at a configurable safe cutoff before cancellation deadline; do not rely on a provider API call at the last second.
- No valid bid means preserve existing reservation and record NO_WINNER/EXPIRED.
- Select the lowest comparable valid total-cost bid. Equal bids require an explicit deterministic policy.
- Confirm replacement with winning DMC before source cancellation. On failure preserve existing booking; on source cancellation failure create critical Back Office reconciliation. No second winner or parallel transfer.

## Back Office and integrations
Separate Rebooking and RateRelay dashboards, filters, statuses and histories. Configure module enablement, manual/automatic mode, scope, 24-hour window, safety buffer, minimum saving and equivalence policies. Alert on API failures, timeouts, missing confirmation, cancellation errors and duplicate-operation prevention.
Supplier adapters must implement timeout, retry/backoff, rate limiting, error mapping, authentication/signatures and idempotency. Never treat missing supplier confirmation as success.

## Testing
Unit, service, integration, end-to-end, security, load and pre-production operational tests. Mock suppliers do not replace sandbox/production validation.
Rebooking acceptance: equivalent cheaper offer selected; non-equivalent rejected; unconfirmed replacement leaves old booking active; confirmed replacement then old cancellation; cancellation failure alarm; retry creates no duplicate; manual mode does not mutate reservation.
RateRelay acceptance: eligible audience only; anonymity across UI/API/export; 24-hour window and renewal; safe cutoff; invalid/more expensive bid cannot win; equal-price unresolved tie does not choose arbitrarily; failed transfer leaves old booking; concurrent closing/bids deterministic; timer survives restart; no bids preserve old booking; no double winner/transfer.
Core acceptance: tenant isolation, independent feature flags, correct FX/tax totals, immutable audit log, controlled retries and concurrency safety.

## Deployment stages
Discovery; design/migrations/rollback; Core lock/audit/feature flags/adapters/test foundation; Rebooking recommendation then sandbox then limited pilot; RateRelay anonymized panel/timer/close/transfer sandbox; selected pilot; general release only after acceptance/security/performance/monitoring/rollback/operations.

## Open decisions
Safety buffer; tie-break; bid update/withdraw; mandatory non-price bid terms; Rebooking minimum saving and FX source/frequency; accounting treatment; real supplier sandbox/production access.

## Important note
This document specifies requirements and acceptance expectations. It does not prove that code has been completed, supplier integrations exist or production behavior has been verified.
