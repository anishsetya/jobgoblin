// What the person can do with a run: start the hunt, cancel a run, retry one that stopped early, dismiss its card.
import { afterEach, describe, expect, it } from "vitest";
import { getRun, listRunTasks, setRunTaskState, updateRun } from "@jobgoblin/storage";
import type { Launcher } from "../context";
import { cancelRun, dismissRun, retryRun, startHunt } from "./runLifecycle";
import { queueRun } from "./runs";
import { aScoredApplication, closeTestContexts, createTestContext } from "./testSupport";

afterEach(closeTestContexts);

// A launcher that only remembers which runs it was asked to cancel.
function cancelRecordingLauncher(): Launcher & { cancelled: string[] } {
  const launcher = {
    cancelled: [] as string[],
    wake() {},
    async cancel(runId: string) {
      launcher.cancelled.push(runId);
    },
    resume() {},
  };
  return launcher;
}

describe("startHunt", () => {
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
    const launcher = cancelRecordingLauncher();
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
    const old = queueRun(ctx, { kind: "tailor", applicationIds: [done ?? "", left ?? ""], input: {} });
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
