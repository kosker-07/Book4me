# BED4BOOK — Existing-System-First AI-Native Global Distribution Roadmap
**Date:** 2026-11-13  
**Status:** DISCUSSION / CLAUDE REVIEW ONLY — NO IMPLEMENTATION AUTHORIZED  
**Owner direction:** Preserve and evolve existing code. Do not rebuild, delete, merge, change master specifications, or deploy.

## 1. Commercial vision and non-negotiable model
BED4BOOK enables small and mid-sized DMCs with strong negotiated hotel contracts and charter seat allocations to sell through larger international buyer networks. The platform acts as the commercial distribution layer. DMCs may supply and buy; buyers see BED4BOOK as provider, never the originating seller DMC. Platform controls buyer eligibility, distribution and commercial markup; sub-agencies belong to their DMC. Enforce tenant isolation, supplier confidentiality, and existing permissions. Preserve current marketplace pricing and booking semantics.

The platform should automate operational workload using embedded AI agents, supervised via authenticated authorized email instructions and transaction-bound approvals. Humans direct policy and exceptions; agents plan, ingest, monitor, report and operate within delegated scopes. Deterministic services alone commit stock, prices, bookings and money. Do not equate AI autonomy with permission to invent rules, self-escalate privileges or bypass confirmations.

## 2. No-rebuild mandate
Review actual source and tests in `claude/clever-thompson-awnwcc` and relevant open PRs. Classify each existing module KEEP / EXTEND / REFACTOR / ADD / DEPRECATE, with evidence, paths, lines, regressions and migration needs. DEPRECATE is a proposal, not authorization to remove. Prefer backward-compatible, additive migrations, feature flags, adapters, contract tests and small isolated PRs. Do not duplicate existing mail, AI runtime, grid-reader, distribution, pricing, session, booking or tenant services. Verify rather than assume implementation completeness.

Potential components to inspect (paths may differ): `server/ai/runtime.ts`, `server/ai/model.ts`, `server/ai/approvals.ts`, `server/ai/notify.ts`, `server/ai/store.ts`, `server/mail/*`, `server/app.ts`, hotel grid-reader, marketplace distribution/pricing and reservation tests. Review migration sequence and CI. Report exact refs, not inferred status.

## 3. Supply and connectivity architecture
Support inbound hotel static contracts (Excel, PDF, structured API, extranet) and API-sourced rates, charter/blocked airline seats (Excel/CSV/contract/email), tours, activities and transfers. Normalize to domain-specific canonical schemas while retaining supplier-specific raw data and provenance. Separate product identity, inventory, availability, price, rules, supplier confirmation and settlement. Avoid a single universal inventory table.

Prepare **provider-neutral supplier adapters** and **buyer-distribution adapters** with capability registry: search, content, availability, quote/recheck, hold (if supported), book, amend, cancel, inventory push/pull, webhooks, polling, reconciliation, authentication, limits, currency, nationality, occupancy, errors and idempotency. Explicitly model unsupported capabilities. Use caches with freshness rules, circuit breakers, quotas, retries and dead-letter handling. Future candidates to research and evaluate independently: HBX/Hotelbeds, Travelgate, Juniper, Expedia Rapid, Amadeus, Travelport, Sabre, Duffel, Rezdy, Bókun and tour/transfer partners. Do not claim partner access or promise protocol compatibility without verified documentation and commercial authorization.

## 4. Hotel supply and cheapest eligible selection
Unify static DMC hotel contracts and authorized API offers in one search/quote abstraction, not one physical table. Resolve hotel, room, board, occupancy, dates, nationality, market, currency, taxes, mandatory charges, cancellation, payment terms, supplier eligibility, availability and freshness. Compare **lowest valid all-in eligible cost** and apply BED4BOOK commercial rules; never select cheapest displayed price alone. Preserve quote provenance and snapshot; recheck API quotes before commitment. Avoid combinatorial fanout via prefiltering, caching, supplier prioritization and request budgets. Retain strict DMC identity masking.

## 5. Charter flight extranet: zero routine manual entry
DMC/operator supplies seasonal flight and seat-block contracts via Excel/CSV or authorized email attachments. AI extracts and maps flight number, airline, IATA airport codes, dates, local time/time zone, recurrence, one-way/return, cabin, booking class/fare bucket, physical allotment, class availability, base/net prices, baggage, passenger rules, name-change/refund/release, ticketing provider and manifests. Detect duplicates, inconsistent capacity, conflicts, errors and changed versions; present traceable validation results. Authorized approval or preapproved import policy controls publishing. Operators should not have to enter each departure manually. Provide year calendar, per-flight class inventory, sold/held/remaining, auto stop-sale, audit, notifications and rollback-safe correction workflows.

**Yield management:** Rules-based baseline driven by occupancy, time to departure, booking velocity, seasonality, class thresholds, cost floors/ceilings and operator-configured constraints; AI may recommend or tune within approved limits using measured outcomes. Class buckets must not duplicate physical seats. Distinguish airline total capacity from contracted DMC allotment. Model seat holds, expiry, cancellations, release and concurrent booking without oversell. Manual flight inventory creation is a fallback, not a required workflow. Charter booking does not equal airline ticket issuance.

## 6. Static and dynamic package engines
**Static packages:** DMC/operator preconfigures charter flight + hotel + optional transfer/tour, with fixed or rule-priced bundles, sale dates, allotment, component rules, passenger/occupancy conditions and package cancellation terms. Allow packages built from static hotel contracts.

