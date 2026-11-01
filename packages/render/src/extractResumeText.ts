// Gets the plain text out of a resume the person uploads, so the setup run can read it.
// PDFs go through pdf.js (readPdf) and Word files through mammoth; the file type comes from the file
// name. A scanned or photographed resume has no text layer and comes back as an empty string: the
// caller should check for that and ask for a different file.
// Spec: S3 "import a resume"; ARCHITECTURE.md section 8.1.
import path from "node:path";
import mammoth from "mammoth";
import { readPdf } from "./readPdf";
import { ResumeFileError } from "./resumeFileError";

export async function extractResumeText(bytes: Uint8Array, fileName: string): Promise<string> {
  const extension = path.extname(fileName).toLowerCase();

  if (extension === ".pdf") return extractFromPdf(bytes, fileName);
  if (extension === ".docx") return extractFromWord(bytes, fileName);
  if (extension === ".doc") {
    throw new ResumeFileError(
      "unsupported-type",
      `"${fileName}" is an old Word file (.doc). Save it as .docx or PDF and choose it again.`,
    );
  }
  throw new ResumeFileError(
    "unsupported-type",
    `"${fileName}" is not a PDF or Word (.docx) file. Choose a PDF or a .docx.`,
  );
}

async function extractFromPdf(bytes: Uint8Array, fileName: string): Promise<string> {
  try {
    const { text } = await readPdf(bytes);
    return text;
  } catch (error) {
    throw unreadable(fileName, error);
  }
}

async function extractFromWord(bytes: Uint8Array, fileName: string): Promise<string> {
  try {
    // mammoth wants a Node Buffer; this view shares the bytes instead of copying them.
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  } catch (error) {
    throw unreadable(fileName, error);
  }
}

function unreadable(fileName: string, cause: unknown): ResumeFileError {
  return new ResumeFileError(
    "unreadable",
    `Jobgoblin could not read "${fileName}". It may be damaged or protected with a password.`,
    { cause },
  );
}
