import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ResumeBody } from "@jobgoblin/schemas";
import { getApplication, getApplicationResume, listHistoryEvents } from "@jobgoblin/storage";
import { requestTailor } from "./tailoring";
import { submitResumeDraft } from "./resumes";
import {
  aScoredApplication,
  alexMasterBody,
  closeTestContexts,
  createTestContext,
} from "./testSupport";

afterEach(closeTestContexts);

// The master resume with the text of one bullet changed.
function withBulletText(src: string, text: string): ResumeBody {
  const body = alexMasterBody();
  for (const entry of body.sections.experience) {
    for (const bullet of entry.bullets) if (bullet.src === src) bullet.text = text;
  }
  return body;
}

describe("submitResumeDraft", () => {
  it("passes the master resume and moves the application to Awaiting approval", async () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);

    const outcome = await submitResumeDraft(ctx, { applicationId, body: alexMasterBody() });

    expect(outcome).toMatchObject({ ok: true, value: { status: "Awaiting approval" } });
    expect(getApplication(ctx.db, applicationId)).toMatchObject({ status: "Awaiting approval" });
  });

  it("saves the resume as a draft version for the application and logs it", async () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);

    const outcome = await submitResumeDraft(ctx, { applicationId, body: alexMasterBody() });

    const versionId = outcome.ok ? outcome.value.versionId : "";
    expect(getApplicationResume(ctx.db, applicationId, versionId)).toMatchObject({ state: "draft" });
    expect(getApplication(ctx.db, applicationId)?.resumeVersion).toBe(versionId);
    expect(listHistoryEvents(ctx.db, applicationId).map((event) => event.type)).toContain("resume-drafted");
  });

  it("keeps a preview PDF in the app data folder", async () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);

    const outcome = await submitResumeDraft(ctx, { applicationId, body: alexMasterBody() });

    const versionId = outcome.ok ? outcome.value.versionId : "";
    expect(fs.existsSync(path.join(ctx.appDataDir, "previews", `${versionId}.pdf`))).toBe(true);
  });

  it("returns an untraced bullet as a value, not an exception", async () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);
    const body = alexMasterBody();
    body.sections.experience[0]?.bullets.push({ src: "ach-made-up", text: "Invented a new database" });

    const outcome = await submitResumeDraft(ctx, { applicationId, body });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? [] : outcome.errors.map((error) => error.code)).toContain("untraced");
    expect(getApplication(ctx.db, applicationId)?.status).toBe("Scored");
  });

  it("returns an inflated verb as a value", async () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);
    const body = withBulletText("ach-northwind-oncall", "Led the on-call rotation and wrote 15 runbooks for incident response");

    const outcome = await submitResumeDraft(ctx, { applicationId, body });

    expect(outcome.ok ? [] : outcome.errors.map((error) => error.code)).toContain("inflated-verb");
  });

  it("reports every problem at once so the run can fix them in one go", async () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);
    const body = withBulletText("ach-northwind-oncall", "Led the on-call rotation as a ninja");
    body.sections.experience[0]?.bullets.push({ src: "ach-made-up", text: "Invented a new database" });

    const outcome = await submitResumeDraft(ctx, { applicationId, body });

    const codes = outcome.ok ? [] : outcome.errors.map((error) => error.code);
    expect(codes).toEqual(expect.arrayContaining(["untraced", "inflated-verb", "banned"]));
  });

  it("returns a body that is not a resume as schema errors", async () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);

    const outcome = await submitResumeDraft(ctx, { applicationId, body: { headline: "no" } });

    expect(outcome.ok ? [] : outcome.errors.map((error) => error.code)).toContain("schema");
  });

  it("refuses a long shot that the person did not ask to have tailored", async () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx, {}, { score: 55 });

    const outcome = await submitResumeDraft(ctx, { applicationId, body: alexMasterBody() });

    expect(outcome).toMatchObject({ ok: false, errors: [{ code: "tailor-not-requested" }] });
    expect(getApplication(ctx.db, applicationId)?.status).toBe("Long shot");
  });

  it("accepts a long shot once the person has clicked Tailor", async () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx, {}, { score: 55 });
    requestTailor(ctx, applicationId);

    const outcome = await submitResumeDraft(ctx, { applicationId, body: alexMasterBody() });

    expect(outcome.ok).toBe(true);
  });

  it("refuses a draft for an application that is past tailoring", async () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx, {}, { score: 20 });

    await expect(submitResumeDraft(ctx, { applicationId, body: alexMasterBody() })).rejects.toMatchObject({
      code: "not-draftable",
    });
  });
});
