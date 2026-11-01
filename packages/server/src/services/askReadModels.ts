// The read-only views an ask run gets (list_ready, get_pipeline, get_application). They are built from the same
// data as the dashboard's screens, but a run never sees the person's contact details: answers keep their
// {placeholders}, and the history holds only what the log recorded.
// Spec: ARCHITECTURE.md section 9 (list_ready, get_pipeline, get_application).
import type { GetApplicationOutput, GetPipelineOutput, ListReadyOutput } from "@jobgoblin/schemas";
import {
  countApplicationsByStatus,
  formatLocalDay,
  getFit,
  getResumeVersion,
  listAnswers,
  listApplications,
  listApplicationsByStatus,
  listHistoryEvents,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { loadApplicationOrFail, loadJobOfApplication } from "./loaders";

// The applications waiting for the person's approval.
export function listReady(ctx: ServerContext): ListReadyOutput {
  return {
    applications: listApplicationsByStatus(ctx.db, ["Awaiting approval"]).map((application) => ({
      applicationId: application.id,
      company: application.company,
      title: application.title,
      fitScore: application.fitScore,
      band: application.band,
    })),
  };
}

export function getPipelineSummary(ctx: ServerContext): GetPipelineOutput {
  return {
    counts: countApplicationsByStatus(ctx.db),
    rows: listApplications(ctx.db, {}, formatLocalDay(ctx.now())).map((row) => ({
      applicationId: row.id,
      company: row.company,
      title: row.title,
      status: row.status,
      fitScore: row.fitScore,
    })),
  };
}

export function getApplicationForRun(ctx: ServerContext, applicationId: string): GetApplicationOutput {
  const application = loadApplicationOrFail(ctx, applicationId);
  const job = loadJobOfApplication(ctx, application);
  const resume = application.resumeVersion === null ? null : getResumeVersion(ctx.db, application.resumeVersion);
  return {
    application,
    job: { company: job.company, title: job.title, location: job.location, url: job.url },
    fit: getFit(ctx.db, applicationId),
    resume: resume?.body ?? null,
    answers: listAnswers(ctx.db, applicationId),
    history: listHistoryEvents(ctx.db, applicationId),
  };
}
