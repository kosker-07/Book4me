import { ratePlanTermsText } from "./rate-plan-terms";
// BED4BOOK PDF voucher (Technical Specification §4.4).
// Contains: booking number, hotel, stay dates, room/board, guest and operation notes.
// No personal names, phone numbers or titles of company staff appear on the voucher.
import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const FONT_REGULAR = join(__dirname, "assets", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = join(__dirname, "assets", "fonts", "DejaVuSans-Bold.ttf");

export interface VoucherData {
  bookingNo: string;
  status: string;
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
  guestName: string;
  adults: number | null;
  children: number | null;
  childAges: number[] | null;
  nationality: string | null;
  operationNote: string | null;
  agencyName: string;
  issuedAt: Date;
}

const trDate = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };

export function renderVoucher(v: VoucherData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4", margin: 50,
      info: {
        Title: `BED4BOOK Voucher ${v.bookingNo}`,
        Subject: `Accommodation voucher ${v.bookingNo}`,
        Author: "BED4BOOK",
        Keywords: `BED4BOOK voucher ${v.bookingNo}`,
        CreationDate: v.issuedAt
      }
    });
    const chunks: Buffer[] = [];
    doc.on("data", c => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("regular", FONT_REGULAR);
    doc.registerFont("bold", FONT_BOLD);

    const logoPath = resolve(process.cwd(), "web", "assets", "bed4book-logo.png");
    if (existsSync(logoPath)) {
      try { doc.image(logoPath, 50, 50, { width: 150 }); doc.y = 110; }
      catch (error) { console.warn("BED4BOOK PDF logo unavailable:", error); doc.font("bold").fontSize(26).fillColor("#000000").text("BED4BOOK"); }
    } else {
      console.warn("BED4BOOK PDF logo missing:", logoPath);
      doc.font("bold").fontSize(26).fillColor("#000000").text("BED4BOOK");
    }
    doc.font("regular").fontSize(10).text("Hotel Wholesale Platform · www.bed4book.com");
    doc.moveDown(1.5);
    doc.font("bold").fontSize(16).text("Konaklama Voucher'ı / Accommodation Voucher");
    doc.moveDown(0.8);

    const occupancy = v.adults == null ? "—"
      : `${v.adults} yetişkin / adults` + (v.children ? `, ${v.children} çocuk / children (${(v.childAges || []).join(", ")})` : "");
    const rows: [string, string][] = [
      ["Rezervasyon No / Booking No", v.bookingNo],
      ["Durum / Status", v.status === "approved" ? "Onaylandı / Confirmed" : v.status],
      ["Otel / Hotel", v.hotelName],
      ["Konum / Location", v.hotelLocation],
      ["Giriş / Check-in", trDate(v.checkIn)],
      ["Çıkış / Check-out", trDate(v.checkOut)],
      ["Gece / Nights", String(v.nights)],
      ["Oda / Room", `${v.roomName} × ${v.rooms}`],
      ["Pansiyon / Board", v.board],
      ["İptal ve ödeme / Cancellation and payment", ratePlanTermsText(v.cancellationPolicy, v.paymentTerms)],
      ["Misafir / Guest", v.guestName],
      ["Kişi / Occupancy", occupancy],
      ["Oda dağılımı / Per-room occupancy", v.roomOccupancies?.map((r, i) => `Oda ${i + 1}: ${r.adults} yetişkin, ${r.children} çocuk${r.children ? ` (${r.childAges.join(", ")})` : ""}`).join("\n") || "Eski rezervasyon / Legacy booking"],
      ["Uyruk / Nationality", v.nationality || "—"],
      ["Acente / Agency", v.agencyName],
      ["Operasyon notu / Operation notes", v.operationNote || "—"]
    ];
    for (const [label, value] of rows) {
      const y = doc.y;
      doc.font("bold").fontSize(10).text(label, 50, y, { width: 190 });
      const labelBottom = doc.y;
      doc.font("regular").fontSize(10).text(value, 250, y, { width: 295 });
      doc.y = Math.max(labelBottom, doc.y) + 6;
    }

    doc.moveDown(2);
    doc.font("regular").fontSize(8).fillColor("#000000")
      .text(`Düzenlenme / Issued: ${v.issuedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, 50)
      .text("BED4BOOK · www.bed4book.com · founder@bed4book.com");
    doc.end();
  });
}
