// Screening answers for an approved application. A run reads the approved application with every personal
// value replaced by a placeholder such as {phone} (get_approved), writes answers using those placeholders
// (save_answers), and never sees the real values. The database keeps the placeholders; code puts the real
// values back only when it writes Answers.md for the person.
// Threat stopped: personal details (phone, salary, EEO answers) reaching a model.
// Spec: ARCHITECTURE.md section 9 (save_answers, get_approved).
import { GetApprovedOutput, ResumeBody, type SaveAnswersOutput, type Answer } from "@jobgoblin/schemas";
import { fillPlaceholders, findBannedTerms, placeholderDataSheet } from "@jobgoblin/core";
import { getLatestApproval, getProfileSection, getResumeVersion, replaceAnswers } from "@jobgoblin/storage";
import type { z } from "zod";
import type { ServerContext } from "../context";
import { finishApplicationChange } from "./changes";
import { recordHistory } from "./history";
import { loadApplicationOrFail, loadJobOfApplication } from "./loaders";
import { answeredQuestionsOf } from "./tailoringContext";
import { conflict, failed, succeeded, type Outcome } from "./serviceError";
import { summarizeJob } from "./untrustedText";

// get_approved as the schema package defines it, plus the resume the person approved. The answers run needs
// it to describe the person's projects and experience truthfully (the data sheet holds only form fields).
// The resume body holds no contact details: they are printed from the contact section, not from the body.
export const GetApprovedForRunOutput = GetApprovedOutput.extend({ resume: ResumeBody });
export type GetApprovedForRunOutput = z.infer<typeof GetApprovedForRunOutput>;

export function getApprovedForRun(ctx: ServerContext, applicationId: string): GetApprovedForRunOutput {
  const application = loadApplicationOrFail(ctx, applicationId);
  const approval = getLatestApproval(ctx.db, applicationId);
  if (approval === null) {
    throw conflict("not-approved", "This application has not been approved.", "Move on to the next application.");
  }
  const resume = getResumeVersion(ctx.db, approval.resumeVersion);
  if (resume === null) throw new Error("The approved resume version is missing from the database.");

  const job = loadJobOfApplication(ctx, application);
  return {
    application: { id: application.id, company: application.company, title: application.title },
    jobSummary: summarizeJob(job),
    questions: job.questions,
    dataSheet: placeholderDataSheet(approval.dataSheet),
    answeredQuestions: answeredQuestionsOf(ctx, applicationId),
    resume: resume.body,
  };
}

export function saveAnswers(
  ctx: ServerContext,
  request: { applicationId: string; answers: Answer[] },
): Outcome<SaveAnswersOutput> {
  const application = loadApplicationOrFail(ctx, request.applicationId);
  const approval = getLatestApproval(ctx.db, application.id);
  if (approval === null || application.folder === null) {
    throw conflict("not-approved", "This application has not been approved.", "Move on to the next application.");
  }

  const banned = findBannedAnswers(ctx, request.answers);
  if (banned.length > 0) return failed(banned);

  ctx.db.transaction(() => {
    replaceAnswers(ctx.db, application.id, request.answers, ctx.now().toISOString());
    recordHistory(ctx, { applicationId: application.id, actor: "run", type: "answers-saved", detail: `${request.answers.length} answers` });
  });
  writeAnswersFile(ctx, application.folder, request.answers, approval.dataSheet);

  finishApplicationChange(ctx, application.id);
  return succeeded({ saved: request.answers.length });
}

function findBannedAnswers(ctx: ServerContext, answers: readonly Answer[]) {
  const texts = answers.map((answer, index) => ({ path: `answers[${index}].answer`, text: answer.answer }));
  return findBannedTerms(texts, getProfileSection(ctx.db, "rules").bannedTerms);
}

// Answers.md is for the person to read and copy from, so it holds the real values.
function writeAnswersFile(
  ctx: ServerContext,
  applicationFolder: string,
  answers: readonly Answer[],
  dataSheet: Parameters<typeof fillPlaceholders>[1],
): void {
  if (ctx.folder === null) return;
  const sections = answers.map((answer) => `## ${answer.question}\n\n${fillPlaceholders(answer.answer, dataSheet)}\n`);
  try {
    ctx.folder.writeAnswers(applicationFolder, `# Answers\n\n${sections.join("\n")}`);
  } catch (error) {
    ctx.logger.error({ err: error }, "Could not write Answers.md.");
  }
}
