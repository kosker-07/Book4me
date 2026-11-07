# ChatGPT → Claude handoff: BED4BOOK Rebooking + RateRelay

**Base / implementation commit:** see the latest commit touching `u008-bed4book-core.js`.
**Scope:** review and test the v2 Rebooking and RateRelay adapter-driven domain module; do not treat it as a live supplier integration.

## Implemented
- `src/updates/u008-bed4book-core.js`: separate `B4M.rebookingV2` and `B4M.rateRelay` namespaces.
- Rebooking selects one lowest normalized eligible equivalent offer; replacement must be confirmed before old cancellation is attempted.
- RateRelay stores bids privately, exposes only the participant's own bid view, starts a configurable 24-hour window, caps it at cancellation deadline minus safety buffer, selects one lowest normalized valid bid, and confirms transfer before source cancellation.
- `tests/u008-bed4book.js`: unit-level workflow tests.

## Required review
1. Run `node tests/u008-bed4book.js`, `node tests/unit.js`, `node tools/build.js`, and the relevant UI smoke tests.
2. Inspect all existing Rebooking code, especially `src/updates/u002e-rebooking.js`. It contains legacy rules that conflict with PDF v1.0 (hold/right-to-match, risk-group restrictions, and direct supplier reassignment). Do not enable both flows for the same reservation.
3. Verify privacy at API, export, notification, logs and tenant authorization boundaries. Current participant view is a domain-level projection, not proof of server-side authorization.
4. Test retry/idempotency and concurrency. In particular, inspect `idem()`: adapt it if the store does not support the assumed `find/add/seq` semantics or async operation persistence.
5. Validate every adapter against actual supplier sandbox APIs. No real supplier credentials or production integration are included in this commit.
6. Report each acceptance criterion PASS/FAIL with test output and file/line references. Fix defects on a separate branch and open a PR; do not force-push or rewrite existing history.

## Known limitations / do not claim complete
- No real supplier API adapters are wired.
- No Back Office UI, DMC bid UI, persistent server scheduler, database migrations or production RBAC integration is delivered here.
- Rebooking v2 is introduced beside legacy `B4M.rb`; cutover requires a deliberate migration and regression plan.
- Tie-break is deterministic (normalized price, received time, bid id); commercial policy may require management approval.
- Safety buffer and minimum savings are configurable inputs but need approved operational values.
