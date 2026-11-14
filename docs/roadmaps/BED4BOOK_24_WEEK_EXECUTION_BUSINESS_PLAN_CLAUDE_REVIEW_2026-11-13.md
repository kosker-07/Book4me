# BED4BOOK — 24-Week Execution Business Plan and Release Governance
**Version:** 1.0 — 2026-11-13  
**Status:** DRAFT FOR CLAUDE INDEPENDENT REVIEW — NOT IMPLEMENTATION AUTHORIZATION  
**Repository:** kosker-07/Book4me  
**Base:** claude/clever-thompson-awnwcc  
**Companion reviews:** Draft PR #55 (AI-native distribution roadmap and solo-operator commercialization addendum); PR #54 (lean AI operations).

## 0. Executive decision
Build forward from the existing BED4BOOK implementation, not from scratch. Deliver a commercially reliable hotel/DMC marketplace core first, followed by charter flight extranet, static packages, mixed static/API hotel distribution, dynamic packages and broader integrations. Embed event-driven AI agents and authorized email control so the founder can operate approximately USD 3M annual transaction volume without permanent operational staff, subject to measured evidence and safe escalation. Free DMC onboarding to acquire supply; sell platform technology from the earliest stage when a tested, supportable module is ready, without waiting for a revenue milestone.

**Working timeline assumptions:** one founder as product owner/sales lead; ChatGPT and Claude assist with analysis, code and tests in isolated branches; workstreams can proceed concurrently but integration/release gates are sequential. First limited live commercial release in **6–8 weeks**; charter and static package maturity **10–14 weeks**; broader AI-native multi-product capability **16–24 weeks**. Dates are forecasts, not commitments or guarantees of partner API access.

## 1. Evidence baseline and no-rewrite rule
As inspected on 2026-11-13, the working branch includes `server/app.ts`, `server/admin-routes.ts`, `server/pricing.ts`, `server/quotes.ts`, `server/contract-import/grid-reader.ts`, `server/contract-import/excel-reader.ts`, `server/ai/runtime.ts`, `server/ai/agents/runner.ts`, `server/mail/*`, booking/finance/distribution modules, migrations 001–060 and CI workflows. Open PRs include #45 marketplace tests, #46 contract import tests, #48 AI Center, #50 finance UI, #51 durable inbound AI queue, #52 owner assistant; #54/#55 are review documents. Do not treat open PRs as merged or tested functionality merely because files exist. `060_supplier_connections.sql` explicitly states there are no external calls yet. Recent green GitHub Actions on feature branches do not constitute complete production acceptance.

Before modifying a feature, classify KEEP / EXTEND / REFACTOR / ADD / DEPRECATE with exact source paths and regression impact. Preserve marketplace rules: DMCs are sellers and buyers, buyer sees BED4BOOK only, supplier identity and internal prices protected, platform owns distribution and margin policy, sub-agencies under DMCs. No uncontrolled agent mutations, no new parallel booking/finance/auth core, no unauthorized production changes.

## 2. Product boundaries and deliverable definitions
**R1 — Limited commercial hotel marketplace (weeks 6–8 target):** DMC onboarding and role isolation, hotel static contract ingestion, validated price/allotment and distribution, booking lifecycle, voucher, finance ledger, credit checks, session persistence, verified mail alerts, backups/restore, security and incident recovery. A small number of invited DMCs can transact under controlled limits. R1 does NOT imply complete charter, dynamic packages or global API availability.

**R2 — Charter and static package product (weeks 10–14 target):** seasonal Excel/CSV charter flight ingestion, airline/route/departure/time-zone, booking classes, allotment, holds, cancellation/release, stop-sale, operator-defined yield pricing, 12-month calendar, manifest, and charter+static hotel+optional transfer/tour package quoting/booking. Airline ticket issuance is separate and must not be falsely claimed.

**R3 — Multi-source dynamic package and automation (weeks 16–24 target):** authorized API adapters for accessible providers, hotel static/API canonical offer comparison, cheapest *eligible all-in* price, quote recheck, mixed charter+hotel+transfer/tour package orchestration, component booking confirmations, partial-failure saga, financial reconciliation, agent-driven exception handling, supplier performance observability. External provider availability depends on access/contract approvals.

