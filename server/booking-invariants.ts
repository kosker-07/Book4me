/** Booking lifecycle checks, independent from persistence. */
export type BookingState = "draft" | "submitted" | "confirmed" | "cancelled";
const allowed: Record<BookingState, readonly BookingState[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["confirmed", "cancelled"],
  confirmed: ["cancelled"],
  cancelled: []
};
export function assertBookingTransition(from: BookingState, to: BookingState): void {
  if (!allowed[from]?.includes(to)) throw new Error("INVALID_BOOKING_TRANSITION");
}
export function assertIdempotencyKey(key: string): void {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new Error("INVALID_IDEMPOTENCY_KEY");
}
