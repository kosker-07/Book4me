import { ratePlanTermsText } from "./rate-plan-terms";
// Proforma PDF. Informational pre-payment document — NOT a tax invoice or e-invoice.
// Amounts come only from the booking's immutable price snapshot; nothing is re-priced or re-converted.
import PDFDocument from "pdfkit";
import { join } from "node:path";

const FONT_REGULAR = join(__dirname, "assets", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = join(__dirname, "assets", "fonts", "DejaVuSans-Bold.ttf");

export interface ProformaData {
  number: string;
  version: number;
  supersedesNumber: string | null;
  issuedAt: Date;
  sellerLegalName: string;
  bookingNo: string;
  bookingStatus: string;
  agencyName: string;
  hotelName: string;
  hotelLocation: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  roomName: string;
  board: string;
  rooms: number;
  roomOccupancies: { adults: number; children: number; childAges: number[] }[] | null;
  cancellationPolicy?: unknown;
  paymentTerms?: unknown;
  guests: { name: string; type: string; age: number | null; nationality: string }[];
  contractCode: string;
  contractCurrency: string;
  contractAmount: string;
  paymentCurrency: string;
  paymentAmount: string;
  /** Present when the payment currency differs from the contract currency. */
  fx: { contractEurPerUnit: string; paymentEurPerUnit: string; source: string | null; validAt: string | null } | null;
}

const trDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}.${m}.${y}`; };
const STATUS_TR: Record<string, string> = { pending: "Beklemede / Pending", approved: "Onaylandı / Confirmed" };

export function renderProforma(p: ProformaData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4", margin: 50,
      info: { Title: `BED4BOOK Proforma ${p.number}`, Subject: `Proforma ${p.number} for booking ${p.bookingNo}`,
              Author: "BED4BOOK", Keywords: `BED4BOOK proforma ${p.number} ${p.bookingNo}`, CreationDate: p.issuedAt }
    });
    const chunks: Buffer[] = [];
    doc.on("data", c => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("regular", FONT_REGULAR);
    doc.registerFont("bold", FONT_BOLD);

    doc.font("bold").fontSize(26).fillColor("#000000").text("BED4BOOK");
    doc.font("regular").fontSize(10).text("Hotel Wholesale Platform · www.bed4book.com");
    doc.moveDown(1.2);
    doc.font("bold").fontSize(16).text("PROFORMA");
    doc.font("bold").fontSize(10).text("Vergi faturası değildir / Not a tax invoice");
    doc.moveDown(0.8);

    const rows: [string, string][] = [
      ["Proforma No", `${p.number}${p.version > 1 ? `  (sürüm / version ${p.version}${p.supersedesNumber ? `, ${p.supersedesNumber} yerine / replaces ${p.supersedesNumber}` : ""})` : ""}`],
      ["Düzenlenme / Issued", `${trDate(p.issuedAt.toISOString())} ${p.issuedAt.toISOString().slice(11, 16)} UTC`],
      ["Satıcı / Seller", p.sellerLegalName],
      ["Acente / Agency", p.agencyName],
      ["Rezervasyon No / Booking No", p.bookingNo],
      ["Durum / Status", STATUS_TR[p.bookingStatus] ?? p.bookingStatus],
      ["Otel / Hotel", `${p.hotelName}, ${p.hotelLocation}`],
      ["Konaklama / Stay", `${trDate(p.checkIn)} – ${trDate(p.checkOut)} (${p.nights} gece / nights)`],
      ["Oda / Room", `${p.roomName} × ${p.rooms} · ${p.board}`],
      ["Kontrat / Contract", p.contractCode],
      ["İptal ve ödeme / Cancellation and payment", ratePlanTermsText(p.cancellationPolicy, p.paymentTerms)],
      ["Oda dağılımı / Per-room occupancy", p.roomOccupancies?.map((r, i) => `Oda ${i + 1}: ${r.adults} yetişkin, ${r.children} çocuk${r.children ? ` (${r.childAges.join(", ")})` : ""}`).join("\n") || "Eski rezervasyon / Legacy booking"],
      ["Misafirler / Guests", p.guests.map(g => `${g.name} (${g.type === "child" ? `çocuk/child ${g.age}` : "yetişkin/adult"}, ${g.nationality})`).join("\n")],
      ["Kontrat tutarı / Contract amount", `${p.contractAmount} ${p.contractCurrency}`],
      ["Ödenecek tutar / Amount payable", `${p.paymentAmount} ${p.paymentCurrency}`]
    ];
    if (p.fx) rows.push(["Kur / Exchange rate",
      [p.contractCurrency !== "EUR" ? `1 ${p.contractCurrency} = ${p.fx.contractEurPerUnit} EUR` : null,
       p.paymentCurrency !== "EUR" ? `1 ${p.paymentCurrency} = ${p.fx.paymentEurPerUnit} EUR` : null].filter(Boolean).join("; ") +
      `${p.fx.source ? ` · ${p.fx.source}` : ""}${p.fx.validAt ? ` · ${trDate(p.fx.validAt)}` : ""} · yuvarlama / rounding: half-up`]);
    for (const [label, value] of rows) {
      const y = doc.y;
      doc.font("bold").fontSize(10).text(label, 50, y, { width: 190 });
      const labelBottom = doc.y;
      doc.font("regular").fontSize(10).text(value, 250, y, { width: 295 });
      doc.y = Math.max(labelBottom, doc.y) + 6;
    }
    doc.moveDown(2);
    doc.font("regular").fontSize(8)
      .text("Bu belge ödeme öncesi bilgilendirme amaçlıdır; vergi faturası veya e-fatura değildir. Tutarlar rezervasyon anında dondurulmuş fiyat ve kurlara dayanır.", 50)
      .text("This document is for information before payment; it is not a tax invoice or e-invoice. Amounts are based on the price and exchange rates frozen at booking.")
      .text("BED4BOOK · www.bed4book.com · founder@bed4book.com");
    doc.end();
  });
}
