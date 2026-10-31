// The work-queue loop that tailor and answers runs share: ask the server for the next application,
// handle it, report how it ended, repeat until the queue is empty. Also the optional "ask the person
// first" step that FAKE_CLAUDE_ASK_FIRST switches on.
// Spec: ARCHITECTURE.md section 9 (next_task, complete_task, ask_person) and decision D17.
import type { Answer, TaskOutcome } from "@jobgoblin/schemas";
import type { ScriptSession } from "./session";

export type TaskResult = { outcome: TaskOutcome; note?: string };
export type TaskCounts = Record<TaskOutcome, number>;

// A queue holds at most 25 tailored resumes a day; this only stops a server that never empties its queue.
const MAX_TASKS_PER_RUN = 100;

export async function workThroughTasks(
  session: ScriptSession,
  handleTask: (applicationId: string, isFirstTask: boolean) => Promise<TaskResult>,
): Promise<TaskCounts> {
  const counts: TaskCounts = { done: 0, failed: 0, waiting: 0 };

  for (let taskNumber = 1; taskNumber <= MAX_TASKS_PER_RUN; taskNumber += 1) {
    const { applicationId } = await session.callForData("next_task", {});
    if (applicationId === null) return counts;

    const result = await handleTask(applicationId, taskNumber === 1);
    await session.callForData("complete_task", {
      applicationId,
      outcome: result.outcome,
      note: result.note,
    });
    counts[result.outcome] += 1;
  }

  throw new Error(`next_task still returned an application after ${MAX_TASKS_PER_RUN} tasks.`);
}

// With FAKE_CLAUDE_ASK_FIRST=1, asks `question` about the first application of the run and returns true,
// and the caller reports the task as "waiting". It asks only when nothing has been answered yet: once the
// person answers, the application is queued again, and asking again would never end.
export async function askPersonIfSwitchedOn(
  session: ScriptSession,
  ask: { applicationId: string; isFirstTask: boolean; answeredQuestions: Answer[]; question: string },
): Promise<boolean> {
  const shouldAsk = session.settings.askFirst && ask.isFirstTask && ask.answeredQuestions.length === 0;
  if (!shouldAsk) return false;

  await session.callForData("ask_person", { applicationId: ask.applicationId, question: ask.question });
  return true;
}

export function summariseTaskCounts(counts: TaskCounts, doneLabel: string): string {
  return `${counts.done} ${doneLabel}, ${counts.waiting} waiting for an answer, ${counts.failed} failed.`;
}
