// What the person can do with a run once it exists: start the hunt, cancel a run, retry one that stopped
// early, and clear a finished run's card. Putting a run in the queue is runs.ts.
// Cancel has a terminal state of its own (D11); a retry is a new run that does only the work that was left.
// Spec: ARCHITECTURE.md sections 5.8 and 11 (POST /api/runs, /retry, /dismiss, DELETE /api/runs/:id).
import type { Run } from "@jobgoblin/schemas";
import { atomically, getSetting, listRunTasks, updateRun } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { OUTCOME_MESSAGES } from "../runner/outcome";
import { announceRun } from "./changes";
import { loadRunOrFail } from "./loaders";
import { ACTIVE_STATUSES, announceQueuedRun, insertQueuedRun, KINDS_WITH_TASKS, queueRun } from "./runs";
import { conflict } from "./serviceError";

const RETRYABLE_STATUSES = ["failed", "blocked", "interrupted", "cancelled"];

// The "Find jobs" button.
export function startHunt(ctx: ServerContext): Run {
  if (!getSetting(ctx.db, "setupComplete")) {
    throw conflict("setup-incomplete", "Finish setting up Jobgoblin before looking for jobs.", "Open the setup steps from Today.");
  }
  return queueRun(ctx, { kind: "hunt", applicationIds: [], input: {} });
}

export async function cancelRun(ctx: ServerContext, runId: string): Promise<Run> {
  const run = loadRunOrFail(ctx, runId);

  if (run.status === "running" && ctx.launcher !== null) {
    await ctx.launcher.cancel(runId);
    const afterCancel = loadRunOrFail(ctx, runId);
    // The launcher records the end itself. If it could not (the process was already gone), finish the job here.
    return afterCancel.status === "running" ? cancelInDatabase(ctx, afterCancel) : afterCancel;
  }
  if (isActive(run)) return cancelInDatabase(ctx, run);

  throw conflict("run-finished", "This run has already finished.", "Dismiss it from Today.");
}

function isActive(run: Run): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(run.status);
}

function cancelInDatabase(ctx: ServerContext, run: Run): Run {
  const cancelled = updateRun(ctx.db, run.id, {
    status: "cancelled",
    endedAt: ctx.now().toISOString(),
    outcomeMessage: OUTCOME_MESSAGES.cancelled,
  });
  ctx.runTokens.revoke(run.id);
  const result = cancelled ?? run;
  announceRun(ctx, result);
  return result;
}

// A new run with the same kind and input, for the work that was left. The old run's card is cleared.
export function retryRun(ctx: ServerContext, runId: string): Run {
  const old = loadRunOrFail(ctx, runId);
  if (!RETRYABLE_STATUSES.includes(old.status)) {
    throw conflict("run-not-retryable", "Only a run that stopped early can be tried again.", "Start a new run instead.");
  }

  const unfinished = listRunTasks(ctx.db, old.id).filter((task) => task.state === "pending" || task.state === "failed");
  const applicationIds = unfinished.map((task) => task.applicationId);
  if (KINDS_WITH_TASKS.includes(old.kind) && applicationIds.length === 0) {
    throw conflict("nothing-to-retry", "Nothing in this run is left to do.", "Dismiss it from Today.");
  }

  const run = atomically(ctx.db, () => {
    const retried = insertQueuedRun(ctx, {
      kind: old.kind,
      applicationIds,
      input: old.input,
      model: old.model,
      retryOf: old.id,
    });
    updateRun(ctx.db, old.id, { dismissedAt: ctx.now().toISOString() });
    return retried;
  });
  announceRun(ctx, loadRunOrFail(ctx, old.id));
  announceQueuedRun(ctx, run);
  return run;
}

// Clears a finished run's card from Today.
export function dismissRun(ctx: ServerContext, runId: string): Run {
  const run = loadRunOrFail(ctx, runId);
  if (run.status === "queued" || run.status === "running") {
    throw conflict("run-active", "This run is still going.", "Cancel it first if you want to stop it.");
  }
  const dismissed = updateRun(ctx.db, runId, { dismissedAt: ctx.now().toISOString() }) ?? run;
  announceRun(ctx, dismissed);
  return dismissed;
}
