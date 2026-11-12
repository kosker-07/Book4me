/** Extract text from a generated PDF without OS packages (pdfjs-dist 4.10.38). */
export async function pdfText(buffer: Buffer | Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, disableFontFace: true }).promise;
  try {
    const pages: string[] = [];
    for (let page = 1; page <= doc.numPages; page++) {
      const content = await (await doc.getPage(page)).getTextContent();
      pages.push(content.items.map(item => "str" in item ? item.str : "").join(" "));
    }
    return pages.join(" ").replace(/\s+/g, " ").trim();
  } finally { await doc.destroy(); }
}