**Technology commercialization:** sell a reliable subset or managed pilot as soon as security, deployment, support and commercial readiness gates pass, potentially during R1. White-label, licensee configuration and billing evolve incrementally; do not rebuild the marketplace into generic SaaS prematurely.

## 3. Weekly work packages and owner-facing deliverables
| Week | Workstream | Exit artifact / gate |
|---|---|---|
| 1 | Baseline inventory: code/PR state, migrations, API routes, CI, Railway staging, blockers; freeze core acceptance tests | Signed KEEP/EXTEND/REFACTOR/ADD matrix; prioritized backlog; baseline metrics |
| 2 | Integrate/validate critical PRs independently: booking/tenant/session/price/finance; CI, DB and restore tests | Regression green; risk register; no unreviewed merge |
| 3 | Reuse AI runtime and inbound mail queue; authenticated instructions and bounded approval workflow; retries/checkpoints | End-to-end authorized email task test with audit |
| 4 | Hotel Excel/grid-reader, DMC onboarding, inventory publication and exception queue | Contract fixture coverage, validated imports, no silent loss |
| 5 | Booking, voucher, credit, ledger, reconciliation and DMC cross-tenant tests | Realistic transaction acceptance suite |
| 6 | Staging load/security/recovery drills, metrics, backup restore, incident playbook | Release candidate and go/no-go checklist |
| 7–8 | Limited production pilot: invited DMCs, controlled volumes, monitoring, feedback, owner approval | R1 live only if gates pass |
| 9–10 | Charter Excel importer, seasonal flights, class/allotment/seat holds, 12-month view | No oversell tests, import regression and capacity audit |
| 11–12 | Yield rules and operator constraints; static charter+hotel packages | Yield floor/ceiling tests, package quote/booking tests |
| 13–14 | Charter pilot, manifests, stop-sale, cancellations, release, reconciliation | R2 go/no-go |
| 15–16 | Provider capability registry and adapter contract tests; static/API hotel normalization | Mock and sandbox adapters with rate limit/timeout behavior |
| 17–18 | Cheapest eligible hotel selection; caching, mapping, quote recheck and provenance | Price correctness and p95 search benchmarks |
| 19–20 | Dynamic package saga, transfer/tour, partial failure and compensating actions | Multi-component booking/recovery tests |
| 21–22 | Autonomous finance/support/reporting agents, approved learning, alerts and owner email dashboard | Solo-operator drill; exception response metrics |
| 23–24 | Full load/chaos/security/backup drills; pilot technology license packaging; partner-specific readiness | R3 conditional release and roadmap reforecast |

**Parallelization:** Charter importer, adapter interface research, contract fixtures, UI and AI-agent tools may run on separate branches while core stabilization proceeds. Shared booking, pricing, inventory, auth and finance contracts require sequenced integration and regression gates. Avoid too many simultaneous branches for a single founder; assign clear integration owner and review cadence.

## 4. Operational design for one founder
Owner performs sales, partner negotiation, risk-policy approvals and strategic decisions. Agents orchestrate DMC applications, document intake, charter/hotel imports, price proposals, scheduled updates, inventory alerts, reservations, vouchers, supplier mail, finance reconciliation and daily reports. Trigger agents on events/schedules; do not call LLMs for every availability search. Deterministic services enforce authorization, stock, pricing, financial controls and booking state. Risky actions require authenticated, time-bound, transaction-specific approval; email address alone is not authentication. Provide emergency console and outsourced incident fallback. No mandatory full-time headcount until measurements justify it.

**Acceptance targets (proposals, not current metrics):** >=95% routine workflows completed without manual intervention; 0 oversells in stress tests; 0 cross-tenant data leaks; 100% high-risk actions audited/approval gated; p95 internal API <200ms and cached hotel search <500ms under specified test load; automatic failure recovery and owner escalation; cost per booking measured. Track owner touches per 100 bookings and real response time. USD 3M revenue-volume goal is a business target, not a proxy for search load: model concurrency, requests per search, supplier fanout, reservation count, payment mix and exceptions.

