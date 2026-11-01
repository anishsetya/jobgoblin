// The data sheet (every form field and value that will be sent) and the approval of one exact sheet.
// Approval is the person's decision and is made only from the dashboard; it never lives in a run.
// In code and SQL it is always `dataSheet` / `data_sheet`, never `datasheet`.
// Spec: "Resume pipeline" (step 9) and "Application state machine". ARCHITECTURE.md sections 5.7 and 8.5.
import { z } from "zod";
import { SubmitMode } from "./application";
import { Region } from "./job";
import { ResumeVersionId, Sha256Hex } from "./resume";

// The 24 values a data sheet can hold. Closed on purpose: a field that is not in this list cannot be
// shown, copied or approved, so a value nobody planned for can never slip onto a form.
// The key is also the name of the {placeholder} that answers use for a personal value, such as {phone}.
export const DataSheetKey = z.enum([
  "fullName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "location",
  "linkedin",
  "github",
  "portfolio",
  "workAuthorized",
  "requiresSponsorship",
  "willingToRelocate",
  "noticePeriod",
  "earliestStartDate",
  "yearsExperience",
  "currentEmployer",
  "currentTitle",
  "expectedBase",
  "gender",
  "raceEthnicity",
  "veteranStatus",
  "disability",
  "resumeFileName",
  "resumeVersion",
]);
export type DataSheetKey = z.infer<typeof DataSheetKey>;

export const DataSheetField = z.object({
  key: DataSheetKey,
  label: z.string(), // plain words for the screen, such as "Email address"
  value: z.string(),
  personal: z.boolean(), // true for contact, compensation and EEO values: never shown to a run
  required: z.boolean(), // true for fullName, email and phone: approval is refused while one is missing
  missing: z.boolean(), // true while the value is still TODO or empty
});
export type DataSheetField = z.infer<typeof DataSheetField>;

export const DataSheet = z.object({
  applicationId: z.string(),
  region: Region, // the job's region: the work authorization answers come from it
  fields: z.array(DataSheetField),
  resumeVersion: ResumeVersionId,
  resumeFileName: z.string(), // "First Last - Resume.pdf": the name the company will see
});
export type DataSheet = z.infer<typeof DataSheet>;

// The person's approval of one exact data sheet and one exact resume file. It is voided if either
// changes later, and used up when the application reaches Applied.
export const Approval = z.object({
  id: z.string(),
  applicationId: z.string(),
  dataSheet: DataSheet, // the sheet exactly as the person saw it
  dataSheetHash: Sha256Hex,
  resumeVersion: ResumeVersionId,
  pdfSha256: Sha256Hex, // fingerprint of the approved resume file
  submitMode: SubmitMode,
  approvedAt: z.iso.datetime(),
  usedAt: z.iso.datetime().nullable(),
  voidedAt: z.iso.datetime().nullable(),
});
export type Approval = z.infer<typeof Approval>;
