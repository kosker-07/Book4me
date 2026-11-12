import type { PoolClient } from "pg";
import { audit } from "./http";

// ---------------------------------------------------------------------------------------------
// Booking state changes. No SELECT ... FOR UPDATE: each transition is one conditional UPDATE that
// succeeds only from the expected status, so a booking can be released at most once.
// ---------------------------------------------------------------------------------------------
export const CONSUMES_INVENTORY = new Set(["pending", "approved"]);
export const RELEASING = new Set(["rejected", "cancelled"]);

/** Returns allotment of a booking that consumed inventory. Uses the nightly snapshot; bookings created
 *  before migration 002 have no snapshot and are released from their date range. */
export async function releaseInventory(client: PoolClient, bookingId: string) {
  await client.query(
    `UPDATE inventory_daily d SET reserved = d.reserved - n.rooms
       FROM booking_nights n WHERE n.booking_id = $1 AND d.id = n.inventory_id`, [bookingId]);
  await client.query(
    `UPDATE inventory_daily d SET reserved = d.reserved - b.room_count
       FROM bookings b
      WHERE b.id = $1 AND d.rate_plan_id = b.rate_plan_id AND d.stay_date >= b.check_in AND d.stay_date < b.check_out
        AND NOT EXISTS (SELECT 1 FROM booking_nights n WHERE n.booking_id = b.id)`, [bookingId]);
}

/** Tries each allowed source status with a conditional UPDATE. The scope limits which bookings the actor may touch. */
export async function transition(client: PoolClient, opts: {
  bookingId: string; to: string; from: string[]; scopeSql: string; scopeParams: unknown[]; actorId: string; note: string;
}) {
  for (const from of opts.from) {
    const updated = await client.query(
      `UPDATE bookings b SET status = $2, updated_at = now()
        WHERE b.id = $1 AND b.status = $3 AND ${opts.scopeSql}
      RETURNING b.agency_id`,
      [opts.bookingId, opts.to, from, ...opts.scopeParams]);
    if (updated.rowCount === 1) {
      if (RELEASING.has(opts.to) && CONSUMES_INVENTORY.has(from)) await releaseInventory(client, opts.bookingId);
      await client.query("INSERT INTO booking_status_history(booking_id,from_status,to_status,actor_id,note) VALUES ($1,$2,$3,$4,$5)",
        [opts.bookingId, from, opts.to, opts.actorId, opts.note]);
      await audit(client, opts.actorId, updated.rows[0].agency_id, `booking.${opts.to}`, "booking", opts.bookingId,
        { targetAgencyId: updated.rows[0].agency_id, before: { status: from }, after: { status: opts.to } });
      return from;
    }
  }
  return null;
}

