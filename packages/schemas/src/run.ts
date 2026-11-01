// Runs: one background Claude Code session started by a button. This file holds the run record,
// the work queue inside it, the questions a run asks the person, the request that starts a hunt,
// and each run kind's fixed settings.
// Spec: "Runner". ARCHITECTURE.md sections 5.8 and 10.
import { z } from "zod";

export const RunKind = z.enum(["setup", "hunt", "paste", "tailor", "answers", "ask"]);
export type RunKind = z.infer<typeof RunKind>;

// "cancelled" is its own end state so a cancel never looks like a failure (decision D11).
// "waiting" means every remaining task in the run is waiting on the person.
export const RunStatus = z.enum([
  "queued",
  "running",
  "waiting",
  "done",
  "failed",
  "blocked",
  "interrupted",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatus>;

// Which Claude model a run uses. The runner passes it as `--model`.
export const ModelTier = z.enum(["haiku", "sonnet", "opus"]);
export type ModelTier = z.infer<typeof ModelTier>;

// What a run was started for. It goes into the run's playbook (line 2, decision D6) and is stored
// with the run, so a retry or a restart starts it with the same input.
//   paste: jobId        tailor: editNote (when the person asked for an edit)
//   ask: applicationId and question
// Which applications a run works through is not here: each one is a RunTask.
export const RunInput = z.object({
  jobId: z.string().optional(),
  applicationId: z.string().optional(),
  question: z.string().optional(),
  editNote: z.string().optional(),
});
export type RunInput = z.infer<typeof RunInput>;

export const Run = z.object({
  id: z.string(),
  kind: RunKind,
  status: RunStatus,
  model: ModelTier,
  input: RunInput,
  sessionId: z.string().nullable(), // Claude Code's session id, from the stream's init line
  pid: z.number().int().nullable(), // the process id, kept so a restart can stop a leftover process
  step: z.string().nullable(), // plain words for the run card, such as "Checking every bullet"
  progressDone: z.number().int().nonnegative(),
  progressTotal: z.number().int().nonnegative().nullable(), // null while the total is unknown
  outcomeMessage: z.string().nullable(), // plain words for the card once the run has ended
  resultText: z.string().nullable(), // the answer of an ask run
  retryOf: z.string().nullable(), // the run this one retries
  queuedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  dismissedAt: z.iso.datetime().nullable(), // set when the person clears a finished run's card from Today
});
export type Run = z.infer<typeof Run>;

// One application inside a run's work queue. A tailor run has one task per application to tailor.
// "waiting" means the application has an open question for the person; the run moves on to the next task.
export const RunTaskState = z.enum(["pending", "done", "failed", "waiting"]);
export type RunTaskState = z.infer<typeof RunTaskState>;

export const RunTask = z.object({
  runId: z.string(),
  applicationId: z.string(),
  state: RunTaskState,
  note: z.string().nullable(), // the run's short note from complete_task, especially when it failed
});
export type RunTask = z.infer<typeof RunTask>;

// A question a run asked about one application. It never changes the application's status: an open
// question only makes the run skip that application and adds a Needs you item (decision D17).
// Answering it queues that one application again, in a run of the same kind (`runKind`).
export const Question = z.object({
  id: z.string(),
  runId: z.string(),
  runKind: RunKind,
  applicationId: z.string(),
  text: z.string(),
  answer: z.string().nullable(),
  askedAt: z.iso.datetime(),
  answeredAt: z.iso.datetime().nullable(),
});
export type Question = z.infer<typeof Question>;

// The only run the dashboard starts directly with POST /api/runs. The others start from their own
// routes: import resume (setup), add a job (paste), tailor and request edit (tailor), approve
// (answers), and ask about an application (ask).
export const StartRunRequest = z.object({
  kind: z.literal("hunt"),
});
export type StartRunRequest = z.infer<typeof StartRunRequest>;

// The only built-in Claude Code tools any run may have. Bash and PowerShell are never available.
// "Agent" lets the hunt run start its screener subagent.
export type BuiltInTool = "WebSearch" | "WebFetch" | "Agent";

export type RunKindSettings = {
  model: ModelTier;
  maxTurns: number;
  timeoutMinutes: number;
  builtInTools: readonly BuiltInTool[]; // passed as `--tools`; an empty list means none
};

// The fixed settings of each run kind, from the runner table. Data only: packages/server turns these
// into command-line flags.
//   hunt:   the model is the main one; its screener subagent runs on haiku.
//   tailor: starts on haiku. The one retry run, after drafts fail every check, is started on sonnet.
export const RUN_KIND_SETTINGS: Record<RunKind, RunKindSettings> = {
  setup: { model: "sonnet", maxTurns: 40, timeoutMinutes: 10, builtInTools: [] },
  hunt: {
    model: "sonnet",
    maxTurns: 120,
    timeoutMinutes: 30,
    builtInTools: ["WebSearch", "WebFetch", "Agent"],
  },
  paste: { model: "haiku", maxTurns: 15, timeoutMinutes: 5, builtInTools: [] },
  tailor: { model: "haiku", maxTurns: 80, timeoutMinutes: 20, builtInTools: [] },
  answers: { model: "sonnet", maxTurns: 30, timeoutMinutes: 10, builtInTools: [] },
  ask: { model: "sonnet", maxTurns: 20, timeoutMinutes: 5, builtInTools: [] },
};
