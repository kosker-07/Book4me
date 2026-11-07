# BED4BOOK Core — implementation handoff
- Version: 1.0.0
- Date: 2026-11-07
- Status: implementation scaffold committed; supplier integration and independent verification pending.

## Scope delivered
- `src/updates/u0030-bed4book-core.js`: Rebooking orchestration and RateRelay reverse-offer pool.
- `tests/bed4book.js`: focused Node tests for adapter-driven replacement, anonymous public bid projection, and lowest normalized offer selection.
- Existing `tools/build.js` and `tools/load.js` automatically include backend update files whose names match `uNNN*.js`; no build-list edit was required.

## Rebooking behavior
1. Search equivalent offers from registered supplier adapters.
2. Reject offers that are unavailable, non-comparable, or fail policy checks.
3. Revalidate the lowest qualifying offer.
4. Create and confirm the replacement booking.
5. Only after replacement confirmation, request cancellation of the old booking.
6. If cancellation is not confirmed, mark the operation `manual_reconciliation`; never silently claim completion or automatically retry a second supplier.

The adapter contract requires `quote(oldBooking)`, `recheck(offer, oldBooking)`, `book(offer, {idempotencyKey})`, and `cancel(oldBooking, {idempotencyKey})`. This is orchestration code, not a live Hotelbeds/Booking/Expedia/Sejour/Maximum connector. No supplier credentials or live endpoints were available during this change.

## RateRelay behavior
- One open pool per booking.
- Public pool/bid projections omit supplier identity.
- First valid offer starts the 24-hour window.
- A better offer near the end can extend the window, capped by the safety cutoff.
- The lowest valid normalized EUR total wins; ties are deterministic by bid ID.
- Safety cutoff is 15 minutes before the stored free-cancellation deadline where available.
- Window, extension, and safety-buffer values are configuration values and must be checked against the source PDF before production enablement.

## Important existing-system conflicts
- The repository already contains legacy Rebooking logic in `src/updates/u002e-rebooking.js`, including a supplier “keep” right and a browser-local auction model. This new BED4BOOK module is namespaced separately as `B4M.bed4book`; it does not silently replace or disable legacy `B4M.rb` behavior.
- Existing `src/domain/booking.js` creates local bookings as “Onaylı” before a supplier confirmation adapter is invoked. The new module does not retrofit that booking lifecycle. Production activation requires resolving this architectural mismatch.
- Search currently uses seeded/local inventory and includes a deterministic simulated flight source. Supplier adapter registration is not equivalent to live API connectivity.
- The source PDF was not available in the current file workspace at implementation time. This handoff uses the PDF requirements previously summarized in the conversation; exact field-by-field conformance must be checked against the PDF itself.

## Verification status
- `node tests/bed4book.js` passed in GitHub Actions on commit `bb68a9f59416787921df6a2e7768d321e7383985`.
- `node tools/build.js` passed in the same GitHub Actions run.
- The existing full suite `node tests/unit.js` was not run by this focused workflow and remains to be independently verified.
- CI run: https://github.com/kosker-07/Book4me/actions/runs/42369780380
- Passing focused tests do not establish live supplier connectivity or production readiness.


## Project-owner specification received — 2026-11-07

The project owner has now supplied the original:
- `BED4BOOK_Teknik_Sartname.pdf`
- `BED4BOOK_Proje_Sartnamesi.pdf`

Faithful Markdown versions are committed as:
- `docs/BED4BOOK_Teknik_Sartname.md`
- `docs/BED4BOOK_Proje_Sartnamesi.md`

**Scope clarification:** the supplied v1.0 documents define the first commercial release as a manual-inventory, sub-agency B2B hotel platform with responsive web UI, admin/content management, sub-agency panel, Back Office, reservation lifecycle, PDF voucher, role/agency isolation, security and backup/restore. They explicitly place supplier API/XML, payments, mobile apps, accounting/e-invoice and advanced automation in later phases.

Rebooking and RateRelay are not identified as first-release modules in these source documents. The existing `u0030-bed4book-core.js` remains in the repository as a separate implementation scaffold; its inclusion in v1 is not established by the supplied PDFs. Cloud must report this scope distinction and must not treat this module as a v1 acceptance requirement without a separate project-owner decision.

The technical specification states that the document alone does not authorize source-code or live-server changes. The project plan also requires explicit approval for live deployment and critical changes. Cloud review must respect those change-control boundaries.
