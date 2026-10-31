import { afterEach, describe, expect, it } from "vitest";
import { getApplication, getApplicationByJobId, getFit, getJob, listHistoryEvents } from "@jobgoblin/storage";
import { readRubric, rubricVersionOf, UNVERSIONED_RUBRIC } from "./fitRubric";
import { getFitContext, recordFit } from "./fits";
import { aFitInput, anInsertedJob, closeTestContexts, createTestContext } from "./testSupport";

afterEach(closeTestContexts);

function recordedApplication(ctx: ReturnType<typeof createTestContext>, jobId: string) {
  const application = getApplicationByJobId(ctx.db, jobId);
  if (application === null) throw new Error("expected an application");
  return application;
}

describe("recordFit", () => {
  it("creates the application, scores it and leaves a strong match as Scored", () => {
    const ctx = createTestContext();
    const job = anInsertedJob(ctx);

    const outcome = recordFit(ctx, aFitInput(job.jobId, { score: 86 }));

    expect(outcome).toMatchObject({ ok: true, value: { band: "apply", status: "Scored" } });
    const application = outcome.ok ? getApplication(ctx.db, outcome.value.applicationId) : null;
    expect(application).toMatchObject({ jobId: job.jobId, status: "Scored", fitScore: 86, band: "apply" });
  });

  it("logs the application's creation and each move in the history", () => {
    const ctx = createTestContext();
    const job = anInsertedJob(ctx);

    const outcome = recordFit(ctx, aFitInput(job.jobId, { score: 55 }));

    const applicationId = outcome.ok ? outcome.value.applicationId : "";
    const moves = listHistoryEvents(ctx.db, applicationId).map((event) => `${event.actor}: ${event.from} -> ${event.to}`);
    expect(moves).toEqual(["server: null -> Found", "run: Found -> Scored", "server: Scored -> Long shot"]);
  });

  it("moves a long shot score (50 to 59) to Long shot", () => {
    const ctx = createTestContext();
    const job = anInsertedJob(ctx);

    const outcome = recordFit(ctx, aFitInput(job.jobId, { score: 55 }));

    expect(outcome).toMatchObject({ ok: true, value: { band: "long-shot", status: "Long shot" } });
  });

  it("moves a score under 50 to Skipped (low fit)", () => {
    const ctx = createTestContext();
    const job = anInsertedJob(ctx);

    const outcome = recordFit(ctx, aFitInput(job.jobId, { score: 20 }));

    expect(outcome).toMatchObject({ ok: true, value: { band: "skip", status: "Skipped (low fit)" } });
  });

  it("records score 0 for a hard skip, whatever score the run gave", () => {
    const ctx = createTestContext();
    const job = anInsertedJob(ctx);

    const outcome = recordFit(ctx, aFitInput(job.jobId, { score: 90, hardSkip: "An active security clearance is required" }));

    expect(outcome).toMatchObject({ ok: true, value: { band: "skip", status: "Skipped (low fit)" } });
    const applicationId = outcome.ok ? outcome.value.applicationId : "";
    expect(getFit(ctx.db, applicationId)).toMatchObject({ score: 0, band: "skip" });
  });

  it("marks the job as seen so it is never shown again", () => {
    const ctx = createTestContext();
    const job = anInsertedJob(ctx);

    recordFit(ctx, aFitInput(job.jobId));

    expect(getJob(ctx.db, job.jobId)?.seenAt).not.toBeNull();
  });

  it("refuses a job that was already scored", () => {
    const ctx = createTestContext();
    const job = anInsertedJob(ctx);
    recordFit(ctx, aFitInput(job.jobId));

    const second = recordFit(ctx, aFitInput(job.jobId, { score: 40 }));

    expect(second).toMatchObject({ ok: false, errors: [{ code: "already-scored" }] });
    expect(recordedApplication(ctx, job.jobId)).toMatchObject({ status: "Scored", fitScore: 86 });
  });

  it("refuses a job id that does not exist", () => {
    const ctx = createTestContext();

    const outcome = recordFit(ctx, aFitInput("greenhouse:nobody:1"));

    expect(outcome).toMatchObject({ ok: false, errors: [{ code: "unknown-job" }] });
  });
});

describe("the rubric version", () => {
  it("is read from the first line of playbooks/rubric.md and saved with the fit", () => {
    const ctx = createTestContext();
    const job = anInsertedJob(ctx);

    recordFit(ctx, aFitInput(job.jobId));

    expect(rubricVersionOf("<!-- rubric-version: 7 -->\n# Fit rubric")).toBe("7");
    expect(rubricVersionOf("# A rubric with no version line")).toBe(UNVERSIONED_RUBRIC);
    expect(readRubric(ctx).version).toBe("1");
    expect(getFit(ctx.db, recordedApplication(ctx, job.jobId).id)?.rubricVersion).toBe("1");
  });
});

describe("getFitContext", () => {
  it("gives the rubric, the targets and every confirmed story item", () => {
    const ctx = createTestContext();

    const context = getFitContext(ctx);

    expect(context.rubric.length).toBeGreaterThan(10);
    expect(context.targets.roles).toContain("Backend Engineer");
    expect(context.storyItems.length).toBe(22);
    expect(context.storyItems.every((item) => item.status === "confirmed")).toBe(true);
  });
});
