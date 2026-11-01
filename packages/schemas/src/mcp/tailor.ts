// MCP tools for tailoring a resume: get_tailoring_context and submit_resume_draft (tailor runs).
// Spec: ARCHITECTURE.md section 9.
import { z } from "zod";
import { ResumeBody, ResumeShortId, ResumeVersionId } from "../resume";
import { ApplicationStatus } from "../status";
import { StoryItem } from "../story";
import { Answer } from "../submission";
import { ApplicationRef } from "./applicationRef";

// get_tailoring_context: what a run needs to tailor one resume.
export const GetTailoringContextInput = z.object({
  applicationId: z.string(),
});
export type GetTailoringContextInput = z.infer<typeof GetTailoringContextInput>;

export const GetTailoringContextOutput = z.object({
  application: ApplicationRef,
  master: ResumeBody, // the default selection from Your story, to start from
  storyItems: z.array(StoryItem), // every confirmed item
  mustHaves: z.array(z.string()),
  gaps: z.array(z.string()),
  bannedTerms: z.array(z.string()),
  jobSummary: z.string(),
  editNote: z.string().nullable(), // what the person asked to change, when this is a request edit
  answeredQuestions: z.array(Answer), // questions the run asked earlier and the person has answered
});
export type GetTailoringContextOutput = z.infer<typeof GetTailoringContextOutput>;

// submit_resume_draft: check and render a draft. When a check fails the reply is ok: false with
// every ResumeCheckError at once, so the run can fix them all in one go.
export const SubmitResumeDraftInput = z.object({
  applicationId: z.string(),
  body: ResumeBody,
});
export type SubmitResumeDraftInput = z.infer<typeof SubmitResumeDraftInput>;

export const SubmitResumeDraftOutput = z.object({
  versionId: ResumeVersionId,
  shortId: ResumeShortId,
  status: ApplicationStatus, // Awaiting approval once the draft passes
});
export type SubmitResumeDraftOutput = z.infer<typeof SubmitResumeDraftOutput>;
