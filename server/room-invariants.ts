/** Pure validation for room capacity and allotment inputs. */
export function validateRoomCapacity(maxAdults: number, maxChildren: number): void {
  if (!Number.isInteger(maxAdults) || maxAdults < 1 || maxAdults > 10) throw new Error("INVALID_ADULT_CAPACITY");
  if (!Number.isInteger(maxChildren) || maxChildren < 0 || maxChildren > 10) throw new Error("INVALID_CHILD_CAPACITY");
}
export function validateAllotment(available: number, booked: number): void {
  if (!Number.isSafeInteger(available) || available < 0) throw new Error("INVALID_ALLOTMENT");
  if (!Number.isSafeInteger(booked) || booked < 0 || booked > available) throw new Error("ALLOTMENT_CONFLICT");
}
