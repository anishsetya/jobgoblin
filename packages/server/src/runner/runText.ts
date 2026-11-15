// The words the person reads about a run besides how it ended (OUTCOME_MESSAGES in outcome.ts): its name, the one
// next step that helps when it stopped, and why a queued run waits while a blocked run holds the queue.
// The names are the dashboard's own (common.json run.kind), so Needs you and the run card call a run the same
// thing. runText.test.ts compares the two lists.
// Spec: PRD R2 ("each problem names one action that can help"); ARCHITECTURE.md section 10 (Queue).
import type { Run, RunKind, RunNextStep } from "@jobgoblin/schemas";
import { OUTCOME_MESSAGES } from "./outcome";

export const RUN_TITLES: Record<RunKind, string> = {
  setup: "Reading your resume",
  hunt: "Finding jobs",
  paste: "Reading a job you added",
  tailor: "Tailoring resumes",
  answers: "Writing answers",
  ask: "Answering your question",
};

// Problems with Claude Code itself, which Settings can fix. A plan limit is not one of them: only time lifts it.
const FIXED_IN_SETTINGS: readonly string[] = [OUTCOME_MESSAGES.notInstalled, OUTCOME_MESSAGES.updateNeeded, OUTCOME_MESSAGES.signedOut];

export function nextStepFor(run: Pick<Run, "status" | "outcomeMessage">): RunNextStep {
  const fixedInSettings = run.status === "blocked" && FIXED_IN_SETTINGS.includes(run.outcomeMessage ?? "");
  return fixedInSettings ? "open-settings" : "try-again";
}

// For example: "Waiting for Finding jobs, which stopped: Your Claude plan limit is reached. It resets at 10:00 pm.
// Try that run again to go on."
export function waitingStep(blocked: Pick<Run, "kind" | "status" | "outcomeMessage">): string {
  const reason = asSentence(blocked.outcomeMessage ?? OUTCOME_MESSAGES.stopped);
  const whatHelps = nextStepFor(blocked) === "open-settings" ? "Open Settings to go on." : "Try that run again to go on.";
  return `Waiting for ${RUN_TITLES[blocked.kind]}, which stopped: ${reason} ${whatHelps}`;
}

function asSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
