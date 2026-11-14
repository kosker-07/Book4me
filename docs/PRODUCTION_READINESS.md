# BED4BOOK — Production Readiness Runbook (J24)

**Status:** Draft for Claude review. **This document does not authorize environment creation, DNS changes or deployment.** Source reference: `claude/clever-thompson-awnwcc`; Phase 1 acceptance: [Issue #59](https://github.com/kosker-07/Book4me/issues/59).

## 1. Environment architecture
- Create a **separate Railway production environment** only after explicit owner authorization. Use a **separate PostgreSQL instance and volume**; never share staging database credentials, volume, mail webhook, AI keys or session secret.
- Staging: `BED4BOOK / staging / bed4book-api`, disposable test data, validation domain `agent.bed4book.com` (current intended staging). Production: isolated secrets, backups, least-privilege access, monitored deployment, own service domain. Do not point `agent.bed4book.com` to production before the cutover approval and verified rollback route.
- Keep corporate website entirely separate. Never run destructive PG integration tests against staging or production.

## 2. Environment variable inventory — **names and purposes only; no values**
Source scan of `server/` (including AI, mail, CLI) identified the following direct `process.env` names. Check any additional `infra/` and workflow references at implementation review.

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection | Required; production DB only |
| `DATABASE_SSL` | PG TLS configuration | Validate for hosting topology |
| `DB_POOL_MAX` | PostgreSQL pool size | Code uses this name, **not** `PGPOOL_MAX` |
| `SESSION_SECRET` | Session signing | Required, unique per environment |
| `NODE_ENV` | Runtime mode | production |
| `PORT` | HTTP listening port | Railway-provided |
| `TRUST_PROXY` | Reverse-proxy trust | Verify with actual proxy topology |
| `ADMIN_EMAIL` | Initial admin bootstrap | Controlled initialization |
| `ADMIN_PASSWORD` | Initial admin bootstrap | Sensitive; do not log |
| `MAIL_SECRET_KEY` | Encrypted mail credentials | Required for encrypted mail settings |
| `RESEND_API_KEY` | Resend outbound/inbound provider API | Optional only if mail features disabled |
| `RESEND_WEBHOOK_SECRET` | Inbound webhook signature verification | Required when inbound webhook enabled |
| `MAIL_FROM_ADDRESS` | Outbound sender | Verify domain |
| `MAIL_WORKER` | Mail queue worker enablement | Configure only after readiness |
| `PUBLIC_BASE_URL` | Absolute URLs in reminders | Must match authorized public domain |
| `REMINDER_WORKER` | Booking reminder worker | Controlled worker startup |
| `FX_MAX_AGE_HOURS` | FX freshness threshold | Establish business policy |
| `AI_WORKER` | AI background worker enablement | Budget and approval controls required |
| `ANTHROPIC_API_KEY` | AI model access | Optional until AI capability enabled; secret |

**Requested planning names requiring source validation:** `AI_CENTER_URL`, `OWNER_EMAIL`, `PGPOOL_MAX`. These were not found as direct `process.env` references in the reviewed server modules; do **not** set them assuming they are supported. `DB_POOL_MAX` is the actual pool configuration key. Review indirect environment readers and deployment configuration before declaring the inventory exhaustive.

## 3. Backups and restore drill
1. Enable daily PostgreSQL backups or verified `pg_dump` automation with independent storage. Proposed retention: **30 daily backups + 12 monthly backups**, subject to owner approval and storage/security requirements. Encrypt at rest and restrict restore access.
2. Record timestamp, DB version, checksum, backup size and success alert; monitor failures daily.
3. Weekly disposable-DB restore drill: provision isolated PG16-compatible test DB, restore the latest backup, validate checksum, run migration/status check and read-only integrity queries, verify ledger balancing and representative booking/agency counts. Never overwrite staging/production.
4. Reference the existing GitHub Actions **backup/restore drill** job/step and its logs for executable command details; do not invent command flags. Preserve a dated drill artifact, measured RTO/RPO and approval record.
5. Before any migration, take and verify a fresh restore point; document the restore owner and rollback decision.

## 4. AI operations
- Store `ANTHROPIC_API_KEY` in Railway secret management; rotate on exposure, isolate staging/production.
- Set and enforce **per-agent/per-run token budgets**, daily aggregate token ceiling and monetary spending cap before production. Thresholds require owner sign-off; alert at 70/90/100%, halt new nonessential runs at the cap.
- Missing key: core deterministic search, booking, pricing, inventory and ledger must continue; AI-dependent requests return an explicit unavailable/error status and never silently approve or mutate commercial records. Verify actual behavior in tests.
- Audit every AI run, approval, rejection, cost and tenant scope. No seller identity, net price, margin or platform fee in AI prompts.

## 5. Release and rollback
1. Confirm exact merged SHA, full applicable CI (server, mutation, web; zero skipped tests), Phase 1 sign-off and migration review.
2. Schedule maintenance window with owner; announce possible read-only/booking freeze if schema or data migration requires it. Verify backup restore point.
3. Deploy to isolated production environment; inspect migration output, startup, `/ready`, logs, metrics and smoke test; watch for **at least five minutes** with no crash/restart.
4. On failure, stop traffic cutover, rollback to last successful Railway deployment, and if migration is incompatible follow **tested database restore/forward-fix** procedure; application rollback alone may not revert schema.
5. DNS cutover: verify production URL and TLS first, then change `agent.bed4book.com` only with explicit owner approval; use planned TTL and monitor propagation. Rollback DNS to known-good target if necessary. Never alter corporate DNS.
6. Record SHA, deployment ID, migration version, /ready, smoke results, DNS time, incident/rollback and owner approval.

## 6. Mandatory pre-live gates
- [ ] Issue [#59](https://github.com/kosker-07/Book4me/issues/59) full Phase 1 definition met: tenant access, DMC users, hotel/room/contract/manual import, price/distribution, search/booking/voucher/proforma/cancel/finance, **existing AI Center**, session, audit and security.
- [ ] Zero unresolved P0; documented owner acceptance of P1 exceptions.
- [ ] J11a [PR #70](https://github.com/kosker-07/Book4me/pull/70) real PG end-to-end API test green, including buyer secrecy and inventory release exactly once.
- [ ] Tenant 404 sweep J16, finance tenant J8a and M37–M40 mutation evidence reviewed.
- [ ] 100 concurrent requests against five allotments: no oversell, stable price snapshot.
- [ ] Backup and restore drill successful; credentials/rotation, monitoring, alerting and rollback rehearsed.
- [ ] Separate production DB, outbound email configuration, AI budget, health checks and domain ownership approved.

## 7. Proforma issuer identity
Proforma must show the authorized **BED4BOOK issuing legal entity** (registered company name, registered address, tax office, tax number and any required contact fields), never the hidden supplier DMC. Review existing proforma generator (`server/proforma.ts`), issuance routes (`server/app.ts`) and underlying settings/configuration to identify the **actual entry point** before go-live. **Do not assume a settings UI exists.** If issuer data is missing, block release of legally incomplete proformas until a verified issuer configuration and validation flow exist. Check actual current fallback behavior in a disposable test environment; this is an open verification item, not a claim that the system currently blocks generation.

## 8. Current staging evidence (read-only snapshot, 14 Nov 2026)
Railway project `BED4BOOK`, staging services `bed4book-api` and `Postgres`. PG volume `postgres-volume`: provisioned 5,000 MB; sampled disk usage ~0.180 GB. Staging API variable inventory lacks `ANTHROPIC_API_KEY`, `AI_WORKER`, `MAIL_WORKER`, `RESEND_WEBHOOK_SECRET`, `MAIL_FROM_ADDRESS`, `PUBLIC_BASE_URL`, `REMINDER_WORKER`, `DB_POOL_MAX` (defaults may apply). These are observations, **not instructions to set variables**. Backup enablement and exact PostgreSQL version require further verification.
