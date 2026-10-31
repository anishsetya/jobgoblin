// The public face of @jobgoblin/render: render a resume to PDF, read a PDF back, and read an uploaded resume.
// Re-exports only; no logic lives here. Spec: ARCHITECTURE.md section 8.1.
export { TEMPLATE_VERSION, defaultTemplatesDir } from "./templates";
export { createResumeRenderer } from "./renderResume";
export type { RenderResumeInput, ResumeRenderer } from "./renderResume";
export { readPdf } from "./readPdf";
export type { PdfContents } from "./readPdf";
export { extractResumeText } from "./extractResumeText";
export { ResumeFileError } from "./resumeFileError";
export type { ResumeFileErrorCode } from "./resumeFileError";
