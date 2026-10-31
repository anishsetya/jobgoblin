import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { listAnswers } from "@jobgoblin/storage";
import { getApplicationDetail } from "./applicationDetail";
import { approveApplication } from "./approvals";
import { getApprovedForRun, saveAnswers } from "./answers";
import { anApplicationAwaitingApproval, closeTestContexts, createTestContext } from "./testSupport";
import type { ServerContext } from "../context";

afterEach(closeTestContexts);

async function approvedApplication(ctx: ServerContext): Promise<string> {
  const applicationId = await anApplicationAwaitingApproval(ctx);
  const dataSheetHash = getApplicationDetail(ctx, applicationId).dataSheetHash ?? "";
  await approveApplication(ctx, { applicationId, dataSheetHash, submitMode: "manual" });
  return applicationId;
}

describe("getApprovedForRun", () => {
  it("gives the data sheet with every personal value replaced by a placeholder", async () => {
    const ctx = createTestContext();
    const applicationId = await approvedApplication(ctx);

    const approved = getApprovedForRun(ctx, applicationId);

    const byKey = new Map(approved.dataSheet.fields.map((field) => [field.key, field.value]));
    expect(byKey.get("phone")).toBe("{phone}");
    expect(byKey.get("email")).toBe("{email}");
    expect(byKey.get("noticePeriod")).toBe("2 weeks");
    expect(approved.dataSheet.resumeFileName).toBe("{resumeFileName}");
    expect(approved.questions).toEqual(["Why Acme Cloud?"]);
    expect(approved.resume.sections.projects[0]?.bullets[0]?.text).toContain("Go");
    const everything = JSON.stringify(approved);
    for (const secret of ["alex.rivera@example.com", "555 0100", "Alex Rivera"]) expect(everything).not.toContain(secret);
  });

  it("refuses an application that was never approved", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);

    expect(() => getApprovedForRun(ctx, applicationId)).toThrowError(expect.objectContaining({ code: "not-approved" }));
  });
});

describe("saveAnswers", () => {
  it("keeps the placeholders in the database and writes the real values into Answers.md", async () => {
    const ctx = createTestContext();
    const applicationId = await approvedApplication(ctx);

    const outcome = saveAnswers(ctx, {
      applicationId,
      answers: [{ question: "Why Acme Cloud?", answer: "I would love to build APIs. Reach me at {email} or {phone}." }],
    });

    expect(outcome).toEqual({ ok: true, value: { saved: 1 } });
    expect(listAnswers(ctx.db, applicationId)[0]?.answer).toContain("{email}");

    const detail = getApplicationDetail(ctx, applicationId);
    const answersFile = ctx.folder?.absolutePath(`${detail.application.folder}/Answers.md`) ?? "";
    const text = fs.readFileSync(answersFile, "utf8");
    expect(text).toContain("alex.rivera@example.com");
    expect(text).toContain("+1 555 0100");
    expect(text).not.toContain("{email}");
    expect(detail.answers[0]?.answer).toContain("alex.rivera@example.com");
  });

  it("leaves a placeholder alone while its value is still missing", async () => {
    const ctx = createTestContext();
    const applicationId = await approvedApplication(ctx);

    saveAnswers(ctx, { applicationId, answers: [{ question: "Salary?", answer: "I expect {expectedBase}." }] });

    const detail = getApplicationDetail(ctx, applicationId);
    expect(detail.answers[0]?.answer).toBe("I expect {expectedBase}.");
  });

  it("returns a banned word as an error and saves nothing", async () => {
    const ctx = createTestContext();
    const applicationId = await approvedApplication(ctx);

    const outcome = saveAnswers(ctx, { applicationId, answers: [{ question: "Why?", answer: "Because I am a rockstar." }] });

    expect(outcome).toMatchObject({ ok: false, errors: [{ code: "banned", path: "answers[0].answer" }] });
    expect(listAnswers(ctx.db, applicationId)).toEqual([]);
  });

  it("replaces the earlier set of answers", async () => {
    const ctx = createTestContext();
    const applicationId = await approvedApplication(ctx);
    saveAnswers(ctx, { applicationId, answers: [{ question: "One?", answer: "First." }] });

    saveAnswers(ctx, { applicationId, answers: [{ question: "Two?", answer: "Second." }] });

    expect(listAnswers(ctx.db, applicationId)).toEqual([{ question: "Two?", answer: "Second." }]);
  });
});
