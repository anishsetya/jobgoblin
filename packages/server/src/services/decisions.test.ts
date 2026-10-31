import { afterEach, describe, expect, it } from "vitest";
import { CoreError } from "@jobgoblin/core";
import { getApplication, getLiveApproval } from "@jobgoblin/storage";
import { getApplicationDetail } from "./applicationDetail";
import { approveApplication } from "./approvals";
import { changeStatus, skipApplication, undoSkip, withdrawApplication } from "./decisions";
import { updateStatusFromRun } from "./statusForRuns";
import { markSubmitted } from "./submissions";
import { aScoredApplication, anApplicationAwaitingApproval, closeTestContexts, createTestContext } from "./testSupport";
import type { ServerContext } from "../context";

afterEach(closeTestContexts);

async function appliedApplication(ctx: ServerContext): Promise<string> {
  const applicationId = await anApplicationAwaitingApproval(ctx);
  const dataSheetHash = getApplicationDetail(ctx, applicationId).dataSheetHash ?? "";
  await approveApplication(ctx, { applicationId, dataSheetHash, submitMode: "manual" });
  markSubmitted(ctx, { applicationId, proofType: "person-saw-it", proof: "", attachedSha256: null });
  return applicationId;
}

describe("skip and undo skip", () => {
  it("skips an application awaiting approval and undoes it back to Awaiting approval", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);

    expect(skipApplication(ctx, applicationId).status).toBe("Skipped");
    expect(getApplicationDetail(ctx, applicationId).actions.canUndoSkip).toBe(true);

    expect(undoSkip(ctx, applicationId).status).toBe("Awaiting approval");
  });

  it("undoes a skip of a scored application back to Scored", () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);
    skipApplication(ctx, applicationId);

    expect(undoSkip(ctx, applicationId).status).toBe("Scored");
  });

  it("undoes a low-fit skip back to Scored", () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx, {}, { score: 20 });
    expect(getApplication(ctx.db, applicationId)?.status).toBe("Skipped (low fit)");

    expect(undoSkip(ctx, applicationId).status).toBe("Scored");
  });

  it("will not skip an application that has been approved", async () => {
    const ctx = createTestContext();
    const applicationId = await appliedApplication(ctx);

    expect(() => skipApplication(ctx, applicationId)).toThrowError(expect.objectContaining({ code: "not-skippable" }));
  });

  it("has nothing to undo for an application that was not skipped", () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);

    expect(() => undoSkip(ctx, applicationId)).toThrowError(expect.objectContaining({ code: "not-skipped" }));
  });
});

describe("changeStatus", () => {
  it("records what happened after applying and sets the follow-up day", async () => {
    const ctx = createTestContext();
    const applicationId = await appliedApplication(ctx);

    const application = changeStatus(ctx, applicationId, { to: "OA", followUpOn: "2026-11-20", note: "Online test sent" });

    expect(application).toMatchObject({ status: "OA", followUpOn: "2026-11-20" });
  });

  it("can never reach Applied or Approved, whatever the status", async () => {
    const ctx = createTestContext();
    const awaiting = await anApplicationAwaitingApproval(ctx);

    expect(() => changeStatus(ctx, awaiting, { to: "Applied" })).toThrowError(CoreError);
    expect(() => changeStatus(ctx, awaiting, { to: "Approved" })).toThrowError(CoreError);
    expect(getApplication(ctx.db, awaiting)?.status).toBe("Awaiting approval");
  });

  it("refuses a move the state machine does not have", async () => {
    const ctx = createTestContext();
    const applicationId = await appliedApplication(ctx);

    expect(() => changeStatus(ctx, applicationId, { to: "Offer" })).toThrowError(CoreError);
  });
});

describe("updateStatusFromRun", () => {
  it("lets a run record a later stage but returns a refusal when it tries to approve", async () => {
    const ctx = createTestContext();
    const applied = await appliedApplication(ctx);
    const awaiting = await anApplicationAwaitingApproval(ctx, { jobId: "greenhouse:acmecloud:1002", title: "Platform Engineer" });

    expect(updateStatusFromRun(ctx, { applicationId: applied, to: "OA" })).toEqual({ ok: true, value: { status: "OA" } });
    expect(updateStatusFromRun(ctx, { applicationId: awaiting, to: "Approved" })).toMatchObject({
      ok: false,
      errors: [{ code: "not-allowed" }],
    });
    expect(getApplication(ctx.db, awaiting)?.status).toBe("Awaiting approval");
  });
});

describe("withdrawApplication", () => {
  it("withdraws an application and voids an approval that was still waiting", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);
    const dataSheetHash = getApplicationDetail(ctx, applicationId).dataSheetHash ?? "";
    await approveApplication(ctx, { applicationId, dataSheetHash, submitMode: "manual" });

    const application = withdrawApplication(ctx, applicationId, "Took another offer");

    expect(application.status).toBe("Withdrawn");
    expect(getLiveApproval(ctx.db, applicationId)).toBeNull();
  });

  it("cannot withdraw an application that is already closed", () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);
    skipApplication(ctx, applicationId);

    expect(() => withdrawApplication(ctx, applicationId)).toThrowError(expect.objectContaining({ code: "not-withdrawable" }));
  });
});
