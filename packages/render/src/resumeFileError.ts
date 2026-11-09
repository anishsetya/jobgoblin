// The error extractResumeText throws when it cannot read a file the person chose. Each code has its own
// message and action, written in plain words to be shown as they are; the server turns them into an ApiError.
// The rule behind the list: only say what we know. "Damaged" and "password" are named only when the PDF or
// Word reader said so. Anything else is our problem, and the message says that instead of blaming the file.
// Spec: S3 "import a resume"; ARCHITECTURE.md section 8.1; RCA-2026-11-01-pdf-upload.md follow-up 3.

// unsupported-type     the file is not a PDF or a .docx
// password-protected   the PDF needs a password to open
// damaged              the file is the right type, but the reader says it is broken or incomplete
// read-failed          anything else: a problem on our side, not with the file
export type ResumeFileErrorCode = "unsupported-type" | "password-protected" | "damaged" | "read-failed";

type ResumeFileErrorWords = { message: string; action: string };

const STANDARD_WORDS: Record<ResumeFileErrorCode, ResumeFileErrorWords> = {
  "unsupported-type": {
    message: "This file is not a PDF or a Word file.",
    action: "Choose a PDF or a Word (.docx) file.",
  },
  "password-protected": {
    message: "This PDF is protected with a password.",
    action: "Open it, save a copy without a password, and choose that copy.",
  },
  damaged: {
    message: "This file looks damaged or incomplete.",
    action: "Export your resume again as a PDF and choose the new file.",
  },
  "read-failed": {
    message: "Jobgoblin could not read this file. This is a problem on our side, not with your file.",
    action: "Try again. If it keeps happening, choose a Word copy of your resume.",
  },
};

export class ResumeFileError extends Error {
  readonly code: ResumeFileErrorCode;
  readonly action: string;

  // `words` replaces the standard words of the code when a situation needs a more exact sentence.
  constructor(code: ResumeFileErrorCode, options?: { words?: ResumeFileErrorWords; cause?: unknown }) {
    const words = options?.words ?? STANDARD_WORDS[code];
    super(words.message, { cause: options?.cause });
    this.name = "ResumeFileError";
    this.code = code;
    this.action = words.action;
  }
}
