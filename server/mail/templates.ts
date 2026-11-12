// E-mail templates. They accept only whitelisted, customer-safe fields. Net price, margin, platform fee and
// DMC / supplier identity must never reach an e-mail; keys that look like them are rejected outright.
import type { Rendered } from "./outbox";

const FORBIDDEN_KEY = /(^|_|\b)(net|margin|markup|fee|platform|supplier|dmc|cost|commission)(_|\b|$)/i;

export function assertSafeTemplateData(data: unknown, path = "data"): void {
  if (data === null || typeof data !== "object") return;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key.replace(/([a-z])([A-Z])/g, "$1_$2"))) throw new Error(`FORBIDDEN_MAIL_FIELD:${path}.${key}`);
    assertSafeTemplateData(value, `${path}.${key}`);
  }
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const wrap = (title: string, lines: string[]) => ({
  html: `<div style="font-family:Arial,sans-serif;max-width:560px"><h2>${esc(title)}</h2>${lines.map(l => `<p>${esc(l)}</p>`).join("")}<p style="color:#666">BED4BOOK</p></div>`,
  text: `${title}\n\n${lines.join("\n")}\n\nBED4BOOK`
});

export interface BookingMailData { reference: string; guestName: string; hotelName: string; checkIn: string; checkOut: string; total: string; currency: string }

export function bookingConfirmation(data: BookingMailData): Rendered {
  assertSafeTemplateData(data);
  const lines = [`Dear ${data.guestName},`, `Your booking ${data.reference} at ${data.hotelName} is confirmed.`, `Stay: ${data.checkIn} to ${data.checkOut}.`, `Total: ${data.total} ${data.currency}.`];
  return { subject: `Booking confirmation ${data.reference}`, ...wrap("Booking confirmation", lines) };
}

export function voucherReady(data: { reference: string; guestName: string; hotelName: string }): Rendered {
  assertSafeTemplateData(data);
  return { subject: `Voucher ${data.reference}`, ...wrap("Your voucher is ready", [`Dear ${data.guestName},`, `The voucher for booking ${data.reference} at ${data.hotelName} is ready in your account.`]) };
}

export function paymentReminder(data: { reference: string; amountDue: string; currency: string; dueDate: string }): Rendered {
  assertSafeTemplateData(data);
  return { subject: `Payment reminder ${data.reference}`, ...wrap("Payment reminder", [`Booking ${data.reference} has ${data.amountDue} ${data.currency} due by ${data.dueDate}.`]) };
}

export function contractExpiry(data: { contractNumber: string; endDate: string }): Rendered {
  assertSafeTemplateData(data);
  return { subject: `Contract ${data.contractNumber} ends on ${data.endDate}`, ...wrap("Contract expiry", [`Contract ${data.contractNumber} ends on ${data.endDate}. Please review it before then.`]) };
}
