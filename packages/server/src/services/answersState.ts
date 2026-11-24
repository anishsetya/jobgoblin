// Where the answers to one application's screening questions stand, for the Open application and Application
// screens. It is worked out here from the approval, the saved answers and the newest answers task, because
// an empty list alone cannot tell "being written" from "nothing to answer" or "the run failed".
// Spec: ARCHITECTURE.md sections 5.9 (ApplicationDetail.answersState) and 8.5.
import type { Answer, AnswersState, Approval, Job, RunStatus, RunTaskState } from "@jobgoblin/schemas";
import { findLatestRunTaskOfKind } from "@jobgoblin/storage";
import type { ServerContext } from "../context";

// A run in one of these may still reach its pending tasks; any other status means it has ended.
const STATUSES_THAT_MAY_STILL_WORK: readonly RunStatus[] = ["queued", "running", "waiting"];

export type AnswersFacts = {
  applicationId: string;
  job: Job;
  approval: Approval | null;
  answers: readonly Answer[];
};

export function answersStateOf(ctx: ServerContext, facts: AnswersFacts): AnswersState {
  if (facts.approval === null) return "waiting-for-approval";
  if (facts.answers.length > 0) return "written";

  // Approve queues the answers run. When that failed (it is logged in approvals.ts), no task exists.
  const latest = findLatestRunTaskOfKind(ctx.db, facts.applicationId, "answers");
  if (latest === null) return "not-written";
  return stateOfTask(latest.task.state, latest.runStatus, facts.job.questions.length > 0);
}

function stateOfTask(taskState: RunTaskState, runStatus: RunStatus, jobHasQuestions: boolean): AnswersState {
  switch (taskState) {
    case "pending":
      return STATUSES_THAT_MAY_STILL_WORK.includes(runStatus) ? "being-written" : "not-written";
    case "waiting":
      // complete_task refuses "waiting" without an open question, and answering it releases this task and
      // queues the application again (D8), so a waiting task always means the person's answer comes first.
      return "waiting-for-answer";
    case "done":
      // playbooks/answers.md ends a job with no questions as done without saving anything. A run that does
      // that for a job WITH questions skipped them, and "no questions" would not be true.
      return jobHasQuestions ? "not-written" : "no-questions";
    case "failed":
      return "not-written";
  }
}
