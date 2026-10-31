import { afterEach, describe, expect, it } from "vitest";
import { ApplicationDetail } from "@jobgoblin/schemas";
import { getRun, updateRun } from "@jobgoblin/storage";
import { getApplicationDetail } from "./applicationDetail";
import { listAskResults, startAsk } from "./askRuns";
import { getApplicationForRun, getPipelineSummary, listReady } from "./askReadModels";
import { approveApplication } from "./approvals";
import { skipApplication } from "./decisions";
import { listPipeline } from "./pipeline";
import { recoverInterruptedRuns } from "./runRecovery";
import { startHunt } from "./runs";
import { aScoredApplication, anApplicationAwaitingApproval, closeTestContexts, createTestContext } from "./testSupport";

afterEach(closeTestContexts);

describe("getApplicationDetail", () => {
  it("fits the ApplicationDetail schema for a scored application with no resume yet", () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);

    const detail = ApplicationDetail.parse(getApplicationDetail(ctx, applicationId));

    expect(detail).toMatchObject({ resume: null, dataSheet: null, dataSheetHash: null, diff: null, approval: null });
    expect(detail.actions).toMatchObject({ canTailor: true, canSkip: true, canApprove: false, canAsk: true });
    expect(detail.storyItems.map((item) => item.id)).toEqual(["ach-northwind-tracking-api"]);
  });

  it("shows a resume awaiting approval with its data sheet, hash, diff and the stories it cites", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);

    const detail = ApplicationDetail.parse(getApplicationDetail(ctx, applicationId));

    expect(detail.resume?.versionId).toBe(detail.application.resumeVersion);
    expect(detail.resumeHeader).toMatchObject({ fullName: "Alex Rivera", email: "alex.rivera@example.com" });
    expect(detail.dataSheet?.fields.find((field) => field.key === "expectedBase")).toMatchObject({ missing: true });
    expect(detail.dataSheetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(detail.diff).toEqual({ added: [], removed: [], reordered: false, reworded: [] });
    expect(detail.storyItems.length).toBeGreaterThan(10);
    expect(detail.actions).toMatchObject({ canApprove: true, canRequestEdit: true, canSkip: true, canMarkSubmitted: false });
    expect(detail.allowedStatusMoves).toEqual([]);
  });

  it("offers only the status moves the person may make", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);
    const dataSheetHash = getApplicationDetail(ctx, applicationId).dataSheetHash ?? "";
    await approveApplication(ctx, { applicationId, dataSheetHash, submitMode: "manual" });

    const detail = getApplicationDetail(ctx, applicationId);

    expect(detail.allowedStatusMoves).toEqual([]);
    expect(detail.actions).toMatchObject({ canMarkSubmitted: true, canApprove: false, canWithdraw: true });
    expect(detail.approval?.dataSheetHash).toBe(dataSheetHash);
  });

  it("says an application with a run in progress cannot be asked about or tailored", () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);
    startAsk(ctx, applicationId, "Why is this a good fit?");

    expect(getApplicationDetail(ctx, applicationId).actions).toMatchObject({ canAsk: false, canTailor: false });
  });

  it("includes the answers of finished ask runs", () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);
    const run = startAsk(ctx, applicationId, "Why is this a good fit?");
    updateRun(ctx.db, run.id, { status: "done", endedAt: "2026-10-31T15:00:00.000Z", resultText: "It matches your Python work." });

    expect(listAskResults(ctx, applicationId)).toEqual([
      { question: "Why is this a good fit?", answer: "It matches your Python work.", at: "2026-10-31T15:00:00.000Z" },
    ]);
    expect(getApplicationDetail(ctx, applicationId).askResults).toHaveLength(1);
  });

  it("says plainly when the application does not exist", () => {
    const ctx = createTestContext();

    expect(() => getApplicationDetail(ctx, "nope")).toThrowError(expect.objectContaining({ code: "not-found" }));
  });
});

describe("the pipeline and the read models for an ask run", () => {
  it("lists the pipeline with the job's location and region, filtered by status", () => {
    const ctx = createTestContext();
    const skipped = aScoredApplication(ctx);
    skipApplication(ctx, skipped);
    aScoredApplication(ctx, { jobId: "greenhouse:acmecloud:1002", title: "Platform Engineer" });

    const rows = listPipeline(ctx, { status: ["Scored"] });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Platform Engineer", location: "Remote - US", region: "US", overdue: false });
  });

  it("summarises the pipeline with a count for every status", () => {
    const ctx = createTestContext();
    aScoredApplication(ctx);

    const summary = getPipelineSummary(ctx);

    expect(Object.keys(summary.counts)).toHaveLength(20);
    expect(summary.counts).toMatchObject({ Scored: 1, Applied: 0 });
    expect(summary.rows).toMatchObject([{ company: "Acme Cloud", status: "Scored", fitScore: 86 }]);
  });

  it("lists the applications awaiting approval", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);

    expect(listReady(ctx).applications).toEqual([
      { applicationId, company: "Acme Cloud", title: "Backend Engineer", fitScore: 86, band: "apply" },
    ]);
  });

  it("gives an ask run the application without any personal value", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);

    const application = getApplicationForRun(ctx, applicationId);

    expect(application.job).toMatchObject({ company: "Acme Cloud", location: "Remote - US" });
    expect(application.resume?.sections.experience.length).toBeGreaterThan(0);
    expect(application.history.length).toBeGreaterThan(0);
    const everything = JSON.stringify(application);
    for (const secret of ["alex.rivera@example.com", "555 0100"]) expect(everything).not.toContain(secret);
  });
});

describe("recoverInterruptedRuns", () => {
  it("marks a run that was going as interrupted and leaves queued and waiting runs alone", () => {
    const ctx = createTestContext();
    const going = startHunt(ctx);
    updateRun(ctx.db, going.id, { status: "running", pid: 4242 });
    const applicationId = aScoredApplication(ctx);
    const asking = startAsk(ctx, applicationId, "Question?");

    expect(recoverInterruptedRuns(ctx)).toBe(1);

    expect(getRun(ctx.db, going.id)).toMatchObject({ status: "interrupted", outcomeMessage: "This run was interrupted", pid: null });
    expect(getRun(ctx.db, asking.id)?.status).toBe("queued");
  });
});
