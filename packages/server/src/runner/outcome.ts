// Decides how a run ended, from the facts the launcher collected: whether it was cancelled or timed out, the
// `result` line Claude Code printed (if any), and the state of the run's tasks. One pure function, so every row
// of the outcome table can be tested with plain values.
// Spec: ARCHITECTURE.md section 10 (Outcome); tech spec "Runner" (Outcomes).
import type { RunStatus, RunTask } from "@jobgoblin/schemas";
import type { ResultEvent } from "./streamJson";

// Every sentence the person sees on a run card, in one place. Plain, calm, no blame.
export const OUTCOME_MESSAGES = {
  done: "Finished",
  finishedAfterAnswer: "Finished after your answer",
  waiting: "Waiting for your answer",
  cancelled: "This run was cancelled",
  stopped: "This run stopped before finishing",
  stoppedForSafety: "This run was stopped for safety",
  usageLimit: "Your Claude plan limit is reached",
  signedOut: "Sign in with Claude again",
  notInstalled: "Claude Code is not installed",
  updateNeeded: "Claude Code needs an update",
} as const;

export type RunEndFacts = {
  // Kept so the launcher passes everything it knows. The decision rests on the result line: a run that printed
  // a success result is done even if the process was killed a moment later, because every result was already
  // saved through tools.
  exitCode: number | null;
  result: ResultEvent | null; // the `result` line, or null when the process ended without printing one
  timedOut: boolean;
  cancelled: boolean;
  tasks: readonly Pick<RunTask, "state">[];
};

export type RunEnd = {
  status: RunStatus;
  outcomeMessage: string;
  resetsAt?: string; // ISO time when a usage limit lifts, if Claude Code said
};

const USAGE_LIMIT_TEXT = /usage limit/i;
const SIGN_IN_TEXT = /log ?in|auth/i;
// "Claude AI usage limit reached|1760000000": the time the limit lifts, in seconds since 1970.
const RESET_TIME_SUFFIX = /\|(\d{9,13})\s*$/;
// A reset time this large is in milliseconds, not seconds.
const MILLISECONDS_THRESHOLD = 1e12;

export function classifyRunEnd(facts: RunEndFacts): RunEnd {
  if (facts.cancelled) return { status: "cancelled", outcomeMessage: OUTCOME_MESSAGES.cancelled };

  if (facts.timedOut) return stopped();
  if (facts.result === null) return stopped(); // the process ended without a result: a crash

  const result = facts.result;
  if (result.subtype === "error_max_turns") return stopped();
  if (result.isError) return classifyErrorResult(result);

  return hasWaitingTask(facts.tasks)
    ? { status: "waiting", outcomeMessage: OUTCOME_MESSAGES.waiting }
    : { status: "done", outcomeMessage: OUTCOME_MESSAGES.done };
}

function stopped(): RunEnd {
  return { status: "failed", outcomeMessage: OUTCOME_MESSAGES.stopped };
}

// The usage limit is checked first: its message can also contain words like "auth" in a longer text.
function classifyErrorResult(result: ResultEvent): RunEnd {
  if (USAGE_LIMIT_TEXT.test(result.resultText)) {
    const resetsAt = readResetTime(result.resultText);
    const blocked: RunEnd = { status: "blocked", outcomeMessage: OUTCOME_MESSAGES.usageLimit };
    return resetsAt === null ? blocked : { ...blocked, resetsAt };
  }

  if (SIGN_IN_TEXT.test(result.resultText)) return { status: "blocked", outcomeMessage: OUTCOME_MESSAGES.signedOut };

  return stopped();
}

function readResetTime(resultText: string): string | null {
  const digits = RESET_TIME_SUFFIX.exec(resultText)?.[1];
  if (digits === undefined) return null;

  const epoch = Number(digits);
  const milliseconds = epoch >= MILLISECONDS_THRESHOLD ? epoch : epoch * 1000;
  const resetsAt = new Date(milliseconds);
  return Number.isNaN(resetsAt.getTime()) ? null : resetsAt.toISOString();
}

// Pending tasks at the end count as failed (see tasksLeftPending), so "every remaining task is waiting" comes
// down to: at least one task is waiting on the person's answer.
function hasWaitingTask(tasks: readonly Pick<RunTask, "state">[]): boolean {
  return tasks.some((task) => task.state === "waiting");
}

// The tasks the run never reached. The launcher marks these failed ("The run ended before reaching this one")
// so the applications are free to be queued again.
export function tasksLeftPending<T extends Pick<RunTask, "state">>(tasks: readonly T[]): T[] {
  return tasks.filter((task) => task.state === "pending");
}
