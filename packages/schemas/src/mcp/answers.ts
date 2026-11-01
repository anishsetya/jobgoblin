// MCP tools for screening answers: get_approved and save_answers (answers runs).
// Spec: ARCHITECTURE.md section 9.
import { z } from "zod";
import { DataSheet } from "../dataSheet";
import { Answer } from "../submission";
import { ApplicationRef } from "./applicationRef";

// save_answers: save screening answers for an approved application. Banned terms are checked, and
// personal placeholders such as {phone} stay as they are in the database; code fills them in only
// when it writes Answers.md.
export const SaveAnswersInput = z.object({
  applicationId: z.string(),
  answers: z.array(Answer).min(1),
});
export type SaveAnswersInput = z.infer<typeof SaveAnswersInput>;

export const SaveAnswersOutput = z.object({
  saved: z.number().int().nonnegative(),
});
export type SaveAnswersOutput = z.infer<typeof SaveAnswersOutput>;

// get_approved: an approved application and the questions to answer. Personal values on the data
// sheet come back as "{key}" placeholders, never as the real values. (The server adds the approved
// resume to this reply: see GetApprovedForRunOutput in packages/server/src/services/answers.ts.)
export const GetApprovedInput = z.object({
  applicationId: z.string(),
});
export type GetApprovedInput = z.infer<typeof GetApprovedInput>;

export const GetApprovedOutput = z.object({
  application: ApplicationRef,
  jobSummary: z.string(),
  questions: z.array(z.string()), // the application form's screening questions
  dataSheet: DataSheet, // with personal values replaced by placeholders
  answeredQuestions: z.array(Answer), // questions the run asked earlier and the person has answered
});
export type GetApprovedOutput = z.infer<typeof GetApprovedOutput>;
