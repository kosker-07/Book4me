# Cloud Review Task — BED4BOOK Core
Date: 2026-11-07
Repository: kosker-07/Book4me
Implementation commit: b4aa588069a247b1e9d69c6d2f97e73c6de1e31a
RateRelay timestamp correction: b14f980636b0f5a8dee025b5e40bab16fc5a14a0

## Request to Cloud
ChatGPT added the BED4BOOK Rebooking and RateRelay backend orchestration module and a focused test file. Please independently inspect every changed line before extending or replacing anything.

### Files to inspect
- `src/updates/u0030-bed4book-core.js`
- `tests/bed4book.js`
- `docs/BED4BOOK_Core_Implementation_Handoff.md`
- Existing interactions: `src/updates/u002e-rebooking.js`, `src/domain/booking.js`, `src/domain/search.js`, `tools/build.js`, `tools/load.js`

### Required tests
1. Run `node tests/bed4book.js`.
2. Run `node tests/unit.js`.
3. Run `node tools/build.js`.
4. Add negative-path tests: supplier quote timeout/error, changed price at recheck, unavailable replacement, booking rejection, old-booking cancellation rejection, duplicate idempotency key, repeated pool creation, invalid/mismatched offer, equal-price bids, offer at/after safety cutoff, extension cap, and hidden supplier identity in every public response.
5. Verify the old booking is not cancelled unless the replacement supplier has positively confirmed.
6. Verify cancellation failure produces a reconciliation state and never claims successful completion.
7. Verify tenant isolation and authorization before exposing pool or supplier-level details.

### Review constraints
- Do not delete or rewrite the legacy `B4M.rb` module without a documented migration and regression tests.
- Do not silently merge legacy auction behavior with the new Rebooking sequence.
- Do not claim live supplier integration: adapters are an interface only until real credentials, endpoint contracts, and certification tests are supplied.
- Do not mark a feature production-ready solely because unit tests pass.
- Record findings in a new Markdown file under `docs/reviews/`, including test commands, pass/fail output, defects, severity, and files/lines affected.
- Fixes must be committed separately with a clear message. Preserve ChatGPT's original commit history.
- If the original BED4BOOK PDF is required to verify detailed rules, request/locate that exact source before approving specification conformance. Do not infer omitted requirements.

## Current known limitations to verify
- The PDF binary itself was not available to this implementation session; only a prior conversational summary was available.
- RateRelay timing defaults (24-hour initial window, 1-hour near-deadline extension, 15-minute safety buffer) are configurable implementation defaults and require confirmation against the original PDF.
- Supplier adapters are not implemented for Hotelbeds, Booking.com, Expedia, Sejour, Maximum, or any other live supplier.
- The existing booking domain currently creates local bookings as confirmed; the new module does not yet unify this with a supplier-confirmation-first booking lifecycle.
- No successful automated test or build result is claimed by ChatGPT in this handoff.
