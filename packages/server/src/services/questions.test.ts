import { afterEach, describe, expect, it } from "vitest";
import { getApplication, getRun, listOpenQuestions, listRunTasks, listRunsByStatus, setRunTaskState, updateRun } from "@jobgoblin/storage";
import { getApplicationDetail } from "./applicationDetail";
import { askPerson, answerQuestion } from "./questions";
import { addPastedJob } from "./jobs";
import { startHunt } from "./runLifecycle";
import { queueRun } from "./runs";
import { getToday } from "./today";
import { aScoredApplication, closeTestContexts, createTestContext } from "./testSupport";
import type { ServerContext } from "../context";

afterEach(closeTestContexts);

// A tailor run that is going, with one application, which then asks a question and is set to waiting.
function runWithQuestion(ctx: ServerContext, input = {}) {
  const applicationId = aScoredApplication(ctx);
  const run = queueRun(ctx, { kind: "tailor", applicationIds: [applicationId], input });
  updateRun(ctx.db, run.id, { status: "running" });
  const asked = askPerson(ctx, { runId: run.id, applicationId, question: "Which city do you want?" });
  if (!asked.ok) throw new Error("the question was refused");
  setRunTaskState(ctx.db, { runId: run.id, applicationId, state: "waiting" });
  return { applicationId, run, questionId: asked.value.questionId };
}

describe("askPerson", () => {
  it("opens a question without changing the application's status", () => {
    const ctx = createTestContext();

    const { applicationId } = runWithQuestion(ctx);

    expect(getApplication(ctx.db, applicationId)?.status).toBe("Scored");
    expect(listOpenQuestions(ctx.db)).toHaveLength(1);
    expect(getApplicationDetail(ctx, applicationId).questions).toHaveLength(1);
  });

  it("shows the question in Needs you, with the question's own id", () => {
    const ctx = createTestContext();
    const { questionId } = runWithQuestion(ctx);

    const item = getToday(ctx).needsYou.find((candidate) => candidate.kind === "question");

    expect(item).toMatchObject({ id: questionId, detail: "Which city do you want?" });
  });

  it("allows only one open question per application", () => {
    const ctx = createTestContext();
    const { applicationId, run } = runWithQuestion(ctx);

    const second = askPerson(ctx, { runId: run.id, applicationId, question: "And your visa?" });

    expect(second).toMatchObject({ ok: false, errors: [{ code: "question-open" }] });
  });

  it("is not available to a hunt run", () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);
    const hunt = startHunt(ctx);

    expect(askPerson(ctx, { runId: hunt.id, applicationId, question: "Hello?" })).toMatchObject({
      ok: false,
      errors: [{ code: "may-not-ask" }],
    });
  });
});

describe("answerQuestion", () => {
  it("saves the answer and queues that one application in a new run of the same kind", () => {
    const ctx = createTestContext();
    const { applicationId, run, questionId } = runWithQuestion(ctx);

    const answered = answerQuestion(ctx, questionId, "Austin");

    expect(answered).toMatchObject({ answer: "Austin", answeredAt: expect.any(String) });
    const [queued] = listRunsByStatus(ctx.db, ["queued"]);
    expect(queued?.id).not.toBe(run.id);
    expect(queued).toMatchObject({ kind: "tailor", model: "haiku" });
    expect(listRunTasks(ctx.db, queued?.id ?? "").map((task) => task.applicationId)).toEqual([applicationId]);
    expect(listOpenQuestions(ctx.db)).toHaveLength(0);
  });

  it("lets the old run go: its task is finished and a run that only waited is done", () => {
    const ctx = createTestContext();
    const { applicationId, run, questionId } = runWithQuestion(ctx);
    updateRun(ctx.db, run.id, { status: "waiting" });

    answerQuestion(ctx, questionId, "Austin");

    expect(listRunTasks(ctx.db, run.id)[0]).toMatchObject({ applicationId, state: "done" });
    expect(getRun(ctx.db, run.id)?.status).toBe("done");
  });

  it("joins a tailor run that is already queued instead of making another", () => {
    const ctx = createTestContext();
    const { run, questionId } = runWithQuestion(ctx);
    const waitingOne = aScoredApplication(ctx, { jobId: "greenhouse:acmecloud:1002", title: "Platform Engineer" });
    const queued = queueRun(ctx, { kind: "tailor", applicationIds: [waitingOne], input: {} });

    answerQuestion(ctx, questionId, "Austin");

    expect(listRunsByStatus(ctx.db, ["queued"]).map((candidate) => candidate.id)).toEqual([queued.id]);
    expect(listRunTasks(ctx.db, queued.id)).toHaveLength(2);
    expect(run.id).not.toBe(queued.id);
  });

  it("carries the edit note over to the new run", () => {
    const ctx = createTestContext();
    const { questionId } = runWithQuestion(ctx, { editNote: "Lead with Go" });

    answerQuestion(ctx, questionId, "Austin");

    expect(listRunsByStatus(ctx.db, ["queued"])[0]?.input).toEqual({ editNote: "Lead with Go" });
  });

  it("starts the next paste run from the answer even while the run that asked is still finishing", async () => {
    const ctx = createTestContext();
    const pasted = await addPastedJob(ctx, { company: "Gridline Energy", title: "Backend Engineer", location: "Remote - US", text: "Python." });
    const pasteRunId = pasted.runId ?? "";
    updateRun(ctx.db, pasteRunId, { status: "running" });
    const asked = askPerson(ctx, { runId: pasteRunId, applicationId: pasted.applicationId ?? "", question: "Can you paste the whole posting?" });
    if (!asked.ok) throw new Error("the question was refused");

    answerQuestion(ctx, asked.value.questionId, "Here it is.");

    const [queued] = listRunsByStatus(ctx.db, ["queued"]);
    expect(queued).toMatchObject({ kind: "paste", input: { applicationId: pasted.applicationId } });
    expect(getRun(ctx.db, pasteRunId)?.status).toBe("running");
  });

  it("takes the first answer only", () => {
    const ctx = createTestContext();
    const { questionId } = runWithQuestion(ctx);
    answerQuestion(ctx, questionId, "Austin");

    expect(() => answerQuestion(ctx, questionId, "Denver")).toThrowError(expect.objectContaining({ code: "already-answered" }));
  });

  it("says plainly when the question does not exist", () => {
    const ctx = createTestContext();

    expect(() => answerQuestion(ctx, "nope", "Austin")).toThrowError(expect.objectContaining({ code: "not-found" }));
  });
});
