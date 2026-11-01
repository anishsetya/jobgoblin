// The queue side of runs: put a run in the queue with its tasks. This is the only way a run enters the queue;
// every service and the runner's afterRun.ts call queueRun (or insertQueuedRun inside their own transaction).
// Starting the Claude Code process is the launcher's job (ctx.launcher); this file only writes the
// database and tells the launcher to wake up. Until a launcher exists, a queued run simply waits.
// Cancel, retry and dismiss are in runLifecycle.ts.
// Rules: an application sits in only one active run at a time (section 8.3); answering a question joins a
// queued run of the same kind (D8).
// Spec: ARCHITECTURE.md sections 5.8, 8.3 and 10.
import { RUN_KIND_SETTINGS, type Run, type RunKind } from "@jobgoblin/schemas";
import { canonicalJson } from "@jobgoblin/core";
import {
  addRunTask,
  atomically,
  findActiveRunForApplication,
  findOldestQueuedRun,
  getApplication,
  getApplicationByJobId,
  insertRun,
  listQuestionsForApplication,
  listRunsByStatus,
  newId,
  updateRun,
} from "@jobgoblin/storage";
import type { QueueRunRequest, ServerContext } from "../context";
import { announceRun } from "./changes";
import { conflict } from "./serviceError";

// Runs of these kinds work through a list of applications (run_tasks) with next_task and complete_task.
// The others (paste, ask) are about one thing named in their input, and setup and hunt have no applications.
export const KINDS_WITH_TASKS: readonly RunKind[] = ["tailor", "answers"];
// Two of these at once would only compete for the same work, so a second one is refused.
const KINDS_ONE_AT_A_TIME: readonly RunKind[] = ["hunt", "setup"];
export const ACTIVE_STATUSES = ["queued", "running", "waiting"] as const;

// ---------------------------------------------------------------------------------------------
// Queueing
// ---------------------------------------------------------------------------------------------

// Saves the run, tells the dashboard and wakes the launcher.
export function queueRun(ctx: ServerContext, request: QueueRunRequest): Run {
  const run = atomically(ctx.db, () => insertQueuedRun(ctx, request));
  announceQueuedRun(ctx, run);
  return run;
}

// The database half of queueRun, for a service that must queue a run inside its own transaction.
// It does not emit or wake: call announceQueuedRun once the transaction has committed.
export function insertQueuedRun(ctx: ServerContext, request: QueueRunRequest): Run {
  refuseSecondRunOfSameKind(ctx, request.kind);
  refuseBusyApplications(ctx, request);

  const joined = joinQueuedRun(ctx, request);
  if (joined !== null) return joined;

  const run = buildQueuedRun(ctx, request);
  insertRun(ctx.db, run, request.applicationIds);
  return run;
}

export function announceQueuedRun(ctx: ServerContext, run: Run): void {
  announceRun(ctx, run);
  ctx.launcher?.wake();
}

function buildQueuedRun(ctx: ServerContext, request: QueueRunRequest): Run {
  return {
    id: newId(),
    kind: request.kind,
    status: "queued",
    model: request.model ?? RUN_KIND_SETTINGS[request.kind].model,
    input: request.input,
    sessionId: null,
    pid: null,
    step: null,
    progressDone: 0,
    progressTotal: KINDS_WITH_TASKS.includes(request.kind) ? request.applicationIds.length : null,
    outcomeMessage: null,
    resultText: null,
    retryOf: request.retryOf ?? null,
    queuedAt: ctx.now().toISOString(),
    startedAt: null,
    endedAt: null,
    dismissedAt: null,
  };
}

function refuseSecondRunOfSameKind(ctx: ServerContext, kind: RunKind): void {
  if (!KINDS_ONE_AT_A_TIME.includes(kind)) return;
  const active = listRunsByStatus(ctx.db, ACTIVE_STATUSES).some((run) => run.kind === kind);
  if (active) {
    throw conflict("run-active", "That is already running.", "Wait for it to finish, or cancel it from Today.");
  }
}

// PRD / section 8.3: an application may sit in only one active run at a time.
function refuseBusyApplications(ctx: ServerContext, request: QueueRunRequest): void {
  for (const applicationId of applicationsTouchedBy(ctx, request)) {
    if (findRunHoldingApplication(ctx, applicationId) !== null) {
      throw conflict(
        "application-busy",
        "This application already has a run in progress.",
        "Wait for it to finish, or cancel it from Today.",
      );
    }
  }
}

// The applications a request works on: its task list, plus the one named in the input of a paste or ask run.
function applicationsTouchedBy(ctx: ServerContext, request: QueueRunRequest): string[] {
  const ids = new Set(request.applicationIds);
  if (request.input.applicationId !== undefined) ids.add(request.input.applicationId);
  if (request.input.jobId !== undefined) {
    const application = getApplicationByJobId(ctx.db, request.input.jobId);
    if (application !== null) ids.add(application.id);
  }
  return [...ids];
}

// The active run (queued, running or waiting) that holds this application, if any. Tailor and answers runs
// hold it through their tasks; a paste run holds the application of its job, an ask run the one it was asked about.
export function findRunHoldingApplication(ctx: ServerContext, applicationId: string): Run | null {
  const holdingTask = findActiveRunForApplication(ctx.db, applicationId);
  if (holdingTask !== null) return holdingTask;

  const application = getApplication(ctx.db, applicationId);
  if (application === null) return null;
  const questionRunIds = new Set(listQuestionsForApplication(ctx.db, applicationId).map((question) => question.runId));
  const holdsByInput = (run: Run): boolean =>
    (run.kind === "ask" && run.input.applicationId === applicationId) ||
    // A paste run that has asked its question has let go: it is only finishing its last message, and the
    // person's answer may start the next paste run before it exits.
    (run.kind === "paste" && run.input.jobId === application.jobId && !questionRunIds.has(run.id));
  return listRunsByStatus(ctx.db, ACTIVE_STATUSES).find(holdsByInput) ?? null;
}

// D8: one re-queued application joins the oldest queued run of its kind, so three answers make one run
// instead of three. It must be the same sort of work, so an "edit this resume" note never leaks to another.
function joinQueuedRun(ctx: ServerContext, request: QueueRunRequest): Run | null {
  const applicationId = request.applicationIds[0];
  const isSingleApplication = request.applicationIds.length === 1 && applicationId !== undefined;
  if (!isSingleApplication || !KINDS_WITH_TASKS.includes(request.kind) || request.retryOf !== undefined) return null;

  const queued = findOldestQueuedRun(ctx.db, request.kind);
  if (queued === null) return null;
  const model = request.model ?? RUN_KIND_SETTINGS[request.kind].model;
  if (queued.model !== model || canonicalJson(queued.input) !== canonicalJson(request.input)) return null;

  addRunTask(ctx.db, queued.id, applicationId);
  return updateRun(ctx.db, queued.id, { progressTotal: (queued.progressTotal ?? 0) + 1 }) ?? queued;
}
