// A resume as data: a selection of Your story items (each part carries the id it came from),
// the checks it must pass, its saved versions, and how it differs from the master resume.
// Contact details never appear in a ResumeBody; code fills the header from the contact section.
// Spec: "Resume pipeline". ARCHITECTURE.md sections 5.6 and 8.
import { z } from "zod";

// A SHA-256 as 64 lowercase hex characters, the form node:crypto's digest("hex") produces.
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "Expected a SHA-256 as 64 lowercase hex characters.");
export type Sha256Hex = z.infer<typeof Sha256Hex>;

// "r-" plus the full SHA-256 of the canonical resume JSON and the template version.
export const ResumeVersionId = z.string().regex(/^r-[0-9a-f]{64}$/, "Expected r- followed by 64 hex characters.");
export type ResumeVersionId = z.infer<typeof ResumeVersionId>;

// What the app shows: "r-" plus the first 8 characters. It grows past 8 only if two versions ever clash.
export const ResumeShortId = z.string().regex(/^r-[0-9a-f]{8,64}$/, "Expected r- followed by at least 8 hex characters.");
export type ResumeShortId = z.infer<typeof ResumeShortId>;

// The id of the Your story item a part of the resume comes from. Truthfulness control: a part without
// one cannot be traced to something the person confirmed, so the schema refuses it before the trace runs.
const StoryItemId = z.string().min(1);

// A line of text and the story item it comes from. The text may be reworded; its facts may not change.
export const SourcedText = z.object({
  src: StoryItemId,
  text: z.string().min(1),
});
export type SourcedText = z.infer<typeof SourcedText>;

// One experience or project, with the achievements chosen for it.
export const ResumeEntry = z.object({
  src: StoryItemId, // an experience or project id
  bullets: z.array(SourcedText),
});
export type ResumeEntry = z.infer<typeof ResumeEntry>;

export const ResumeBody = z.object({
  headline: SourcedText.nullable(),
  sections: z.object({
    experience: z.array(ResumeEntry),
    projects: z.array(ResumeEntry),
  }),
  skills: z.array(SourcedText),
  education: z.array(z.object({ src: StoryItemId })),
});
export type ResumeBody = z.infer<typeof ResumeBody>;

// Filled in by code from the contact section when the PDF is rendered. Never part of ResumeBody,
// so a run never sees or writes the person's contact details.
export const ResumeHeader = z.object({
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  links: z.array(z.string()),
});
export type ResumeHeader = z.infer<typeof ResumeHeader>;

// The ways a draft can fail, each with a message a run can act on:
//   schema        the body does not match ResumeBody
//   untraced      a part names a story item that is missing, not confirmed, or the wrong kind
//   changed-fact  a number, date or named tool in the text is not in the cited story item
//   inflated-verb a strong verb ("led") that the cited story item does not use
//   banned        a banned term appears
//   cap           the per-company or reapply limit would be broken
//   pages         the rendered PDF is not exactly one page
//   banned-in-pdf a banned term appears in the rendered PDF's text
export const ResumeCheckErrorCode = z.enum([
  "schema",
  "untraced",
  "changed-fact",
  "inflated-verb",
  "banned",
  "cap",
  "pages",
  "banned-in-pdf",
]);
export type ResumeCheckErrorCode = z.infer<typeof ResumeCheckErrorCode>;

// Returned to the run as a value (not thrown), so it can fix the draft and submit again.
export const ResumeCheckError = z.object({
  code: ResumeCheckErrorCode,
  path: z.string(), // where in the body, for example "sections.experience[0].bullets[2]"
  message: z.string(), // plain words that tell the run what to change
});
export type ResumeCheckError = z.infer<typeof ResumeCheckError>;

// The content of a resume, shared by every application that uses it (decision D18). Two applications
// with the same resume point at the same version, so they can never clash.
// The version id covers the body, the header and the template version, so a new phone number or a new
// template makes a new version. `headerHash` is the SHA-256 of the header it was built with; the
// header itself is not stored with the version, it is built from the contact section at render time.
export const ResumeVersion = z.object({
  versionId: ResumeVersionId,
  shortId: ResumeShortId,
  body: ResumeBody,
  headerHash: Sha256Hex,
  templateVersion: z.string(), // for example "t1"; old templates are kept so a version can be explained
  createdAt: z.iso.datetime(),
});
export type ResumeVersion = z.infer<typeof ResumeVersion>;

// "draft" versions are previews that can be rebuilt. "approved" is frozen: the PDF is built once.
export const ApplicationResumeState = z.enum(["draft", "approved"]);
export type ApplicationResumeState = z.infer<typeof ApplicationResumeState>;

// One application's use of a resume version, and where that use stands.
export const ApplicationResume = z.object({
  applicationId: z.string(),
  versionId: ResumeVersionId,
  shortId: ResumeShortId,
  state: ApplicationResumeState,
  pdfSha256: Sha256Hex.nullable(), // fingerprint of the frozen PDF; null until approved
  createdAt: z.iso.datetime(),
});
export type ApplicationResume = z.infer<typeof ApplicationResume>;

// What changed against the master resume. Every list holds story item ids, except `reworded`.
export const ResumeDiff = z.object({
  added: z.array(z.string()),
  removed: z.array(z.string()),
  reordered: z.boolean(),
  reworded: z.array(z.object({ src: z.string(), from: z.string(), to: z.string() })),
});
export type ResumeDiff = z.infer<typeof ResumeDiff>;
