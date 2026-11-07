// Backend validation for search and booking requests (no I/O).

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9 ()-]{6,19}$/;
const NATIONALITY_RE = /^[A-Z]{2}$/; // ISO 3166-1 alpha-2
const MAX_ROOMS = 10, MAX_NIGHTS = 60, MAX_PER_ROOM = 10;

export type FieldErrors = Record<string, string>;

/** Real calendar date in YYYY-MM-DD (rejects 2027-02-30, 2027-13-01). */
export function isCalendarDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function nightsBetween(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(checkIn + "T00:00:00Z"); t < Date.parse(checkOut + "T00:00:00Z"); t += 86400000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;

export interface StayRequest { checkIn: string; checkOut: string; rooms: number; adults: number; children: number; childAges: number[] }

/** Validates dates, room count and occupancy. `today` is injectable for tests. */
export function validateStay(body: any, errors: FieldErrors, today = new Date().toISOString().slice(0, 10)): StayRequest | null {
  const { checkIn, checkOut, rooms, adults, children, childAges } = body || {};
  if (!isCalendarDate(checkIn)) errors.checkIn = "REQUIRED_VALID_DATE";
  else if (checkIn < today) errors.checkIn = "MUST_NOT_BE_IN_PAST";
  if (!isCalendarDate(checkOut)) errors.checkOut = "REQUIRED_VALID_DATE";
  if (isCalendarDate(checkIn) && isCalendarDate(checkOut)) {
    const n = nightsBetween(checkIn, checkOut).length;
    if (n < 1 || n > MAX_NIGHTS) errors.checkOut = "STAY_MUST_BE_1_TO_60_NIGHTS";
  }
  if (!isInt(rooms, 1, MAX_ROOMS)) errors.rooms = "INTEGER_1_TO_10";
  validateOccupancy({ adults, children, childAges }, errors);
  if (!errors.adults && isInt(rooms, 1, MAX_ROOMS) && adults < rooms) errors.adults = "AT_LEAST_ONE_ADULT_PER_ROOM";
  return Object.keys(errors).length ? null : { checkIn, checkOut, rooms, adults, children, childAges };
}

export interface Occupancy { adults: number; children: number; childAges: number[] }

/** Adults (>= 1), children (>= 0) and one age (0-17) per child. Error keys are prefixed, e.g. "guest.adults". */
export function validateOccupancy(src: any, errors: FieldErrors, prefix = ""): Occupancy | null {
  const { adults, children, childAges } = src || {};
  const before = Object.keys(errors).length;
  if (!isInt(adults, 1, MAX_ROOMS * MAX_PER_ROOM)) errors[prefix + "adults"] = "INTEGER_AT_LEAST_1";
  if (!isInt(children, 0, MAX_ROOMS * MAX_PER_ROOM)) errors[prefix + "children"] = "INTEGER_AT_LEAST_0";
  if (!Array.isArray(childAges) || !childAges.every(a => isInt(a, 0, 17))) errors[prefix + "childAges"] = "ARRAY_OF_AGES_0_TO_17";
  else if (isInt(children, 0, MAX_ROOMS * MAX_PER_ROOM) && childAges.length !== children) errors[prefix + "childAges"] = "LENGTH_MUST_EQUAL_CHILDREN";
  return Object.keys(errors).length > before ? null : { adults, children, childAges };
}

export interface GuestDetails {
  firstName: string; lastName: string; email: string; phone: string; nationality: string; operationNote: string;
}

/** All nine guest fields are mandatory: name, surname, adults, children, child ages (in validateStay), e-mail, phone, nationality, operation note. */
export function validateGuest(body: any, errors: FieldErrors): GuestDetails | null {
  const g = body?.guest || {};
  if (!text(g.firstName, 100)) errors["guest.firstName"] = "REQUIRED";
  if (!text(g.lastName, 100)) errors["guest.lastName"] = "REQUIRED";
  if (typeof g.email !== "string" || g.email.length > 254 || !EMAIL_RE.test(g.email.trim())) errors["guest.email"] = "REQUIRED_VALID_EMAIL";
  if (typeof g.phone !== "string" || !PHONE_RE.test(g.phone.trim())) errors["guest.phone"] = "REQUIRED_VALID_PHONE";
  if (typeof g.nationality !== "string" || !NATIONALITY_RE.test(g.nationality.trim().toUpperCase())) errors["guest.nationality"] = "REQUIRED_ISO_3166_ALPHA2";
  if (!text(body?.operationNote, 2000)) errors.operationNote = "REQUIRED";
  if (Object.keys(errors).length) return null;
  return {
    firstName: g.firstName.trim(), lastName: g.lastName.trim(), email: g.email.trim().toLowerCase(),
    phone: g.phone.trim(), nationality: g.nationality.trim().toUpperCase(), operationNote: body.operationNote.trim()
  };
}
