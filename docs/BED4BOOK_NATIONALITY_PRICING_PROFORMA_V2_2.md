# BED4BOOK — Phase 1 Nationality Contract Pricing and Proforma — Technical Specification v2.2
Status: OWNER APPROVED SCOPE; IMPLEMENTATION IN PROGRESS; NOT DEPLOYED.
Base: claude/clever-thompson-awnwcc. Migrations 001–003 MUST NOT be edited.

## Decisions
- Eligibility precedence: exclusion (exact or group) > exact inclusion > group inclusion > unrestricted/general; eligibility does not set price. Lowest EUR-normalized eligible equivalent offer wins; deterministic tie-break. Never fallback after quote revalidation failure.
- Inventory: manual contractual allotment per rate plan. Authorized price loader sets inventory_daily.allotment/price through existing calendar workflow. No automatic cross-contract physical-capacity pooling; no HOLD, no SELECT FOR UPDATE. Atomic conditional per-night decrement and transaction rollback remain unchanged. Contract loaders are responsible for avoiding physical overselling when assigning allotments.
- FX: EUR reference, TCMB as primary source, hourly *polling*, not a promise of hourly new rates. Track published-at and fetched-at separately; do not mark old TCMB rates fresh just because re-fetched. TCMB may omit some of the 25 ISO currencies; missing pairs require explicitly approved secondary source or manual administrator entry; no guessed 1:1 fallback. Manual override remains protected until explicitly cleared. Keep fx_rates.eur_per_unit backward-compatible. Immutable rate versions and rate IDs for signed quote/snapshot. Provider errors and stale rates are visible to administrators. Decimal arithmetic and ISO minor units (JPY 0, EUR 2, KWD 3); HALF_UP for final payment conversion.
- Proforma: allowed for pending and approved bookings; derived only from immutable booking snapshot, never current rate; numbered by calendar year with transaction-safe counter; correction issues new version; explicitly NOT A TAX INVOICE. No payment capture, e-invoice, or virtual POS.
- Legacy bookings: never reprice or infer missing nationality/contract/FX. Preserve original booking fields, booking_nights, quote and status. Nullable snapshot references for historical bookings; legacy proforma only when sufficient verified historical amounts are present, otherwise explicit LEGACY_SNAPSHOT_UNAVAILABLE.
- All guests' nationality is supplied in the new API, independent of agency country. Every guest must qualify; missing nationality returns 400 NATIONALITY_REQUIRED. Existing quote v1 and old search behavior must remain usable during rollout until explicit cutover and test updates are approved.

## Data model
Keep existing inventory_daily as price/allotment source; rate_plans.currency as price currency; agency_hotel_sales as publication/markup. New entities: currencies (ISO allow-list, minor units); hotel_contracts (hotel, contract code, validity, status, currency); contract_rate_plans (unique rate plan); market_groups/members; contract_nationality_rules (include/exclude country/group); booking_guests; booking_price_snapshots (immutable quote and conversion trace); fx_rate_versions; proforma_year_counters; proformas. Each guest's matched eligibility decision must be captured in the snapshot as JSON, not a single rule id. A rate plan belongs to at most one contract. DB trigger verifies contract.hotel_id matches rate plan's room.hotel_id and contract.currency matches rate_plans.currency.

## Migration and legacy backfill
Migration 004 adds new structures without changing 001–003. Backfill one general-market contract per hotel, grouping each hotel's existing rate plans; where currencies differ, use one general contract per hotel *and currency* (a single-currency contract cannot cover mixed-currency rate plans). Existing records and bookings stay unchanged. Migrations must be re-runnable; schema_migrations runner is a prerequisite for production deployment, not implemented by 004.

## API proposal (not yet implemented)
GET/POST/PATCH /api/admin/hotels/:hotelId/contracts; GET/POST/PATCH /api/admin/market-groups; PUT /api/admin/contracts/:id/nationality-rules; GET/PUT /api/admin/currencies; GET/PUT /api/admin/fx-rates; POST /api/admin/fx-rates/refresh; GET /api/admin/fx-rates/history; GET /api/admin/bookings/:id/snapshot; POST /api/bookings/:id/proformas; GET /api/bookings/:id/proformas/:version/pdf.
Authorization: system_admin/back_office global; master_agency only its owned hotels; sub_agency cannot manage contracts. Proforma view: sub_agency own booking; master_agency owned hotel bookings; platform roles all. Apply backend checks and audit before/after, IP, request ID.

## Search and booking contract
Search request includes guests:[{type:'adult'|'child',age?:number,nationality:'DE'}] for every traveler. Validate count matches occupancy. Filter eligible contracts before pricing. Quote v2 HMAC payload includes contract id, rate plan, nationality list, per-guest rule decisions, nightly prices, EUR FX version IDs, payment currency and amount, expiry. Booking and draft submission revalidate the exact winning rate plan, contract, eligibility, publication, nightly price, markup, availability and quoted FX IDs. On any mismatch return 409 with stable reason code; never try second rate plan. Booking writes immutable price snapshot and guests in same transaction as booking. Do not write on search.

## Acceptance tests (real isolated PostgreSQL)
- Exact/group exclusions override inclusion; exact/group/general inclusion eligible.
- Missing nationality 400; mixed nationality all eligible or no offer; booking mismatch 409.
- Lowest EUR eligible offer wins; cheaper ineligible offer hidden; deterministic tie; no fallback.
- Nationality set in equivalence key; quote v2 tamper/expiry/changed rules 409.
- Missing FX excludes offer; changed FX 409; stale provider and override handling.
- JPY/EUR/KWD HALF_UP; snapshot unchanged after contract, rule, markup, inventory price or FX updates.
- Proforma matches snapshot; year numbering collision-free under concurrent issuance; correction new version; RBAC and immutable PDF.
- Existing 62 tests, M1–M18 unchanged; add mutations for exclusion bypass, fallback, and current-FX proforma.
- Search writes zero rows and never touches inventory; reserveNights atomic semantics unchanged.

## Release gates
1. Implement and verify migration runner, audit extension and 004 on empty + legacy upgrade databases.
2. Implement provider adapters with licensed/approved TCMB feed, currency coverage matrix, and fallback policy.
3. Implement contract eligibility/search/quote/booking snapshot, UI, proforma.
4. Run isolated PostgreSQL suite, mutation tests, PDF checks, performance, and end-to-end browser tests.
5. Explicit owner approval before merge, migrations on shared databases, or deploy.

## Outstanding details
TCMB does not guarantee every currency or hourly changes. Confirm exact secondary source, rate staleness threshold, weekend policy, legal company/address and bank footer for proforma, and which staff role may edit allotments. None may be silently assumed.
