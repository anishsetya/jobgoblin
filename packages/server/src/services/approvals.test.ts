import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileSha256, getApplication, getApprovedPdf, getLiveApproval, listHistoryEvents, listRunsByStatus } from "@jobgoblin/storage";
import { getApplicationDetail } from "./applicationDetail";
import { approveApplication } from "./approvals";
import { getProfile, updateProfileSection } from "./profile";
import { anApplicationAwaitingApproval, closeTestContexts, createTestContext } from "./testSupport";
import type { ServerContext } from "../context";

afterEach(closeTestContexts);

async function approve(ctx: ServerContext, applicationId: string, hash?: string) {
  const dataSheetHash = hash ?? getApplicationDetail(ctx, applicationId).dataSheetHash ?? "";
  return approveApplication(ctx, { applicationId, dataSheetHash, submitMode: "manual" });
}

function changeContact(ctx: ServerContext, changes: Partial<ReturnType<typeof getProfile>["profile"]["contact"]>): void {
  const contact = getProfile(ctx).profile.contact;
  updateProfileSection(ctx, "contact", { ...contact, ...changes });
}

describe("approveApplication", () => {
  it("refuses when the details changed since the person looked at the page", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);
    const hashTheyAreSeeing = getApplicationDetail(ctx, applicationId).dataSheetHash ?? "";
    const employment = getProfile(ctx).profile.employment;
    updateProfileSection(ctx, "employment", { ...employment, noticePeriod: "4 weeks" });

    await expect(approve(ctx, applicationId, hashTheyAreSeeing)).rejects.toMatchObject({ code: "data-sheet-changed" });
    expect(getApplication(ctx.db, applicationId)?.status).toBe("Awaiting approval");
  });

  it("refuses and names the required details that are still missing", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);
    changeContact(ctx, { phone: "TODO" });

    await expect(approve(ctx, applicationId)).rejects.toMatchObject({
      code: "missing-values",
      message: expect.stringContaining("Phone number"),
    });
  });

  it("refuses a banned word in the person's own details", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);
    changeContact(ctx, { portfolio: "ninja-portfolio.example.com" });

    await expect(approve(ctx, applicationId)).rejects.toMatchObject({ code: "banned-in-data-sheet" });
  });

  it("refuses when the person has not chosen a folder", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);
    ctx.folder = null;

    await expect(approve(ctx, applicationId)).rejects.toMatchObject({ code: "no-person-folder" });
  });

  it("approves: the application is Approved with a live approval", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);

    const application = await approve(ctx, applicationId);

    expect(application.status).toBe("Approved");
    expect(getLiveApproval(ctx.db, applicationId)).toMatchObject({ applicationId, submitMode: "manual" });
    expect(listHistoryEvents(ctx.db, applicationId).map((event) => event.type)).toContain("approved");
  });

  it("freezes the PDF bytes in the database and writes the files with the same fingerprint", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);

    const application = await approve(ctx, applicationId);

    const approval = getLiveApproval(ctx.db, applicationId);
    const frozen = getApprovedPdf(ctx.db, applicationId, application.resumeVersion ?? "");
    expect(frozen?.pdfSha256).toBe(approval?.pdfSha256);

    const folder = ctx.folder;
    const copy = folder?.absolutePath(`${application.folder}/Alex Rivera - Resume.pdf`) ?? "";
    expect(fileSha256(copy)).toBe(approval?.pdfSha256);
    expect(fs.existsSync(path.join(folder?.root ?? "", application.folder ?? "", "Job description.md"))).toBe(true);
    const savedResumes = fs.readdirSync(path.join(folder?.root ?? "", "Resumes"));
    expect(savedResumes).toHaveLength(1);
  });

  it("queues an answers run for the application", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);

    await approve(ctx, applicationId);

    const queued = listRunsByStatus(ctx.db, ["queued"]);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.kind).toBe("answers");
  });

  it("voids the approval when the profile changes, and approves again without moving the status", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);
    const first = await approve(ctx, applicationId);
    const firstApproval = getLiveApproval(ctx.db, applicationId);
    const employment = getProfile(ctx).profile.employment;

    updateProfileSection(ctx, "employment", { ...employment, noticePeriod: "4 weeks" });

    expect(getLiveApproval(ctx.db, applicationId)).toBeNull();
    const voidedDetail = getApplicationDetail(ctx, applicationId);
    expect(voidedDetail.approval?.voidedAt).not.toBeNull();
    expect(voidedDetail.actions.canApprove).toBe(true);
    expect(voidedDetail.actions.canMarkSubmitted).toBe(false);

    const second = await approve(ctx, applicationId);

    expect(second.status).toBe("Approved");
    const types = listHistoryEvents(ctx.db, applicationId).map((event) => event.type);
    expect(types).toEqual(expect.arrayContaining(["approval-voided", "re-approved"]));
    const secondApproval = getLiveApproval(ctx.db, applicationId);
    expect(secondApproval?.id).not.toBe(firstApproval?.id);
    // Nothing on the resume changed, so the file is the very same one.
    expect(secondApproval?.pdfSha256).toBe(firstApproval?.pdfSha256);
    expect(second.resumeVersion).toBe(first.resumeVersion);
    expect(listRunsByStatus(ctx.db, ["queued"])).toHaveLength(1);
  });

  it("makes a new resume version when the contact details at the top change", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);
    const first = await approve(ctx, applicationId);
    const firstApproval = getLiveApproval(ctx.db, applicationId);

    changeContact(ctx, { phone: "+1 555 0199" });
    const second = await approve(ctx, applicationId);

    expect(second.resumeVersion).not.toBe(first.resumeVersion);
    expect(getLiveApproval(ctx.db, applicationId)?.pdfSha256).not.toBe(firstApproval?.pdfSha256);
  });

  it("refuses to approve an application that is not awaiting approval", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);
    await approve(ctx, applicationId);

    await expect(approve(ctx, applicationId)).rejects.toMatchObject({ code: "not-approvable" });
  });
});
