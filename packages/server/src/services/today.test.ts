import { afterEach, describe, expect, it } from "vitest";
import { updateApplicationFields, updateRun } from "@jobgoblin/storage";
import { approveApplication } from "./approvals";
import { getApplicationDetail } from "./applicationDetail";
import { markSubmitted } from "./submissions";
import { getProfile, updateProfileSection } from "./profile";
import { changeStatus } from "./decisions";
import { startHunt } from "./runs";
import { getToday } from "./today";
import { aScoredApplication, anApplicationAwaitingApproval, advanceTime, closeTestContexts, createTestContext } from "./testSupport";
import type { ServerContext } from "../context";

afterEach(closeTestContexts);

const kindsOf = (ctx: ServerContext) => getToday(ctx).needsYou.map((item) => item.kind);

async function approve(ctx: ServerContext, applicationId: string) {
  const dataSheetHash = getApplicationDetail(ctx, applicationId).dataSheetHash ?? "";
  return approveApplication(ctx, { applicationId, dataSheetHash, submitMode: "manual" });
}

describe("getToday", () => {
  it("is empty for a fresh start, with setup complete and the usage notice unread", () => {
    const ctx = createTestContext();

    expect(getToday(ctx)).toEqual({
      needsYou: [],
      running: [],
      doneToday: { found: 0, tailored: 0, approved: 0, applied: 0 },
      setupComplete: true,
      usageNoticeSeen: false,
    });
  });

  it("asks for a review of a resume awaiting approval, with the application's id", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);

    const [item] = getToday(ctx).needsYou;

    expect(item).toMatchObject({ kind: "review", id: applicationId, applicationId, title: "Backend Engineer at Acme Cloud" });
    expect(item?.detail).toContain("Fit 86");
  });

  it("says an approved application is ready to submit, and asks for another look when details changed", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);
    await approve(ctx, applicationId);
    expect(kindsOf(ctx)).toEqual(["ready-to-submit"]);

    const employment = getProfile(ctx).profile.employment;
    updateProfileSection(ctx, "employment", { ...employment, noticePeriod: "8 weeks" });

    expect(getToday(ctx).needsYou).toMatchObject([{ kind: "review", detail: expect.stringContaining("details changed") }]);
  });

  it("lists a long shot, and a cap refusal as not tailored instead", () => {
    const ctx = createTestContext();
    const longShot = aScoredApplication(ctx, {}, { score: 55 });
    expect(kindsOf(ctx)).toEqual(["long-shot"]);

    updateApplicationFields(ctx.db, longShot, { tailorError: "You already have 3 open applications at Acme Cloud." }, ctx.now().toISOString());

    expect(getToday(ctx).needsYou).toMatchObject([{ kind: "not-tailored", detail: expect.stringContaining("3 open") }]);
  });

  it("lists a follow-up once its day has come", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);
    await approve(ctx, applicationId);
    markSubmitted(ctx, { applicationId, proofType: "person-saw-it", proof: "", attachedSha256: null });
    expect(kindsOf(ctx)).toEqual([]);

    advanceTime(ctx, 8 * 24 * 60 * 60 * 1000);

    expect(getToday(ctx).needsYou).toMatchObject([{ kind: "follow-up-due", id: applicationId }]);
  });

  it("shows a run that stopped as needing attention, with the run's id, until it is dismissed", () => {
    const ctx = createTestContext();
    const run = startHunt(ctx);
    updateRun(ctx.db, run.id, { status: "failed", endedAt: ctx.now().toISOString(), outcomeMessage: "Your Claude plan limit is reached" });

    const today = getToday(ctx);

    expect(today.needsYou).toMatchObject([{ kind: "run-attention", id: run.id, applicationId: null, runId: run.id, title: "Finding jobs" }]);
    expect(today.running.map((card) => card.id)).toEqual([run.id]);
  });

  it("shows queued and running runs as cards, and drops a finished one after a day", () => {
    const ctx = createTestContext();
    const run = startHunt(ctx);
    expect(getToday(ctx).running).toHaveLength(1);

    updateRun(ctx.db, run.id, { status: "done", endedAt: ctx.now().toISOString() });
    expect(getToday(ctx).running).toHaveLength(1);

    advanceTime(ctx, 25 * 60 * 60 * 1000);
    expect(getToday(ctx).running).toHaveLength(0);
  });

  it("counts what was found, tailored, approved and applied today", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);
    await approve(ctx, applicationId);
    markSubmitted(ctx, { applicationId, proofType: "person-saw-it", proof: "", attachedSha256: null });
    changeStatus(ctx, applicationId, { to: "OA" });

    expect(getToday(ctx).doneToday).toEqual({ found: 1, tailored: 1, approved: 1, applied: 1 });
  });
});
