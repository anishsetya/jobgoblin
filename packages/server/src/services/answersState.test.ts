// Where the answers stand, one test per state the Open application and Application screens can show.
// The answers run is played by calling the same services its tools call (complete_task, save_answers,
// ask_person); the run's own status is set the way the runner sets it when the process ends.
import { afterEach, describe, expect, it } from "vitest";
import type { AnswersState, Job, RunStatus, TaskOutcome } from "@jobgoblin/schemas";
import { findLatestRunTaskOfKind, updateRun } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { getApplicationDetail } from "./applicationDetail";
import { saveAnswers } from "./answers";
import { approveApplication } from "./approvals";
import { startAsk } from "./askRuns";
import { answerQuestion, askPerson } from "./questions";
import { completeTask } from "./runTasks";
import { anApplicationAwaitingApproval, closeTestContexts, createTestContext } from "./testSupport";

afterEach(closeTestContexts);

type Approved = { applicationId: string; answersRunId: string };

// Approves the application, which queues its answers run (the test job asks "Why Acme Cloud?" unless told otherwise).
async function approve(ctx: ServerContext, applicationId: string): Promise<void> {
  const dataSheetHash = getApplicationDetail(ctx, applicationId).dataSheetHash ?? "";
  await approveApplication(ctx, { applicationId, dataSheetHash, submitMode: "manual" });
}

async function anApprovedApplication(ctx: ServerContext, job: Partial<Job> = {}): Promise<Approved> {
  const applicationId = await anApplicationAwaitingApproval(ctx, job);
  await approve(ctx, applicationId);
  const answersRunId = findLatestRunTaskOfKind(ctx.db, applicationId, "answers")?.task.runId;
  if (answersRunId === undefined) throw new Error("Approve did not queue an answers run.");
  return { applicationId, answersRunId };
}

function completeTheTask(ctx: ServerContext, approved: Approved, outcome: TaskOutcome, note?: string): void {
  const outcomeOfCall = completeTask(ctx, { runId: approved.answersRunId, applicationId: approved.applicationId, outcome, note });
  expect(outcomeOfCall.ok).toBe(true);
}

function endTheRun(ctx: ServerContext, approved: Approved, status: RunStatus): void {
  updateRun(ctx.db, approved.answersRunId, { status, endedAt: ctx.now().toISOString() });
}

function answersStateOf(ctx: ServerContext, applicationId: string): AnswersState {
  return getApplicationDetail(ctx, applicationId).answersState;
}

describe("answersState", () => {
  it("is waiting-for-approval until the person approves", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);

    expect(answersStateOf(ctx, applicationId)).toBe("waiting-for-approval");
  });

  it("is being-written once Approve has queued the answers run, and while the run works", async () => {
    const ctx = createTestContext();
    const approved = await anApprovedApplication(ctx);

    expect(answersStateOf(ctx, approved.applicationId)).toBe("being-written");

    updateRun(ctx.db, approved.answersRunId, { status: "running" });
    expect(answersStateOf(ctx, approved.applicationId)).toBe("being-written");
  });

  it("is written once the run has saved the answers", async () => {
    const ctx = createTestContext();
    const approved = await anApprovedApplication(ctx);
    updateRun(ctx.db, approved.answersRunId, { status: "running" });

    const saved = saveAnswers(ctx, { applicationId: approved.applicationId, answers: [{ question: "Why Acme Cloud?", answer: "The API work." }] });
    completeTheTask(ctx, approved, "done");

    expect(saved).toEqual({ ok: true, value: { saved: 1 } });

    expect(answersStateOf(ctx, approved.applicationId)).toBe("written");
  });

  it("is no-questions when the run ends the task as done without answers, for a job with no questions", async () => {
    const ctx = createTestContext();
    const approved = await anApprovedApplication(ctx, { questions: [] });
    updateRun(ctx.db, approved.answersRunId, { status: "running" });

    completeTheTask(ctx, approved, "done", "No screening questions");
    endTheRun(ctx, approved, "done");

    expect(answersStateOf(ctx, approved.applicationId)).toBe("no-questions");
  });

  it("is not-written, never no-questions, when a run ends the task as done but skipped the job's questions", async () => {
    const ctx = createTestContext();
    const approved = await anApprovedApplication(ctx);
    updateRun(ctx.db, approved.answersRunId, { status: "running" });

    completeTheTask(ctx, approved, "done");

    expect(answersStateOf(ctx, approved.applicationId)).toBe("not-written");
  });

  it("is not-written when the run reports the task as failed", async () => {
    const ctx = createTestContext();
    const approved = await anApprovedApplication(ctx);
    updateRun(ctx.db, approved.answersRunId, { status: "running" });

    completeTheTask(ctx, approved, "failed", "The server refused the answers.");

    expect(answersStateOf(ctx, approved.applicationId)).toBe("not-written");
  });

  it("is not-written when the run ended before it reached the task", async () => {
    const ctx = createTestContext();
    const approved = await anApprovedApplication(ctx);

    for (const status of ["failed", "blocked", "interrupted", "cancelled"] as const) {
      endTheRun(ctx, approved, status);
      expect(answersStateOf(ctx, approved.applicationId), status).toBe("not-written");
    }
  });

  it("is waiting-for-answer while the run's question waits, and being-written again once the person answers", async () => {
    const ctx = createTestContext();
    const approved = await anApprovedApplication(ctx);
    updateRun(ctx.db, approved.answersRunId, { status: "running" });
    const asked = askPerson(ctx, { runId: approved.answersRunId, applicationId: approved.applicationId, question: "Anything to mention?" });
    if (!asked.ok) throw new Error("ask_person was refused.");
    completeTheTask(ctx, approved, "waiting");
    endTheRun(ctx, approved, "waiting");

    expect(answersStateOf(ctx, approved.applicationId)).toBe("waiting-for-answer");

    answerQuestion(ctx, asked.value.questionId, "Mention the API work.");
    expect(answersStateOf(ctx, approved.applicationId)).toBe("being-written");
  });

  it("is not-written when Approve could not queue the answers run, because an ask run held the application", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);
    startAsk(ctx, applicationId, "Why is this a good fit?");

    await approve(ctx, applicationId);

    expect(findLatestRunTaskOfKind(ctx.db, applicationId, "answers")).toBeNull();
    expect(answersStateOf(ctx, applicationId)).toBe("not-written");
  });
});
