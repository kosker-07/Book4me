# BED4BOOK B2B search — handoff and integration gates (2026-11-07)

Branch: `chatgpt/bed4book-b2b-search-ui` (isolated from Claude's development branch).

## Delivered
- `prototypes/b2b-search/index.html`: standalone responsive B2B agency search prototype, login/logout via existing API, read-only search via `POST /api/agency/searches`, client-side hotel/location filtering, price sorting, guest/child-age controls.
- `prototypes/b2b-search/tests/search-ui.test.cjs`: nine dependency-free static contract/safety tests.
- `.github/workflows/bed4book-search-ui.yml`: Node 22 test job.

## Explicit blockers (DO NOT deploy as production)
1. Current `validateStay` accepts aggregate `rooms/adults/children/childAges`, not independent per-room allocations. UI therefore blocks multi-room searches; backend and signed quote schema need coordinated change before enabling.
2. Current `/api/agency/searches` does not enforce structured nationality/market eligibility. `sales_conditions` only separates offers. Before live use, implement eligibility checks server-side; never rely on frontend filtering.
3. Destination autocomplete / server-side destination filtering not implemented. Current text filter is applied to returned results only, so this is not scalable destination search.
4. No supplier adapters or real external supplier credentials are configured by this prototype. No supplier identity or net price is rendered.
5. Booking confirmation, price recheck and signed quote consumption are NOT wired. Booking button intentionally disabled.
6. Mandatory email OTP and maximum 72-hour session are NOT implemented in current backend; `/api/auth/login` still returns a bearer token after password verification. Do not expose this prototype as production login before the approved OTP backend migration.
7. UI is not mounted in the Express server nor linked to the legacy offline `src/` UI. Prototype requires an appropriate same-origin dev server / authenticated B2B deployment integration.
8. Inline CSS/JS should be extracted and governed by CSP before production. Add end-to-end browser tests, real API integration tests, and accessibility audits.
9. Verify existing `u004-sade` flaky browser test and missing logo fixtures independently; these are unrelated to this prototype.
10. Production reverse-proxy trust setting must be verified with actual ingress behavior; never assume `TRUST_PROXY=1` is correct.

## How to run prototype checks
`node --test prototypes/b2b-search/tests/*.test.cjs`

These are static source contract tests, NOT browser or integration tests. They do not prove correct API behavior or security under production conditions.

## Claude independent review request
- Review prototype and tests on this branch without merging or changing Claude's branch.
- Confirm search request schema against current backend, including max occupancy and signed quote semantics.
- Check all tenant isolation and supplier secrecy properties server-side.
- Add real browser and API integration tests on a separately approved integration branch.
- Report PASS/FAIL/BLOCKED separately for static checks, browser tests, API tests and deployment.
- No merge into main, no Railway changes, no live secrets.
