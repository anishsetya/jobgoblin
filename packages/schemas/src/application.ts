// An application: one job being pursued, from the moment a run records a fit for it until it ends.
// Its status is one of the 20 in status.ts and only changes through the state machine in packages/core.
// Spec: "Data model and storage" (applications). ARCHITECTURE.md section 5.7.
import { z } from "zod";
import { Band } from "./fit";
import { ResumeVersionId } from "./resume";
import { ApplicationStatus } from "./status";

// "manual": the person fills the form with copy buttons and clicks Submit. "extension" is the autofill
// extension, which the proof of concept does not build.
export const SubmitMode = z.enum(["manual", "extension"]);
export type SubmitMode = z.infer<typeof SubmitMode>;

export const Application = z.object({
  id: z.string(),
  jobId: z.string(),
  company: z.string(),
  title: z.string(),
  status: ApplicationStatus,
  fitScore: z.number().int().min(0).max(100).nullable(),
  band: Band.nullable(),
  resumeVersion: ResumeVersionId.nullable(), // the current resume; the approved one once approved
  submitMode: SubmitMode,
  folder: z.string().nullable(), // the application's folder, relative to the person's folder; set once approved
  appliedAt: z.iso.datetime().nullable(),
  followUpOn: z.iso.date().nullable(), // a calendar day, not a moment: "follow up on 2026-11-07"
  tailorAttempts: z.number().int().nonnegative(),
  tailorError: z.string().nullable(), // plain words, shown on the card when tailoring gave up
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Application = z.infer<typeof Application>;
