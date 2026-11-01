// Small "load it or say it is missing" helpers, so a service reads as a list of steps instead of a pile of
// null checks. Each throws a ServiceError with plain words when the record does not exist.
// Spec: code style ("Prefer a sequence of well-named steps").
import type { Application, Job, Run } from "@jobgoblin/schemas";
import { getApplication, getJob, getRun } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { notFound } from "./serviceError";

export function loadApplicationOrFail(ctx: ServerContext, applicationId: string): Application {
  const application = getApplication(ctx.db, applicationId);
  if (application === null) throw notFound("application", "Open it from Pipeline.");
  return application;
}

export function loadJobOrFail(ctx: ServerContext, jobId: string): Job {
  const job = getJob(ctx.db, jobId);
  if (job === null) throw notFound("job");
  return job;
}

export function loadRunOrFail(ctx: ServerContext, runId: string): Run {
  const run = getRun(ctx.db, runId);
  if (run === null) throw notFound("run");
  return run;
}

// The job behind an application. An application always has one (foreign key), so a miss is a damaged database.
export function loadJobOfApplication(ctx: ServerContext, application: Application): Job {
  return loadJobOrFail(ctx, application.jobId);
}
