// Reads a PDF back: how many pages it has and the text on them. The server uses it right after a
// render to check "exactly one page" and to search the printed text for banned terms, and the setup
// run uses it (through extractResumeText) to read a resume the person uploads.
// Spec: "Resume pipeline" (PDF check); ARCHITECTURE.md section 8.1.
import type { PDFPageProxy } from "pdfjs-dist";
import { withOpenPdf } from "./withOpenPdf";

export type PdfContents = { pages: number; text: string };

// Text comes out line by line (a newline wherever pdf.js saw a line end), pages separated by a blank line.
export async function readPdf(bytes: Uint8Array): Promise<PdfContents> {
  return withOpenPdf(bytes, async (document) => {
    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      pageTexts.push(await readPageText(page));
    }
    return { pages: document.numPages, text: pageTexts.join("\n\n").trim() };
  });
}

async function readPageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  let text = "";
  for (const item of content.items) {
    // Items are either text runs or marked-content markers (structure tags); only runs carry text.
    if (!("str" in item)) continue;
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return text;
}