**Dynamic packages:** Combine DMC charter flight with **both** static-contract hotels and live API hotels; optionally transfer and tours. Automatically identify cheapest eligible hotel offer (as above), calculate package price, and revalidate every mandatory component. Search/quote/booking phases must be distinct. Maintain one customer order with independently confirmed component bookings. Use durable saga/orchestration for partial failure, retry, compensation, supplier reference, financial exposure, timeout and escalation. Never mark package confirmed before all mandatory components confirm. Consider mixed static+API packages and future scheduled-flight adapters without conflating charter and GDS/NDC ticketing obligations.

## 7. Email-directed AI operations
Authorized email is the primary command/approval/reporting interface, not proof of identity by itself. Authenticate senders, validate tenant/role, bind high-risk approvals to exact action/amount/version/expiry with step-up verification; defend against spoofing, prompt injection in attachments, replay and cross-tenant leakage. Implement durable task state, resume/checkpoints, worker lease/heartbeat, bounded helper agents, concurrency, budgets, retries, incident routing, approval gates, audit and reporting. Reuse existing AI runtime and mail/outbox/inbound systems where present.

Possible logical agent profiles (not necessarily separate always-on services): Contract, Inventory, Mapping, Flight Yield, Package, Booking, Supplier Integration, Finance, Reporting and Supervisor. Use deterministic tooling for business mutations. Learning from corrected mappings, validated contracts, authorized policies and measured outcomes must be versioned, tenant-scoped, reversible and gated; never autonomously alter commercial authority.

Examples of end-to-end flows:
1. DMC emails 12-month charter Excel -> verified extraction -> class/seat checks -> policy-based approval -> publish -> auto yield updates -> package offers -> audit/report.
2. DMC emails hotel contract -> existing grid-reader + AI assist -> mapping/validation -> approved inventory -> distribution.
3. Buyer requests package -> charter availability + static/API hotel comparison -> quote/recheck -> coordinated booking -> voucher/manifest -> finance reconciliation.
4. Supplier rate/flight schedule change -> detection -> impact analysis -> safe remediation or authenticated escalation -> email digest.

## 8. Controls and measurable outcomes
No overbooking, fabricated ticketing, silent stale-rate acceptance, unauthorized price changes, cross-tenant access, supplier identity leaks, unbounded agents, autonomous production deployment or irreversible financial actions. Monitor % straight-through bookings, human touches/100 bookings, contract ingestion accuracy, invalid quotes, oversell incidents, partial-package failure, supplier adapter uptime, approval turnaround, cost/booking, model spend, audit completeness, finance discrepancies and staffing leverage. Define baseline and target only after measurement; do not invent current figures.

## 9. My proposed incremental roadmap (challenge it)
**P0 — preserve and stabilize:** source/PR inventory, compatibility matrix, booking/tenant/price snapshot tests, verified email approvals, durable agent continuation, import pipeline reuse, canonical boundaries and provider capability contracts. No major rewrite.
**P1 — monetizable supply:** charter Excel import + seasonal class/allotment/yield, hotel static/API quote normalization, cheapest eligible hotel, basic static package, manifest/voucher, DMC-controlled distribution; simulate adapters before live partner access.
**P2 — multi-component automation:** dynamic package saga, transfers/tours, supplier lifecycle automation, reconciliation and AI exception handling, provider sandbox integrations.
**P3 — global scale:** approved live buyer/supplier integrations, advanced yield optimization, NDC/GDS where commercially feasible, operational learning and cost optimization.
Dependencies and sequencing must be validated against current code and release risk. P0/P1/P2/P3 are proposals, not approved commitments.

## 10. Claude: independent critique and roadmap requested
Please inspect the actual repository and existing open PRs, then provide:
1. KEEP/EXTEND/REFACTOR/ADD/DEPRECATE matrix with concrete paths, line references and evidence of tests.
2. What is already implemented, partial, absent, conflicting or in-flight (do not count PRs as merged).
3. Your **independent roadmap**, including alternative sequencing, smaller PR boundaries, dependencies and acceptance tests.
4. Where the proposed architecture over-engineers; simpler safe alternatives.
5. How existing hotel grid-reader, AI runtime, mail approvals, booking and marketplace modules should be reused.
6. Charter seat/class concurrency model, year-calendar/yield requirements and import edge cases.
7. Hotel static+API rate normalization and cheapest eligible offer algorithm.
8. Static vs dynamic package booking semantics and failure compensation.
9. Email authentication, approval authority, tenant security and agent learning governance.
10. Provider-by-provider integration readiness and evidence-backed protocol/API limitations; identify documentation and partnership prerequisites.
11. Top 10 production blockers, 10x scale risks, and minimal viable deliverable.
12. A side-by-side comparison: **assistant roadmap vs Claude roadmap**, with recommended combined plan and explicit owner decisions.

**Deliver review only.** Do not edit code, migrations, APIs, tests, master spec or deployments; do not merge this PR. Owner will reconcile both plans before authorizing implementation.

## Reference context
Related earlier discussion: PR #54, `docs/architecture/AI_NATIVE_LEAN_OPERATIONS_CLAUDE_REVIEW_2026-11-13.md`. This document expands that discussion to global distribution, charter yield, static/API hotel aggregation, static/dynamic packages and email-directed agent execution.
