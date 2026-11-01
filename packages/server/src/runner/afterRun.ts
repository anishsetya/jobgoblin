// What follows a run that has ended:
//   hunt or paste  -> admit the scored applications to tailoring (best scores first, within the limits)
//   tailor         -> an application whose draft never passed gets ONE retry run on sonnet; after that the person is told
//                     why ("Couldn't tailor this one: ...") and decides
//   anything else  -> nothing (answers runs report through their tasks)
// A cancelled or blocked run starts nothing new: the person (Retry) or a sign-in decides what happens next.
// Spec: ARCHITECTURE.md section 10 ("After a run"); packages/server/README.md ("What the launcher plugs in", 5).
import type { Application, Run, RunTask } from "@jobgoblin/schemas";
import { getApplication, listRunTasks, updateApplicationFields } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { announceApplication, saveChangesSoon } from "../services/changes";
import { ServiceError } from "../services/serviceError";
import { admitAfterHuntOrPaste } from "../services/tailoring";

// A draft that passed moves the application to "Awaiting approval"; these are the places it can still be.
const STATUSES_WITHOUT_A_PASSED_DRAFT: readonly string[] = ["Scored", "Long shot", "Tailored"];
const RETRY_MODEL = "sonnet";

export function afterRun(ctx: ServerContext, run: Run): void {
  if (run.status === "cancelled" || run.status === "blocked") return;

  if (run.kind === "hunt" || run.kind === "paste") {
    admitAfterHuntOrPaste(ctx);
  } else if (run.kind === "tailor") {
    retryOrExplainFailedTailoring(ctx, run);
  }
}

type UntailoredApplication = { application: Application; reason: string };

function retryOrExplainFailedTailoring(ctx: ServerContext, run: Run): void {
  const untailored = findUntailoredApplications(ctx, run);
  const toRetry = untailored.filter((entry) => entry.application.tailorAttempts === 0);
  const toExplain = untailored.filter((entry) => entry.application.tailorAttempts > 0);

  for (const entry of toExplain) explainFailure(ctx, entry);
  if (toRetry.length > 0) queueOneRetry(ctx, run, toRetry);
}

// Applications whose task failed and that still have no draft that passed.
function findUntailoredApplications(ctx: ServerContext, run: Run): UntailoredApplication[] {
  const found: UntailoredApplication[] = [];
  for (const task of listRunTasks(ctx.db, run.id)) {
    if (task.state !== "failed") continue;
    const application = getApplication(ctx.db, task.applicationId);
    if (application === null || !STATUSES_WITHOUT_A_PASSED_DRAFT.includes(application.status)) continue;
    found.push({ application, reason: reasonOf(task) });
  }
  return found;
}

function reasonOf(task: RunTask): string {
  const note = task.note?.trim() ?? "";
  return note === "" ? "the run could not finish it" : note;
}

// The second failure: no more automatic tries. The application shows in Needs you as "not tailored".
function explainFailure(ctx: ServerContext, entry: UntailoredApplication): void {
  updateApplicationFields(ctx.db, entry.application.id, { tailorError: `Couldn't tailor this one: ${entry.reason}` }, ctx.now().toISOString());
  announceApplication(ctx, entry.application.id);
  saveChangesSoon(ctx);
}

// The first failure: one more run, on the stronger model, for all of them together.
function queueOneRetry(ctx: ServerContext, run: Run, entries: UntailoredApplication[]): void {
  try {
    ctx.runs.queueRun({
      kind: "tailor",
      applicationIds: entries.map((entry) => entry.application.id),
      input: run.input,
      model: RETRY_MODEL,
      retryOf: run.id,
    });
  } catch (error) {
    // Another run took one of the applications in the meantime (a question was answered, say). Not an error to show.
    if (!(error instanceof ServiceError)) throw error;
    ctx.logger.info({ runId: run.id, code: error.code }, "The tailoring retry was not queued.");
    return;
  }
  for (const entry of entries) {
    updateApplicationFields(ctx.db, entry.application.id, { tailorAttempts: entry.application.tailorAttempts + 1 }, ctx.now().toISOString());
    announceApplication(ctx, entry.application.id);
  }
  saveChangesSoon(ctx);
}
