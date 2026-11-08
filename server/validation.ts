// Backend validation for search and booking requests (no I/O).
import { isCountryCode } from "./reference";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9 ()-]{6,19}$/;
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

export interface StayRequest { checkIn: string; checkOut: string; rooms: number; adults: number; children: number; childAges: number[]; roomOccupancies: Occupancy[] }

/** Validates dates, room count and occupancy. `today` is injectable for tests. */
export function validateStay(body: any, errors: FieldErrors, today = new Date().toISOString().slice(0, 10)): StayRequest | null {
  const { checkIn, checkOut, rooms, adults, children, childAges, roomOccupancies } = body || {};
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
  let cleanedRooms: Occupancy[] = [];
  if (isInt(rooms, 1, MAX_ROOMS) && (!Array.isArray(roomOccupancies) || roomOccupancies.length !== rooms)) {
    errors.roomOccupancies = "ONE_OCCUPANCY_PER_ROOM";
  } else if (isInt(rooms, 1, MAX_ROOMS)) {
    const validRooms = roomOccupancies.map((room, index) => validateOccupancy(room, errors, `roomOccupancies[${index}].`));
    if (validRooms.every(Boolean)) {
      cleanedRooms = validRooms as Occupancy[];
      const sumAdults = validRooms.reduce((sum, room) => sum + room!.adults, 0);
      const sumChildren = validRooms.reduce((sum, room) => sum + room!.children, 0);
      const ages = validRooms.flatMap(room => room!.childAges).sort((a, b) => a - b);
      if (sumAdults !== adults) errors["roomOccupancies.adults"] = "MUST_MATCH_TOTAL_ADULTS";
      if (sumChildren !== children) errors["roomOccupancies.children"] = "MUST_MATCH_TOTAL_CHILDREN";
      if (!Array.isArray(childAges) || ages.join(",") !== [...childAges].sort((a, b) => a - b).join(","))
        errors["roomOccupancies.childAges"] = "MUST_MATCH_TOTAL_CHILD_AGES";
    }
  }
  return Object.keys(errors).length ? null : { checkIn, checkOut, rooms, adults, children, childAges, roomOccupancies: cleanedRooms };
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
  if (typeof g.nationality !== "string" || !isCountryCode(g.nationality.trim().toUpperCase())) errors["guest.nationality"] = "REQUIRED_ISO_3166_ALPHA2";
  if (!text(body?.operationNote, 2000)) errors.operationNote = "REQUIRED";
  if (Object.keys(errors).length) return null;
  return {
    firstName: g.firstName.trim(), lastName: g.lastName.trim(), email: g.email.trim().toLowerCase(),
    phone: g.phone.trim(), nationality: g.nationality.trim().toUpperCase(), operationNote: body.operationNote.trim()
  };
}

/** Passport nationality of every guest (ISO 3166-1 alpha-2), one entry per family, regardless of adults + children.
 *  Returns null and sets errors when invalid; `missing` is true when the field is absent or empty. */
export function validateNationalities(value: unknown, _guests: number, errors: FieldErrors): { nationalities: string[] | null; missing: boolean } {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return { nationalities: null, missing: true };
  // One nationality represents the entire family, regardless of guest or room count.
  if (!Array.isArray(value) || value.length !== 1) {
    errors.nationalities = "ONE_NATIONALITY_PER_FAMILY";
    return { nationalities: null, missing: false };
  }
  const code = typeof value[0] === "string" ? value[0].trim().toUpperCase() : "";
  if (!isCountryCode(code)) {
    errors.nationalities = "ISO_3166_ALPHA2_REQUIRED";
    return { nationalities: null, missing: false };
  }
  return { nationalities: [code], missing: false };
}

export interface OtherGuest { firstName: string; lastName: string; type: "adult" | "child"; age: number | null; nationality: string }

/** All guests except the lead guest: (adults - 1) adults and one child per age in childAges, each with a name
 *  and an optional passport nationality (not used for pricing eligibility). */
export function validateOtherGuests(value: unknown, occupancy: Occupancy, errors: FieldErrors): OtherGuest[] | null {
  const expected = occupancy.adults - 1 + occupancy.children;
  if (!Array.isArray(value)) {
    if (expected === 0 && value === undefined) return [];
    errors.otherGuests = "REQUIRED_ARRAY"; return null;
  }
  if (value.length !== expected) { errors.otherGuests = `EXPECTED_${expected}_GUESTS`; return null; }
  const out: OtherGuest[] = [];
  value.forEach((g: any, i: number) => {
    const p = `otherGuests[${i}].`;
    if (!text(g?.firstName, 100)) errors[p + "firstName"] = "REQUIRED";
    if (!text(g?.lastName, 100)) errors[p + "lastName"] = "REQUIRED";
    if (g?.type !== "adult" && g?.type !== "child") errors[p + "type"] = "ADULT_OR_CHILD";
    if (g?.type === "child" && !isInt(g?.age, 0, 17)) errors[p + "age"] = "AGE_0_TO_17";
    if (g?.type === "adult" && g?.age !== undefined && g?.age !== null) errors[p + "age"] = "ONLY_FOR_CHILDREN";
    const nat = typeof g?.nationality === "string" ? g.nationality.trim().toUpperCase() : "";
    if (nat && !isCountryCode(nat)) errors[p + "nationality"] = "ISO_3166_ALPHA2_REQUIRED";
    out.push({ firstName: String(g?.firstName ?? "").trim(), lastName: String(g?.lastName ?? "").trim(), type: g?.type,
               age: g?.type === "child" ? g.age : null, nationality: nat });
  });
  if (Object.keys(errors).some(k => k.startsWith("otherGuests"))) return null;
  const adults = out.filter(g => g.type === "adult").length;
  const ages = out.filter(g => g.type === "child").map(g => g.age as number).sort((a, b) => a - b).join(",");
  if (adults !== occupancy.adults - 1 || ages !== [...occupancy.childAges].sort((a, b) => a - b).join(",")) {
    errors.otherGuests = "MUST_MATCH_ADULTS_AND_CHILD_AGES"; return null;
  }
  return out;
}
