// The work queue inside a tailor or answers run: which application is next (next_task) and how each one
// ended (complete_task). An application with an open question is skipped (decision D17), and "waiting"
// can only be reported for an application that really has a question open.
// Spec: ARCHITECTURE.md section 9 (next_task, complete_task).
import type { CompleteTaskOutput, NextTaskOutput, TaskOutcome } from "@jobgoblin/schemas";
import { countRunTasksByState, getNextPendingRunTask, hasOpenQuestion, listRunTasks, setRunTaskState, updateRun } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { announceRun } from "./changes";
import { loadRunOrFail } from "./loaders";
import { conflict, failed, succeeded, type Outcome } from "./serviceError";

export function nextTask(ctx: ServerContext, runId: string): NextTaskOutput {
  return { applicationId: getNextPendingRunTask(ctx.db, runId)?.applicationId ?? null };
}

// A run may only touch the applications in its own work queue. Tools call this before they read or change
// an application on behalf of a run, so one run cannot reach into another's work.
export function assertApplicationInRun(ctx: ServerContext, runId: string, applicationId: string): void {
  const isInRun = listRunTasks(ctx.db, runId).some((task) => task.applicationId === applicationId);
  if (!isInRun) {
    throw conflict("not-in-this-run", "That application is not part of this run.", "Use next_task to get the next application.");
  }
}

export function completeTask(
  ctx: ServerContext,
  request: { runId: string; applicationId: string; outcome: TaskOutcome; note?: string },
): Outcome<CompleteTaskOutput> {
  const isInRun = listRunTasks(ctx.db, request.runId).some((task) => task.applicationId === request.applicationId);
  if (!isInRun) {
    return failed([{ code: "not-in-this-run", message: "That application is not part of this run. Use next_task to get the next one." }]);
  }
  if (request.outcome === "waiting" && !hasOpenQuestion(ctx.db, request.applicationId)) {
    return failed([{ code: "no-open-question", message: "Ask the person a question with ask_person first, then report waiting." }]);
  }

  setRunTaskState(ctx.db, {
    runId: request.runId,
    applicationId: request.applicationId,
    state: request.outcome,
    note: request.note ?? null,
  });
  const progress = recordProgress(ctx, request.runId);
  return succeeded(progress);
}

// A task counts as finished when it is done or failed; a waiting one is not finished yet.
function recordProgress(ctx: ServerContext, runId: string): CompleteTaskOutput {
  const counts = countRunTasksByState(ctx.db, runId);
  const total = counts.pending + counts.done + counts.failed + counts.waiting;
  const done = counts.done + counts.failed;
  const run = updateRun(ctx.db, runId, { progressDone: done, progressTotal: total }) ?? loadRunOrFail(ctx, runId);
  announceRun(ctx, run);
  return { done, total };
}
