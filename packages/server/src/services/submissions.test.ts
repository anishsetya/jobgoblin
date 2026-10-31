import { afterEach, describe, expect, it } from "vitest";
import { getApplication, getLiveApproval, getSubmissionForApplication } from "@jobgoblin/storage";
import { getApplicationDetail } from "./applicationDetail";
import { approveApplication } from "./approvals";
import { getProfile, updateProfileSection } from "./profile";
import { markSubmitted } from "./submissions";
import { anApplicationAwaitingApproval, closeTestContexts, createTestContext } from "./testSupport";
import type { ServerContext } from "../context";

afterEach(closeTestContexts);

const PROOF = { proofType: "pasted-text", proof: "Thank you for applying to Acme Cloud." } as const;

async function approvedApplication(ctx: ServerContext): Promise<string> {
  const applicationId = await anApplicationAwaitingApproval(ctx);
  const dataSheetHash = getApplicationDetail(ctx, applicationId).dataSheetHash ?? "";
  await approveApplication(ctx, { applicationId, dataSheetHash, submitMode: "manual" });
  return applicationId;
}

describe("markSubmitted", () => {
  it("moves the application to Applied with the proof and a follow-up day a week later", async () => {
    const ctx = createTestContext();
    const applicationId = await approvedApplication(ctx);
    const approval = getLiveApproval(ctx.db, applicationId);

    const submission = markSubmitted(ctx, { applicationId, ...PROOF, attachedSha256: approval?.pdfSha256 ?? null });

    const application = getApplication(ctx.db, applicationId);
    expect(application).toMatchObject({ status: "Applied", followUpOn: "2026-11-07" });
    expect(application?.appliedAt).toBe(submission.submittedAt);
    expect(getSubmissionForApplication(ctx.db, applicationId)).toMatchObject({ proofType: "pasted-text" });
    expect(getLiveApproval(ctx.db, applicationId)).toBeNull();
  });

  it("refuses when the attached file is not the approved one, unless the person confirms", async () => {
    const ctx = createTestContext();
    const applicationId = await approvedApplication(ctx);
    const otherFile = "f".repeat(64);

    expect(() => markSubmitted(ctx, { applicationId, ...PROOF, attachedSha256: otherFile })).toThrowError(
      expect.objectContaining({ code: "different-file" }),
    );
    expect(getApplication(ctx.db, applicationId)?.status).toBe("Approved");

    markSubmitted(ctx, { applicationId, ...PROOF, attachedSha256: otherFile, confirmDifferentFile: true });
    expect(getApplication(ctx.db, applicationId)?.status).toBe("Applied");
  });

  it("accepts a submission with no attached fingerprint", async () => {
    const ctx = createTestContext();
    const applicationId = await approvedApplication(ctx);

    markSubmitted(ctx, { applicationId, ...PROOF, attachedSha256: null });

    expect(getApplication(ctx.db, applicationId)?.status).toBe("Applied");
  });

  it("refuses when the approval was voided by a change of details", async () => {
    const ctx = createTestContext();
    const applicationId = await approvedApplication(ctx);
    const employment = getProfile(ctx).profile.employment;
    updateProfileSection(ctx, "employment", { ...employment, noticePeriod: "6 weeks" });

    expect(() => markSubmitted(ctx, { applicationId, ...PROOF, attachedSha256: null })).toThrowError(
      expect.objectContaining({ code: "approval-void" }),
    );
  });

  it("refuses an application that was never approved", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);

    expect(() => markSubmitted(ctx, { applicationId, ...PROOF, attachedSha256: null })).toThrowError(
      expect.objectContaining({ code: "not-submittable" }),
    );
  });

  it("asks for proof unless the person simply saw it", async () => {
    const ctx = createTestContext();
    const applicationId = await approvedApplication(ctx);

    expect(() =>
      markSubmitted(ctx, { applicationId, proofType: "pasted-text", proof: "  ", attachedSha256: null }),
    ).toThrowError(expect.objectContaining({ code: "proof-missing" }));
    markSubmitted(ctx, { applicationId, proofType: "person-saw-it", proof: "", attachedSha256: null });
    expect(getApplication(ctx.db, applicationId)?.status).toBe("Applied");
  });
});
