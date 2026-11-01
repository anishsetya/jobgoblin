// Opens PDF bytes with pdf.js (Mozilla's PDF reader), runs one piece of work on the open document, and
// always closes it again. This is the one place that knows how to call pdf.js from Node; readPdf (text and
// page count of a rendered resume) and the tests (PDF metadata) both go through it.
// Spec: "Resume pipeline" (PDF check).
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";

// pdf.js has a "legacy" build that runs on any Node version we support; the main build expects a browser.
// In Node it reads the file on the main thread (its "fake worker"), which is fine for one-page resumes.
//
// Inside the desktop app the server runs in an Electron utility process, where process.type is "utility".
// pdf.js then decides it is NOT in Node and refuses to start without a worker file, so every PDF failed
// to open. Naming the worker file works in both places: Node ignores it, Electron loads it as the fake worker.
GlobalWorkerOptions.workerSrc = import.meta.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");

export async function withOpenPdf<T>(
  bytes: Uint8Array,
  useDocument: (document: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  const loadingTask = getDocument({
    // pdf.js takes ownership of the array it is given, so hand it a copy and keep the caller's bytes intact.
    data: Uint8Array.from(bytes),
    // Errors only: the default also prints a warning for every PDF feature this text-only use ignores.
    // (Older pdf.js versions had an `isEvalSupported` switch to stop crafted fonts from running generated
    // code. Version 6 no longer generates code at all, so a crafted upload has nothing to trigger.)
    verbosity: 0,
  });

  try {
    return await useDocument(await loadingTask.promise);
  } finally {
    await loadingTask.destroy();
  }
}
