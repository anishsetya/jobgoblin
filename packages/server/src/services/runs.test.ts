import { afterEach, describe, expect, it } from "vitest";
import type { ServerEvent } from "@jobgoblin/schemas";
import { getRun, listRunTasks, listRunsByStatus, setRunTaskState, updateRun } from "@jobgoblin/storage";
import type { Launcher } from "../context";
import { askPerson } from "./questions";
import { cancelRun, dismissRun, queueRun, retryRun, startHunt } from "./runs";
import { assertApplicationInRun, completeTask, nextTask } from "./runTasks";
import { aScoredApplication, closeTestContexts, createTestContext } from "./testSupport";
import type { ServerContext } from "../context";

afterEach(closeTestContexts);

function tailorRun(ctx: ServerContext, applicationIds: string[], input = {}) {
  return queueRun(ctx, { kind: "tailor", applicationIds, input });
}

function recordedLauncher(): Launcher & { woken: number; cancelled: string[] } {
  const launcher = {
    woken: 0,
    cancelled: [] as string[],
    wake() {
      launcher.woken += 1;
    },
    async cancel(runId: string) {
      launcher.cancelled.push(runId);
    },
  };
  return launcher;
}

describe("queueRun", () => {
  it("saves a queued run with one task per application, the kind's model, and announces it", () => {
    const ctx = createTestContext();
    const [first, second] = [aScoredApplication(ctx), aScoredApplication(ctx, { jobId: "greenhouse:acmecloud:1002", title: "Platform Engineer" })];
    const events: ServerEvent[] = [];
    ctx.bus.subscribe((event) => events.push(event));

    const run = tailorRun(ctx, [first ?? "", second ?? ""]);

    expect(run).toMatchObject({ kind: "tailor", status: "queued", model: "haiku", progressDone: 0, progressTotal: 2 });
    expect(listRunTasks(ctx.db, run.id).map((task) => task.state)).toEqual(["pending", "pending"]);
    expect(events.some((event) => event.type === "run.updated" && event.run.id === run.id)).toBe(true);
  });

  it("wakes the launcher when there is one", () => {
    const ctx = createTestContext();
    const launcher = recordedLauncher();
    ctx.launcher = launcher;

    tailorRun(ctx, [aScoredApplication(ctx)]);

    expect(launcher.woken).toBe(1);
  });

  it("refuses an application that is already in an active run", () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);
    tailorRun(ctx, [applicationId]);

    expect(() => tailorRun(ctx, [applicationId])).toThrowError(expect.objectContaining({ code: "application-busy" }));
    expect(() => queueRun(ctx, { kind: "answers", applicationIds: [applicationId], input: {} })).toThrowError(
      expect.objectContaining({ code: "application-busy" }),
    );
  });

  it("also treats a paste run and an ask run as holding their application", () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);
    queueRun(ctx, { kind: "ask", applicationIds: [], input: { applicationId, question: "Why?" } });

    expect(() => tailorRun(ctx, [applicationId])).toThrowError(expect.objectContaining({ code: "application-busy" }));
  });

  it("lets one re-queued application join the queued run of the same kind", () => {
    const ctx = createTestContext();
    const first = tailorRun(ctx, [aScoredApplication(ctx)]);

    const joined = tailorRun(ctx, [aScoredApplication(ctx, { jobId: "greenhouse:acmecloud:1002", title: "Platform Engineer" })]);

    expect(joined.id).toBe(first.id);
    expect(listRunTasks(ctx.db, first.id)).toHaveLength(2);
    expect(getRun(ctx.db, first.id)?.progressTotal).toBe(2);
    expect(listRunsByStatus(ctx.db, ["queued"])).toHaveLength(1);
  });

  it("does not join a run with a different edit note", () => {
    const ctx = createTestContext();
    const first = tailorRun(ctx, [aScoredApplication(ctx)], { editNote: "Shorter" });

    const second = tailorRun(ctx, [aScoredApplication(ctx, { jobId: "greenhouse:acmecloud:1002", title: "Platform Engineer" })]);

    expect(second.id).not.toBe(first.id);
  });

  it("allows only one hunt at a time", () => {
    const ctx = createTestContext();
    startHunt(ctx);

    expect(() => startHunt(ctx)).toThrowError(expect.objectContaining({ code: "run-active" }));
  });

  it("will not start a hunt before setup is finished", () => {
    const ctx = createTestContext({ withAlexRivera: false });

    expect(() => startHunt(ctx)).toThrowError(expect.objectContaining({ code: "setup-incomplete" }));
  });
});