## 5. Infrastructure and cost controls
Railway staging already has bed4book-api and Postgres. Recent staging CPU and memory use is low, but does not represent production peak. Keep cost-effective development tier; evaluate Pro before real B2B operations based on production reliability and load tests, not GMV. Budget compute, PostgreSQL, Redis/queue if needed, backups, object storage, logs, AI token usage, email delivery, API quotas, monitoring, third-party supplier fees, payment fees and on-call recovery. No fixed low dollar claim without transaction/query counts. Meter per tenant and per workflow; free DMC tier must have anti-abuse quotas and reasonable support boundaries.

## 6. Commercial go-to-market alongside engineering
**Supply acquisition:** free basic DMC onboarding and product import; validate company and authority; gather hotel static contracts and charter allotments; ensure permissioned publication and BED4BOOK supplier masking. Measure activated DMCs, live inventory, price validity and supplier response.
**Demand acquisition:** recruit initial qualified B2B buyers and sub-agencies; focus on reliable fulfillment, not raw signup counts. Track search-to-quote, quote-to-book, gross margin, refunds and payment collection.
**Technology sales:** offer earliest reliable core module or managed pilot with repeatable deployment, isolation, contractual support, documented capabilities, licensing/IP/data rights, tenant-specific credentials and clear commercial terms. Do not promise integrations or ticketing not yet implemented.
**Expansion:** selective hotel API/charter/tour/transfer partnerships, static/dynamic package distribution, white-label and managed SaaS options based on customer demand.

## 7. Governance and release discipline
- Small PRs, single topic, branch from current approved working base; independent workstreams parallel where safe.
- Automatic `npm ci`, `npm run build:server`, relevant no-DB tests locally; PostgreSQL integration tests and full GitHub Actions on pushed feature branches; verify exact green runs, not claims.
- Required security, tenant isolation, idempotency, concurrency, pricing, FX, cancellation, financial and import regression suites.
- Staging deployment and production are separate; **production only with explicit owner approval**. No auto-merge or hidden changes.
- Weekly 30-minute owner review: shipped, in review, blockers, metrics, next week's scope; update forecast from actual velocity.
- Go/no-go gates: full applicable CI green; zero unresolved P0, accepted P1 mitigations; migrations and rollback plan; restore drill; credentials/secrets; alerting; supplier and financial workflows; operator runbook; pilot sign-off.
- For critical failure, halt release, isolate change, revert/roll back safely, notify owner and create regression test.

## 8. Dependencies and risk register
1. **External API partnership access:** commercial agreements and sandbox credentials may take longer than engineering; build mock contracts first.
2. **Charter allotment concurrency:** physical seats vs class buckets, holds, release, multi-channel sales and oversell risk.
3. **Dynamic package partial failures:** prevent false confirmation and financial exposure.
4. **Agent approval/security:** spoofing, prompt injection, replay, cross-tenant access and unauthorized price/money actions.
5. **Pricing normalization:** taxes, board, nationality, occupancy, currency, cancellation, stale rates and booking recheck.
6. **One-person support burden:** incidents, payment disputes, supplier exceptions, business hours and holidays; require escalation fallback.
7. **Technology license divergence:** avoid custom forks that fragment main product; feature flags and isolation.
8. **Timeline optimism:** 6–8 weeks is a conditional hotel-core pilot, not the whole global platform.

## 9. Claude independent review assignment
Inspect current repository, actual open PRs and CI, then deliver:
1. Correct any wrong baseline assumptions with file/line and PR evidence.
2. Independently estimate **optimistic/base/conservative weeks** for R1, R2, R3, considering one founder and AI-assisted engineering.
3. Propose your own critical path and week-by-week backlog with small PRs, dependencies, test acceptance and owners.
4. Explain what should be **removed, postponed, simplified or added** without rebuilding existing systems.
5. Challenge whether solo-operation at USD 3M is feasible and specify measurable evidence.
6. Propose earliest defensible technology product/pilot and launch criteria.
7. Rank integration readiness by partner documentation, commercial prerequisites and expected technical complexity.
8. Compare your plan against this plan in a table; identify agreements/disagreements and propose **one reconciled execution roadmap**.
9. Highlight any timeline assumptions that require founder decisions, supplier contracts or third-party access.
10. Deliver a release checklist and the first **10 executable, independently reviewable PR tasks**.

**IMPORTANT: This is an analysis request only. Do not implement code, modify migrations/master specs, merge PRs, change live services or deploy. Await owner decision on the combined plan.**
