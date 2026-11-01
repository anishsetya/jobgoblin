// Everything the Review, Open application and Application screens need about one application, in one
// response: the job, the fit, the resume and how it differs from the master, the data sheet and its hash,
// the approval, the answers, the history, and which buttons are allowed.
// The data sheet is rebuilt from the profile on every request, so what the person sees is what Approve will check.
// Spec: ARCHITECTURE.md section 5.9 (ApplicationDetail) and 8.5.
import type { Answer, ApplicationDetail, DataSheet, ResumeBody } from "@jobgoblin/schemas";
import { allowedMoves, diffAgainstMaster, fillPlaceholders } from "@jobgoblin/core";
import {
  getFit,
  getLatestApproval,
  getSubmissionForApplication,
  listAnswers,
  listApplicationResumes,
  listHistoryEvents,
  listQuestionsForApplication,
  listStoryItemsByIds,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { computeActions } from "./applicationActions";
import { listAskResults } from "./askRuns";
import { resolveCurrentResume } from "./currentResume";
import { buildCurrentDataSheet } from "./dataSheets";
import { loadApplicationOrFail, loadJobOfApplication } from "./loaders";
import { readMasterBody } from "./tailoringContext";

export function getApplicationDetail(ctx: ServerContext, applicationId: string): ApplicationDetail {
  const application = loadApplicationOrFail(ctx, applicationId);
  const job = loadJobOfApplication(ctx, application);
  const fit = getFit(ctx.db, applicationId);
  const history = listHistoryEvents(ctx.db, applicationId);
  const approval = getLatestApproval(ctx.db, applicationId);
  const current = resolveCurrentResume(ctx, application);
  const sheet = current === null ? null : buildCurrentDataSheet(ctx, application, job, current.versionId);

  return {
    application,
    job,
    fit,
    resume: current?.stored ?? null,
    resumeHeader: current?.header ?? null,
    versions: listApplicationResumes(ctx.db, applicationId),
    diff: current === null ? null : diffAgainstMaster(current.stored.body, readMasterBody(ctx)),
    storyItems: listStoryItemsByIds(ctx.db, [...citedItemIds(current?.stored.body ?? null), ...(fit?.matchedItemIds ?? [])]),
    dataSheet: sheet?.dataSheet ?? null,
    dataSheetHash: sheet?.hash ?? null,
    approval,
    answers: answersWithRealValues(listAnswers(ctx.db, applicationId), approval?.dataSheet ?? sheet?.dataSheet ?? null),
    submission: getSubmissionForApplication(ctx.db, applicationId),
    questions: listQuestionsForApplication(ctx.db, applicationId),
    history,
    askResults: listAskResults(ctx, applicationId),
    allowedStatusMoves: allowedMoves(application.status, "person", "status"),
    actions: computeActions(ctx, application, history),
  };
}

// The ids of every story item the resume cites: the headline, each entry, each bullet, skills and schools.
function citedItemIds(body: ResumeBody | null): string[] {
  if (body === null) return [];
  const ids: string[] = [];
  if (body.headline !== null) ids.push(body.headline.src);
  for (const entry of [...body.sections.experience, ...body.sections.projects]) {
    ids.push(entry.src, ...entry.bullets.map((bullet) => bullet.src));
  }
  ids.push(...body.skills.map((skill) => skill.src), ...body.education.map((school) => school.src));
  return ids;
}

// The answers are saved with {placeholders}; the person copies them into a form, so they see the real values.
function answersWithRealValues(answers: Answer[], dataSheet: DataSheet | null): Answer[] {
  if (dataSheet === null) return answers;
  return answers.map((answer) => ({ question: answer.question, answer: fillPlaceholders(answer.answer, dataSheet) }));
}
