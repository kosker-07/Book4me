# BED4BOOK v1 — Owner-approved technical decisions

**Decision date:** 7 November 2026  
**Status:** Approved by project owner; binding for v1 implementation.

## D1. Agency pricing model — Option A

- `inventory_daily.price` is the net nightly price.
- Each agency has one markup policy: percentage (`percent`) or fixed amount (`fixed`).
- The sell price is calculated from the net nightly price and the target sub-agency's markup policy.
- Booking totals must be calculated from each booked night, room count and the resolved sell price; do not multiply one static sales price by the stay length.
- Other agencies' markup settings and calculated prices must never be exposed to a sub-agency.

## D2. Cancellation authority

- A sub-agency may cancel only its own booking while its status is `pending`.
- A booking in `approved` status may be cancelled only by Back Office or a system administrator.
- Sub-agencies cannot cancel approved bookings.
- A booking in any other status cannot be cancelled through these permissions.
- Every allowed cancellation must be transactional, release the booked nightly inventory exactly once, and create status-history and audit records.

## D3. Back Office scope — Option B

- Back Office users operate across the whole platform, not only the hotels owned by their associated master agency.
- System administrators retain platform-wide administrative authority.
- The API must enforce this scope server-side; hiding records in the browser is not an authorization control.

## D4. Required guest data

The booking request must require all of the following:
- Guest first name
- Guest last name
- Adult count
- Child count
- Child ages (exactly one age per child; empty array when child count is zero)
- Email
- Phone
- Nationality
- Operational note

The backend must validate these fields before starting reservation writes. Store only the information required for booking operations and apply access controls to guest data.

## Implementation notes

- Migration `002_booking_pricing_and_integrity.sql` adds the agency markup fields, per-night booking snapshots, guest columns and database integrity guards.
- Existing migration `001_initial.sql` is immutable.
- These decisions do not authorize supplier API/XML, payments/POS, e-invoice/accounting, mobile applications, Rebooking or RateRelay work.
