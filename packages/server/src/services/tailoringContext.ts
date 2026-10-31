// Everything a tailor run needs to make one resume (get_tailoring_context): the application, the default
// resume to start from, every confirmed story item, what the fit found, the banned words, the job brief, the
// person's edit note if this is an edit request, and the answers to questions the run asked earlier.
// Spec: ARCHITECTURE.md section 9 (get_tailoring_context).
import type { Answer, GetTailoringContextOutput, ResumeBody } from "@jobgoblin/schemas";
import { buildMasterResume } from "@jobgoblin/core";
import {
  getFit,
  getMasterResume,
  getProfileSection,
  listQuestionsForApplication,
  listStoryItemsByStatus,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { loadApplicationOrFail, loadJobOfApplication, loadRunOrFail } from "./loaders";
import { summarizeJob } from "./untrustedText";

export function getTailoringContext(
  ctx: ServerContext,
  request: { runId: string; applicationId: string },
): GetTailoringContextOutput {
  const application = loadApplicationOrFail(ctx, request.applicationId);
  const run = loadRunOrFail(ctx, request.runId);
  const job = loadJobOfApplication(ctx, application);
  const fit = getFit(ctx.db, application.id);
  const storyItems = listStoryItemsByStatus(ctx.db, "confirmed");

  return {
    application: { id: application.id, company: application.company, title: application.title },
    master: readMasterBody(ctx),
    storyItems,
    mustHaves: fit?.mustHaves ?? [],
    gaps: fit?.gaps ?? [],
    bannedTerms: getProfileSection(ctx.db, "rules").bannedTerms,
    jobSummary: summarizeJob(job),
    editNote: run.input.editNote ?? null,
    answeredQuestions: answeredQuestionsOf(ctx, application.id),
  };
}

// The questions the person has answered for this application, as the question and the answer.
export function answeredQuestionsOf(ctx: ServerContext, applicationId: string): Answer[] {
  const answered: Answer[] = [];
  for (const question of listQuestionsForApplication(ctx.db, applicationId)) {
    if (question.answer !== null) answered.push({ question: question.text, answer: question.answer });
  }
  return answered;
}

// The default resume (the master) that tailoring starts from and Review compares against. Setup saves it;
// before that, one is built from what is confirmed so far.
export function readMasterBody(ctx: ServerContext): ResumeBody {
  return getMasterResume(ctx.db)?.body ?? buildMasterResume(listStoryItemsByStatus(ctx.db, "confirmed"));
}
