// Creates an application in "Found" for a job. A feed job becomes an application only when a run records
// a fit for it, or when the person pastes it (decision D9), so this is called from exactly those two places.
// The creation is logged as a history event from "nothing" to Found, like every other move.
// Spec: ARCHITECTURE.md sections 6.1 (the "(new) to Found" rows) and decision D9.
import type { Actor, Application, Job, TransitionVia } from "@jobgoblin/schemas";
import { assertTransition } from "@jobgoblin/core";
import { atomically, insertApplication, insertHistoryEvent, newId } from "@jobgoblin/storage";
import type { ServerContext } from "../context";

export function createApplicationInFound(
  ctx: ServerContext,
  job: Job,
  actor: Actor,
  via: TransitionVia,
): Application {
  assertTransition(null, "Found", actor, via);
  const now = ctx.now().toISOString();
  const application: Application = {
    id: newId(),
    jobId: job.jobId,
    company: job.company,
    title: job.title,
    status: "Found",
    fitScore: null,
    band: null,
    resumeVersion: null,
    submitMode: "manual",
    folder: null,
    appliedAt: null,
    followUpOn: null,
    tailorAttempts: 0,
    tailorError: null,
    createdAt: now,
    updatedAt: now,
  };

  atomically(ctx.db, () => {
    insertApplication(ctx.db, application);
    insertHistoryEvent(ctx.db, {
      id: newId(),
      ts: now,
      actor,
      applicationId: application.id,
      type: "status-changed",
      from: null,
      to: "Found",
      detail: null,
    });
  });
  return application;
}
