# BED4BOOK v1.0 — Implementation Plan and Initial Server Foundation

## Source of truth
- `docs/BED4BOOK_Teknik_Sartname.md`
- `docs/BED4BOOK_Proje_Sartnamesi.md`

## Existing-repository findings
- The current product is built as a browser-delivered single HTML bundle (`tools/build.js`).
- `src/core/store.js` currently provides MemoryAdapter and LocalAdapter. Its ServerAdapter is explicitly a non-working stub.
- Current domain logic and UI are broad and should be preserved during migration, but browser persistence is not an acceptable production system of record.
- The repository does not yet have a Node.js/TypeScript server package or PostgreSQL migration set on main.
- Existing authentication and tenant filtering are implemented in the browser bundle and are not a substitute for server-enforced authorization.
- The repository contains multiple later-phase capabilities. The supplied v1.0 PDFs, not those legacy feature lists, define the first commercial release.

## This branch's first milestone
- Add a TypeScript / Node.js API foundation.
- Add PostgreSQL schema for agencies, users, hotels, rooms, board/rate plans, daily prices/allotment, agency-specific publication, bookings, status history, audit and idempotency.
- Add password hashing and signed short-lived bearer sessions.
- Add initial role-gated API routes for login, agency-scoped hotel listing, booking creation, Back Office booking queue and status updates.
- Keep the existing browser application and legacy modules intact while the server foundation is tested.

## Not yet complete
- No UI has been switched to the server API.
- No production database has been provisioned or migrated.
- No PDF voucher generation endpoint is implemented yet.
- Room/rate/inventory creation and selective publication endpoints still need to be completed.
- Inventory release on rejection/cancellation and full booking lifecycle transitions need completion and tests.
- Agency-level row security and object-level authorization need further hardening and penetration tests.
- Backups, restore drills, HTTPS termination, SMTP, object storage, deployment and monitoring require infrastructure configuration.
- The existing full `node tests/unit.js` suite requires its external handoff fixture directory and has not been established as passing in this branch.

## Acceptance rule
This foundation is not a production release. Do not deploy or expose it publicly until the remaining items and the v1.0 acceptance gates have been completed and independently reviewed.
