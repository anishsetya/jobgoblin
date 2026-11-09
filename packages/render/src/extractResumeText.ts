// Gets the plain text out of a resume the person uploads, so the setup run can read it.
// PDFs go through pdf.js (readPdf) and Word files through mammoth; the file type comes from the file
// name. A scanned or photographed resume has no text layer and comes back as an empty string: the
// caller should check for that and ask for a different file.
// Every file that cannot be read throws a ResumeFileError whose code says why. A reason is named only when
// the reader named it (see resumeFileError.ts); an error we do not recognise becomes "read-failed".
// Spec: S3 "import a resume"; ARCHITECTURE.md section 8.1.
import path from "node:path";
import mammoth from "mammoth";
import { readPdf } from "./readPdf";
import { ResumeFileError, type ResumeFileErrorCode } from "./resumeFileError";

// The names pdf.js gives the errors we understand (it sets `name` on each of its error classes).
const PDF_PASSWORD_ERROR = "PasswordException";
const PDF_DAMAGED_ERRORS = ["InvalidPDFException", "FormatError"];

// Word files are zip files, and mammoth reports a broken one with a plain Error. These are the phrases the
// zip reader and mammoth use for "this is not a complete Word file".
const DAMAGED_WORD_FILE_MESSAGE = /zip|central directory|corrupt|main document part|valid \.docx/i;

export async function extractResumeText(bytes: Uint8Array, fileName: string): Promise<string> {
  const extension = path.extname(fileName).toLowerCase();

  if (extension === ".pdf") return extractFromPdf(bytes);
  if (extension === ".docx") return extractFromWord(bytes);
  if (extension === ".doc") {
    throw new ResumeFileError("unsupported-type", {
      words: {
        message: "This is an older Word file (.doc), which Jobgoblin cannot read.",
        action: "Save it as a .docx or a PDF, then choose the new file.",
      },
    });
  }
  throw new ResumeFileError("unsupported-type");
}

async function extractFromPdf(bytes: Uint8Array): Promise<string> {
  try {
    const { text } = await readPdf(bytes);
    return text;
  } catch (error) {
    throw new ResumeFileError(explainPdfError(error), { cause: error });
  }
}

async function extractFromWord(bytes: Uint8Array): Promise<string> {
  try {
    // mammoth wants a Node Buffer; this view shares the bytes instead of copying them.
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  } catch (error) {
    throw new ResumeFileError(explainWordError(error), { cause: error });
  }
}

function explainPdfError(error: unknown): ResumeFileErrorCode {
  if (!(error instanceof Error)) return "read-failed";
  if (error.name === PDF_PASSWORD_ERROR) return "password-protected";
  if (PDF_DAMAGED_ERRORS.includes(error.name)) return "damaged";
  return "read-failed";
}

function explainWordError(error: unknown): ResumeFileErrorCode {
  if (error instanceof Error && DAMAGED_WORD_FILE_MESSAGE.test(error.message)) return "damaged";
  return "read-failed";
}
