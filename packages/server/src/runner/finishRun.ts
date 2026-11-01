// Records how a run ended: marks the tasks the run never reached as failed (so those applications are free to be
// queued again), saves the status and the plain-words outcome, takes the run's token away, and tells the dashboard.
// This is the only place a launched run gets its final status.
// Spec: ARCHITECTURE.md section 10 (Outcome); runner/README.md ("What launcher.ts must call").
import type { Run } from "@jobgoblin/schemas";
import { countRunTasksByState, listRunTasks, setRunTaskState, updateRun } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { announceRun } from "../services/changes";
import { tasksLeftPending, type RunEnd } from "./outcome";

const NOT_REACHED_NOTE = "The run ended before reaching this one.";

export type FinishedRunFacts = {
  end: RunEnd;
  resultText: string | null; // an ask run's answer, shown to the person
};

export function finishRun(ctx: ServerContext, run: Run, facts: FinishedRunFacts): Run {
  failTasksNeverReached(ctx, run.id);
  const progress = countRunProgress(ctx, run);

  const saved = updateRun(ctx.db, run.id, {
    status: facts.end.status,
    outcomeMessage: describeEnd(facts.end, ctx.now()),
    resultText: facts.resultText,
    endedAt: ctx.now().toISOString(),
    pid: null, // a process id left in the record could be handed to another program later
    step: null,
    ...progress,
  });
  // Whatever happened, the token must not outlive the run (threat: a stray process calling the tools later).
  ctx.runTokens.revoke(run.id);

  const finished = saved ?? run;
  announceRun(ctx, finished);
  return finished;
}

function failTasksNeverReached(ctx: ServerContext, runId: string): void {
  for (const task of tasksLeftPending(listRunTasks(ctx.db, runId))) {
    setRunTaskState(ctx.db, { runId, applicationId: task.applicationId, state: "failed", note: NOT_REACHED_NOTE });
  }
}

// A run with a work queue shows "3 of 5"; the others have no progress to show.
function countRunProgress(ctx: ServerContext, run: Run): { progressDone?: number; progressTotal?: number } {
  if (run.progressTotal === null) return {};
  const counts = countRunTasksByState(ctx.db, run.id);
  return { progressDone: counts.done + counts.failed, progressTotal: counts.pending + counts.done + counts.failed + counts.waiting };
}

// A run has no field for the time a plan limit lifts, so the time goes into the sentence the person reads.
function describeEnd(end: RunEnd, now: Date): string {
  if (end.resetsAt === undefined) return end.outcomeMessage;
  return `${end.outcomeMessage}. It resets ${describeTime(new Date(end.resetsAt), now)}.`;
}

// In the computer's own time zone and language, which is the person's.
function describeTime(time: Date, now: Date): string {
  const clock = time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const isToday = time.toDateString() === now.toDateString();
  if (isToday) return `at ${clock}`;
  return `on ${time.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })} at ${clock}`;
}
