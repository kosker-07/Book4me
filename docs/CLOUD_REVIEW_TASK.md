# Cloud Review Task — BED4BOOK First Commercial Release
Date: 2026-11-07
Repository: kosker-07/Book4me

## Mandatory: read the authoritative specifications first

Before reviewing or changing code, read these two project-owner source documents in full:

1. `docs/BED4BOOK_Teknik_Sartname.md` — authoritative technical specification v1.0.
2. `docs/BED4BOOK_Proje_Sartnamesi.md` — project scope, modules, roles, user journeys, delivery plan and go-live gates v1.0.

These Markdown files are faithful transfers of the two PDFs supplied by the project owner on 2026-11-07. They take precedence over earlier implementation handoffs or assumptions wherever scope differs.

Also read:
- `docs/BED4BOOK_Core_Implementation_Handoff.md`
- `src/domain/search.js`
- `src/domain/booking.js`
- `src/domain/seed.js`
- `src/updates/u0030-bed4book-core.js`
- `tests/unit.js`
- `tests/bed4book.js`
- `tools/build.js` and `tools/load.js`

## Critical scope correction

The v1.0 PDFs define the first commercial release as a **browser-based B2B hotel wholesale platform with manually entered hotel inventory and sub-agency sales**.

The required first-release modules are:
- Responsive public web area and sign-in entry points.
- Administrator / hotel content management.
- Sub-agency panel with agency-scoped hotel search, pricing and booking.
- Back Office reservation queue, detail, approval/rejection/cancellation, history and operations notes.
- BED4BOOK-branded PDF voucher for approved bookings.
- User authentication, role authorization, agency-level data isolation, password security, audit logging, backups and restore.

**Rebooking and RateRelay are not listed as first-release deliverables in either v1.0 PDF.** Treat the existing `u0030-bed4book-core.js` implementation as an unapproved-for-v1 / separate-scope item pending explicit project-owner scope decision. Do not integrate it into the first-release user journeys or claim it satisfies the supplied specifications. Do not delete it; report its scope status and dependencies.

Supplier API/XML integrations (including Hotelbeds, Expedia and Juniper), bank APIs, virtual POS, e-invoice, accounting integrations, mobile apps and advanced automation are explicitly out of first-release scope and require a separate phase, technical document and approval.

## Required review work

1. Produce a traceability matrix mapping every requirement in both authoritative documents to repository files and implementation status: Implemented / Partial / Missing / Not verifiable.
2. Inspect actual repository architecture and determine whether the recommended Node.js + TypeScript API and PostgreSQL architecture is present. The PDFs explicitly say technology selection must be finalized only after inspecting the actual ZIP/source and tests; do not assume it is already implemented.
3. Verify all four roles and backend-enforced role + agency scope restrictions.
4. Verify hotel, room, board, images, descriptions, amenities, operational notes, date-based price, allotment, sales conditions, and draft/active/inactive states.
5. Verify selective hotel or hotel-price publication to sub-agencies and isolation of agency-specific prices/conditions.
6. Verify the booking workflow: availability/allotment check, guest details, booking creation, Back Office queue, authorized approval/rejection, status history, and PDF voucher.
7. Verify concurrent booking requests cannot oversell allotment or create duplicate reservations.
8. Verify password hashing, HTTPS assumptions/configuration, audit logs, secret handling, daily backups and restore test. Clearly distinguish code evidence from infrastructure tasks that cannot be verified in this repository.
9. Run available test commands and record exact output:
   - `node tests/unit.js`
   - `node tests/bed4book.js` (diagnostic only; not proof of v1 scope compliance)
   - `node tools/build.js`
10. Add missing negative-path and tenant-isolation tests where appropriate, but do not silently broaden the agreed product scope.
11. Record findings in `docs/reviews/` as a dated Markdown report with requirement ID, status, evidence (file/line), severity, test command/output and recommended next action.

## Change-control and safety

- This review task does not itself authorize live-server changes, deployment, DNS changes, production data changes, or purchases.
- Do not make critical scope or architectural decisions on behalf of the project owner.
- Do not add supplier integrations, payments, mobile apps, Rebooking, RateRelay, or other later-phase features to v1 without explicit approval.
- Do not replace the legacy `B4M.rb` module without a documented migration and regression tests.
- Never commit secrets, credentials, API keys or personal contact details.
- Preserve existing commit history. Make any approved code fixes in clear, separate commits.
- A passing unit test or build alone does not establish acceptance or production readiness.

## Required response

Return:
1. A concise executive summary.
2. The full v1.0 requirement traceability matrix.
3. Test commands and exact pass/fail results.
4. Critical/high/medium/low defects with file and line references.
5. Infrastructure items that remain unverified.
6. A prioritized implementation plan.
7. A clear list of any decisions that require project-owner approval.

Do not infer missing requirements. If a point is not stated in the source documents, mark it as unspecified/open.
