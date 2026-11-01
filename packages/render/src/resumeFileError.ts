// The error extractResumeText throws when it cannot read a file the person chose. The message is plain
// words meant to be shown as they are; the server turns it into an ApiError for the setup screen.
// Spec: S3 "import a resume"; ARCHITECTURE.md section 8.1.

// unsupported-type  the file is not a PDF or a .docx
// unreadable        it is the right type but damaged, protected, or not really that type
export type ResumeFileErrorCode = "unsupported-type" | "unreadable";

export class ResumeFileError extends Error {
  readonly code: ResumeFileErrorCode;

  constructor(code: ResumeFileErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResumeFileError";
    this.code = code;
  }
}
