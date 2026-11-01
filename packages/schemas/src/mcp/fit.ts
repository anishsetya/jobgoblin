// MCP tools for scoring a job: get_fit_context and record_fit (hunt and paste runs).
// Spec: ARCHITECTURE.md section 9.
import { z } from "zod";
import { Band, FitInput } from "../fit";
import { TargetsSection } from "../profile";
import { ApplicationStatus } from "../status";
import { StoryItem } from "../story";

// get_fit_context: what a run needs to score a job: the rubric, the person's targets, and every
// confirmed Your story item (fit uses all of them, not only the ones on the master resume).
export const GetFitContextInput = z.object({});
export type GetFitContextInput = z.infer<typeof GetFitContextInput>;

export const GetFitContextOutput = z.object({
  rubric: z.string(),
  targets: TargetsSection,
  storyItems: z.array(StoryItem),
});
export type GetFitContextOutput = z.infer<typeof GetFitContextOutput>;

// record_fit: save a score. It takes exactly what a Fit holds before the server adds the band and
// rubric version, and creates the application if there is none yet.
export const RecordFitInput = FitInput;
export type RecordFitInput = z.infer<typeof RecordFitInput>;

export const RecordFitOutput = z.object({
  applicationId: z.string(),
  band: Band,
  status: ApplicationStatus, // where the application stands now: Scored, Long shot or Skipped (low fit)
});
export type RecordFitOutput = z.infer<typeof RecordFitOutput>;
