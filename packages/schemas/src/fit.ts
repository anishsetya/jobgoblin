// How well a job fits the person: the score a run records, and the band the server derives from it.
// A run sends FitInput (record_fit); the server adds the band and the rubric version to make a Fit.
// Spec: "Data model and storage" (fits) and "MCP tools" (record_fit). ARCHITECTURE.md section 5.5.
import { z } from "zod";

// apply: 75 and up. stretch: 60-74. long-shot: 50-59. skip: under 50.
// The cut-offs live in packages/core (bandFor); this file only names the bands.
export const Band = z.enum(["apply", "stretch", "long-shot", "skip"]);
export type Band = z.infer<typeof Band>;

// The `.describe()` texts below are shown to the run in the tool's description, so they say what to write.
export const FitInput = z.object({
  jobId: z.string(),
  score: z.number().int().min(0).max(100),
  track: z.string().describe("The track this job belongs to, such as backend, ai, platform or fde."),
  mustHaves: z.array(z.string()).default([]).describe("The posting's must-have skills and keywords."),
  gaps: z.array(z.string()).default([]).describe("Must-haves that Your story does not show."),
  flags: z.array(z.string()).default([]).describe("Risks worth the person's attention, in plain words."),
  matchedItemIds: z
    .array(z.string())
    .default([])
    .describe("Ids of the Your story items that support this fit."),
  reason: z.string().min(1).describe("One line on why this score, in plain words."),
  hardSkip: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Plain-words reason if the job must be skipped whatever its score " +
        "(not a software role, posting closed, ...), else null.",
    ),
});
export type FitInput = z.infer<typeof FitInput>;

export const Fit = FitInput.extend({
  applicationId: z.string(),
  band: Band,
  rubricVersion: z.string(), // which version of the scoring rubric produced the score
  createdAt: z.iso.datetime(),
});
export type Fit = z.infer<typeof Fit>;