describe("cancel, retry and dismiss", () => {
  it("cancels a queued run in the database", async () => {
    const ctx = createTestContext();
    const run = startHunt(ctx);

    const cancelled = await cancelRun(ctx, run.id);

    expect(cancelled).toMatchObject({ status: "cancelled" });
    expect(cancelled.endedAt).not.toBeNull();
  });

  it("asks the launcher to stop a running run", async () => {
    const ctx = createTestContext();
    const launcher = recordedLauncher();
    ctx.launcher = launcher;
    const run = startHunt(ctx);
    updateRun(ctx.db, run.id, { status: "running", startedAt: ctx.now().toISOString() });

    await cancelRun(ctx, run.id);

    expect(launcher.cancelled).toEqual([run.id]);
    // The launcher did not record the end itself, so the server does.
    expect(getRun(ctx.db, run.id)?.status).toBe("cancelled");
  });

  it("will not cancel a run that has finished", async () => {
    const ctx = createTestContext();
    const run = startHunt(ctx);
    updateRun(ctx.db, run.id, { status: "done" });

    await expect(cancelRun(ctx, run.id)).rejects.toMatchObject({ code: "run-finished" });
  });

  it("retries the work that was left in a new run and clears the old card", () => {
    const ctx = createTestContext();
    const [done, left] = [aScoredApplication(ctx), aScoredApplication(ctx, { jobId: "greenhouse:acmecloud:1002", title: "Platform Engineer" })];
    const old = tailorRun(ctx, [done ?? "", left ?? ""]);
    setRunTaskState(ctx.db, { runId: old.id, applicationId: done ?? "", state: "done" });
    updateRun(ctx.db, old.id, { status: "failed" });

    const retried = retryRun(ctx, old.id);

    expect(retried).toMatchObject({ kind: "tailor", status: "queued", retryOf: old.id });
    expect(listRunTasks(ctx.db, retried.id).map((task) => task.applicationId)).toEqual([left]);
    expect(getRun(ctx.db, old.id)?.dismissedAt).not.toBeNull();
  });

  it("will not retry a run that finished well", () => {
    const ctx = createTestContext();
    const run = startHunt(ctx);
    updateRun(ctx.db, run.id, { status: "done" });

    expect(() => retryRun(ctx, run.id)).toThrowError(expect.objectContaining({ code: "run-not-retryable" }));
  });

  it("dismisses a finished run's card but not one that is going", () => {
    const ctx = createTestContext();
    const run = startHunt(ctx);

    expect(() => dismissRun(ctx, run.id)).toThrowError(expect.objectContaining({ code: "run-active" }));
    updateRun(ctx.db, run.id, { status: "failed" });
    expect(dismissRun(ctx, run.id).dismissedAt).not.toBeNull();
  });
});

describe("the tasks inside a run", () => {
  it("hands out applications in order and skips one that has an open question", () => {
    const ctx = createTestContext();
    const [first, second] = [aScoredApplication(ctx), aScoredApplication(ctx, { jobId: "greenhouse:acmecloud:1002", title: "Platform Engineer" })];
    const run = tailorRun(ctx, [first ?? "", second ?? ""]);
    updateRun(ctx.db, run.id, { status: "running" });

    expect(nextTask(ctx, run.id).applicationId).toBe(first);
    askPerson(ctx, { runId: run.id, applicationId: first ?? "", question: "Which city?" });

    expect(nextTask(ctx, run.id).applicationId).toBe(second);
  });

  it("counts finished tasks and reports progress", () => {
    const ctx = createTestContext();
    const [first, second] = [aScoredApplication(ctx), aScoredApplication(ctx, { jobId: "greenhouse:acmecloud:1002", title: "Platform Engineer" })];
    const run = tailorRun(ctx, [first ?? "", second ?? ""]);

    const outcome = completeTask(ctx, { runId: run.id, applicationId: first ?? "", outcome: "done" });

    expect(outcome).toEqual({ ok: true, value: { done: 1, total: 2 } });
    expect(getRun(ctx.db, run.id)).toMatchObject({ progressDone: 1, progressTotal: 2 });
  });

  it("accepts waiting only for an application that has an open question", () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);
    const run = tailorRun(ctx, [applicationId]);

    const without = completeTask(ctx, { runId: run.id, applicationId, outcome: "waiting" });
    askPerson(ctx, { runId: run.id, applicationId, question: "Which city?" });
    const withQuestion = completeTask(ctx, { runId: run.id, applicationId, outcome: "waiting" });

    expect(without).toMatchObject({ ok: false, errors: [{ code: "no-open-question" }] });
    expect(withQuestion).toEqual({ ok: true, value: { done: 0, total: 1 } });
  });

  it("refuses an application that is not part of the run", () => {
    const ctx = createTestContext();
    const inRun = aScoredApplication(ctx);
    const other = aScoredApplication(ctx, { jobId: "greenhouse:acmecloud:1002", title: "Platform Engineer" });
    const run = tailorRun(ctx, [inRun]);

    expect(() => assertApplicationInRun(ctx, run.id, other)).toThrowError(expect.objectContaining({ code: "not-in-this-run" }));
    expect(completeTask(ctx, { runId: run.id, applicationId: other, outcome: "done" })).toMatchObject({ ok: false });
  });
});
