# J16 — Tenant ID route inventory

Static inventory from base `claude/clever-thompson-awnwcc` (`e5f085beb8074df12e16373d0a1b9af9c4debf4f`). **Runtime coverage is incremental: the new PostgreSQL sweep currently covers 3 DMC subagency endpoints; the remaining entries below are NOT verified.** Routes with operator-only access, public tokens or non-UUID parameters need role-specific interpretation.

| Method | Route | Source | Runtime foreign/missing result |
|---|---|---|---|
| GET | `/api/admin/hotels/:id` | `server/admin-routes.ts:113` | Pending PG execution |
| PATCH | `/api/admin/hotels/:id` | `server/admin-routes.ts:127` | Pending PG execution |
| POST | `/api/admin/hotels/:id/rooms` | `server/admin-routes.ts:145` | Pending PG execution |
| PATCH | `/api/admin/rooms/:id` | `server/admin-routes.ts:159` | Pending PG execution |
| POST | `/api/admin/rooms/:id/rate-plans` | `server/admin-routes.ts:177` | Pending PG execution |
| PATCH | `/api/admin/rate-plans/:id` | `server/admin-routes.ts:207` | Pending PG execution |
| GET | `/api/admin/rate-plans/:id/calendar` | `server/admin-routes.ts:262` | Pending PG execution |
| PATCH | `/api/admin/publications/:id` | `server/admin-routes.ts:306` | Pending PG execution |
| GET | `/api/admin/agencies/:id` | `server/admin-routes.ts:377` | Pending PG execution |
| GET | `/api/admin/users/:id` | `server/admin-routes.ts:382` | Pending PG execution |
| PATCH | `/api/admin/agencies/:id` | `server/admin-routes.ts:423` | Pending PG execution |
| PATCH | `/api/admin/users/:id` | `server/admin-routes.ts:508` | Pending PG execution |
| GET | `/r/:token` | `server/app.ts:68` | Pending PG execution |
| POST | `/api/agency/bookings/:id/submit` | `server/app.ts:662` | Pending PG execution |
| POST | `/api/dmc/credit-approvals/:id/approve` | `server/app.ts:720` | Pending PG execution |
| POST | `/api/dmc/credit-approvals/:id/reject` | `server/app.ts:754` | Pending PG execution |
| GET | `/api/agency/bookings/:id` | `server/app.ts:829` | Pending PG execution |
| POST | `/api/agency/bookings/:id/cancel` | `server/app.ts:838` | Pending PG execution |
| GET | `/api/backoffice/bookings/:id` | `server/app.ts:875` | Pending PG execution |
| GET | `/api/backoffice/hotels/:id/rooms` | `server/app.ts:898` | Pending PG execution |
| PATCH | `/api/backoffice/bookings/:id/status` | `server/app.ts:923` | Pending PG execution |
| GET | `/api/agency/bookings/:id/voucher` | `server/app.ts:973` | Pending PG execution |
| GET | `/api/backoffice/bookings/:id/voucher` | `server/app.ts:977` | Pending PG execution |
| GET | `/api/agency/bookings/:id/proforma` | `server/app.ts:1058` | Pending PG execution |
| GET | `/api/backoffice/bookings/:id/proforma` | `server/app.ts:1063` | Pending PG execution |
| POST | `/api/backoffice/bookings/:id/proforma/reissue` | `server/app.ts:1068` | Pending PG execution |
| GET | `/api/backoffice/bookings/:id/proformas` | `server/app.ts:1076` | Pending PG execution |
| POST | `/api/contracts/import/:id/confirm` | `server/contract-import-routes.ts:71` | Pending PG execution |
| POST | `/api/admin/hotels/:id/contracts` | `server/contract-routes.ts:43` | Pending PG execution |
| GET | `/api/admin/hotels/:id/contracts` | `server/contract-routes.ts:63` | Pending PG execution |
| GET | `/api/admin/contracts/:id` | `server/contract-routes.ts:73` | Pending PG execution |
| PATCH | `/api/admin/contracts/:id` | `server/contract-routes.ts:83` | Pending PG execution |
| POST | `/api/admin/contracts/:id/rate-plans` | `server/contract-routes.ts:108` | Pending PG execution |
| POST | `/api/admin/contracts/:id/nationality-rules` | `server/contract-routes.ts:135` | Pending PG execution |
| DELETE | `/api/admin/nationality-rules/:id` | `server/contract-routes.ts:156` | Pending PG execution |
| GET | `/api/admin/contracts/:id/eligibility` | `server/contract-routes.ts:168` | Pending PG execution |
| PATCH | `/api/admin/currencies/:code` | `server/contract-routes.ts:219` | Pending PG execution |
| PATCH | `/api/admin/distribution-rules/:id` | `server/distribution-routes.ts:86` | Pending PG execution |
| DELETE | `/api/admin/distribution-rules/:id` | `server/distribution-routes.ts:127` | Pending PG execution |
| GET | `/api/dmc/subagencies/:id` | `server/dmc-routes.ts:19` | PG test added; CI pending (M40 target) |
| PATCH | `/api/dmc/subagencies/:id` | `server/dmc-routes.ts:38` | PG test added; CI pending |
| POST | `/api/webhooks/mail/inbound/:tenantKey` | `server/mail-routes.ts:28` | Pending PG execution |
| GET | `/api/mail/inbox/:id` | `server/mail-routes.ts:58` | Pending PG execution |
| PATCH | `/api/integrations/:id` | `server/report-routes.ts:90` | Pending PG execution |

Total: 44 routes. A tenant test must compare both status and JSON body for existing foreign ID and random missing UUID. For PDF responses compare status and normalized body; successful foreign access is a security failure. No product code modifications permitted.

## Role-gate exclusions (not tenant 404 candidates)

Operator-only `/api/backoffice/*` routes and platform-only administrative routes return `403` to a master/sub-agency before resource lookup; those must be tested under an authorized role with a tenant-owned resource, not falsely treated as a DMC 404 comparison. `/r/:token` is a public bearer-token route, `/api/webhooks/mail/inbound/:tenantKey` is a webhook credential route, and `/api/admin/currencies/:code` is not a tenant-owned UUID route. These are not equivalent to tenant-owned resource IDs.

**Remaining work:** construct fixtures for hotel, room, rate-plan, publication, booking, voucher, proforma, contract, finance and mail IDs, then execute all applicable inventory entries with cross-tenant and sibling-sub-agency tokens. The current 3-case sweep does not satisfy Claude's full 44-route acceptance gate.
