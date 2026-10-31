// Scoring: a run records how well a job fits (record_fit), and asks first for what it needs (get_fit_context).
// record_fit is one transaction: create the application in Found if there is none, move it Found to Scored,
// then Scored to Skipped (low fit) or Long shot when the band says so, save the fit, and mark the job seen.
// Spec: ARCHITECTURE.md section 9 (record_fit, get_fit_context) and 6.1.
import type { Application, FitInput, GetFitContextOutput, RecordFitOutput } from "@jobgoblin/schemas";
import { bandFor, statusAfterFit } from "@jobgoblin/core";
import {
  getApplicationByJobId,
  getJob,
  getProfileSection,
  listStoryItemsByStatus,
  markJobsSeen,
  saveFit,
  updateApplicationFields,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { createApplicationInFound } from "./applicationCreation";
import { finishApplicationChange } from "./changes";
import { readRubric } from "./fitRubric";
import { moveApplication } from "./moves";
import { failed, succeeded, type Outcome } from "./serviceError";

export function getFitContext(ctx: ServerContext): GetFitContextOutput {
  return {
    rubric: readRubric(ctx).text,
    targets: getProfileSection(ctx.db, "targets"),
    storyItems: listStoryItemsByStatus(ctx.db, "confirmed"),
  };
}

export function recordFit(ctx: ServerContext, input: FitInput): Outcome<RecordFitOutput> {
  const job = getJob(ctx.db, input.jobId);
  if (job === null) {
    return failed([{ code: "unknown-job", message: `There is no job with the id "${input.jobId}". Use an id from search_jobs.` }]);
  }

  const existing = getApplicationByJobId(ctx.db, input.jobId);
  if (existing !== null && existing.status !== "Found") {
    return failed([{ code: "already-scored", message: "This job already has a fit score. Move on to the next job." }]);
  }

  const applicationId = ctx.db.transaction(() => {
    const application = existing ?? createApplicationInFound(ctx, job, "server", "record_fit");
    scoreApplication(ctx, application, input);
    markJobsSeen(ctx.db, [input.jobId], ctx.now().toISOString());
    return application.id;
  });

  const application = finishApplicationChange(ctx, applicationId);
  if (application === null || application.band === null) {
    throw new Error("The fit was saved but the application cannot be read back.");
  }
  return succeeded({ applicationId, band: application.band, status: application.status });
}

// Runs inside record_fit's transaction.
function scoreApplication(ctx: ServerContext, application: Application, input: FitInput): void {
  // A hard skip records score 0, whatever the run thought of the match.
  const hasHardSkip = input.hardSkip !== null && input.hardSkip.trim() !== "";
  const score = hasHardSkip ? 0 : input.score;
  const band = bandFor(score);
  const reason = hasHardSkip ? (input.hardSkip ?? input.reason) : input.reason;

  saveFit(ctx.db, {
    ...input,
    applicationId: application.id,
    score,
    band,
    rubricVersion: readRubric(ctx).version,
    createdAt: ctx.now().toISOString(),
  });
  updateApplicationFields(ctx.db, application.id, { fitScore: score, band }, ctx.now().toISOString());

  moveApplication(ctx, {
    application,
    to: "Scored",
    actor: "run",
    via: "record_fit",
    detail: `Fit ${score}: ${input.reason}`,
  });

  const finalStatus = statusAfterFit({ score, hardSkip: input.hardSkip });
  if (finalStatus !== "Scored") {
    moveApplication(ctx, {
      application: { id: application.id, status: "Scored" },
      to: finalStatus,
      actor: "server",
      via: "record_fit",
      detail: finalStatus === "Skipped (low fit)" ? reason : `Long shot: ${reason}`,
    });
  }
}
