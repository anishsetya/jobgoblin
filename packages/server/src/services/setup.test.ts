import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMasterResume, getProfileSection, getSetting, listLatestUploads, listRunsByStatus, saveProfileSection } from "@jobgoblin/storage";
import { extractResumeText, ResumeFileError } from "@jobgoblin/render";
import { describeError } from "../http/errorHandler";
import { getProfile } from "./profile";
import { finishSetup, getUploadsForRun, importResume } from "./setup";
import { addStoryItem, confirmStoryItem } from "./story";
import { closeTestContexts, createTestContext, repoRoot } from "./testSupport";

// Only the reading of a file is replaced for the "no readable text" test; everything else is the real package.
vi.mock("@jobgoblin/render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jobgoblin/render")>();
  return { ...actual, extractResumeText: vi.fn(actual.extractResumeText) };
});

afterEach(() => {
  closeTestContexts();
  vi.mocked(extractResumeText).mockClear();
});

function alexPdf() {
  const bytes = new Uint8Array(fs.readFileSync(path.join(repoRoot(), "fixtures", "resumes", "alex-rivera.pdf")));
  return { fileName: "alex-rivera.pdf", bytes, kind: "resume" as const };
}

// A file from fixtures/resumes/broken, uploaded under its own name.
function brokenFile(fileName: string) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(repoRoot(), "fixtures", "resumes", "broken", fileName)));
  return { fileName, bytes, kind: "resume" as const };
}

describe("importResume", () => {
  it("finds the contact details, fills the empty contact fields and queues a setup run", async () => {
    const ctx = createTestContext({ withAlexRivera: false });

    const result = await importResume(ctx, alexPdf());

    const contact = getProfileSection(ctx.db, "contact");
    expect(contact).toMatchObject({ fullName: "Alex Rivera", email: "alex.rivera@example.com", location: "Austin, TX" });
    expect(contact.phone).toContain("555");
    const [run] = listRunsByStatus(ctx.db, ["queued"]);
    expect(run).toMatchObject({ kind: "setup", model: "sonnet" });
    expect(result.runId).toBe(run?.id);
  });

  it("stores only the redacted text: no email, phone or name reaches what a run reads", async () => {
    const ctx = createTestContext({ withAlexRivera: false });

    await importResume(ctx, alexPdf());

    const [upload] = listLatestUploads(ctx.db);
    expect(upload?.fileName).toBe("alex-rivera.pdf");
    expect(upload?.redactedText).not.toContain("alex.rivera@example.com");
    expect(upload?.redactedText).not.toContain("555 0100");
    expect(upload?.redactedText).not.toContain("Alex Rivera");
    expect(upload?.redactedText).toContain("Northwind Logistics");
    expect(getUploadsForRun(ctx).uploads[0]?.text).toBe(upload?.redactedText);
  });

  it("never overwrites a contact value the person already typed", async () => {
    const ctx = createTestContext({ withAlexRivera: false });
    const contact = getProfileSection(ctx.db, "contact");
    saveProfileSection(ctx.db, "contact", { ...contact, fullName: "Alexandra Rivera" }, ctx.now().toISOString());

    await importResume(ctx, alexPdf());

    expect(getProfile(ctx).profile.contact.fullName).toBe("Alexandra Rivera");
    expect(getProfile(ctx).profile.contact.email).toBe("alex.rivera@example.com");
  });

  it("starts no run after a LinkedIn file alone", async () => {
    const ctx = createTestContext({ withAlexRivera: false });

    const result = await importResume(ctx, { ...alexPdf(), kind: "linkedin" });

    expect(result.runId).toBeNull();
    expect(listRunsByStatus(ctx.db, ["queued"])).toHaveLength(0);
  });

  it("uses the run that is already queued when a resume is uploaded twice", async () => {
    const ctx = createTestContext({ withAlexRivera: false });

    const first = await importResume(ctx, alexPdf());
    const second = await importResume(ctx, alexPdf());

    expect(second.runId).toBe(first.runId);
  });

  it("explains a file with no readable text in plain words", async () => {
    const ctx = createTestContext({ withAlexRivera: false });
    vi.mocked(extractResumeText).mockResolvedValueOnce("   \n  ");

    await expect(importResume(ctx, alexPdf())).rejects.toMatchObject({
      code: "no-readable-text",
      message: "This file has no readable text. Try a PDF exported from Word or Google Docs.",
    });
    expect(listRunsByStatus(ctx.db, ["queued"])).toHaveLength(0);
  });

  it("explains a file that is not a PDF or Word file", async () => {
    const ctx = createTestContext({ withAlexRivera: false });

    await expect(importResume(ctx, brokenFile("text-file.png"))).rejects.toMatchObject({
      kind: "invalid",
      code: "unsupported-type",
      message: "This file is not a PDF or a Word file.",
      action: "Choose a PDF or a Word (.docx) file.",
    });
  });

  it("explains a PDF that is protected with a password, and starts no run", async () => {
    const ctx = createTestContext({ withAlexRivera: false });

    await expect(importResume(ctx, brokenFile("password-protected.pdf"))).rejects.toMatchObject({
      kind: "invalid",
      code: "password-protected",
      message: "This PDF is protected with a password.",
      action: "Open it, save a copy without a password, and choose that copy.",
    });
    expect(listRunsByStatus(ctx.db, ["queued"])).toHaveLength(0);
    expect(listLatestUploads(ctx.db)).toHaveLength(0);
  });

  it("explains a file that looks damaged or incomplete", async () => {
    const ctx = createTestContext({ withAlexRivera: false });

    await expect(importResume(ctx, brokenFile("truncated.pdf"))).rejects.toMatchObject({
      kind: "invalid",
      code: "damaged",
      message: "This file looks damaged or incomplete.",
      action: "Export your resume again as a PDF and choose the new file.",
    });
  });

  it("owns up to a problem on our side instead of blaming the file", async () => {
    const ctx = createTestContext({ withAlexRivera: false });
    vi.mocked(extractResumeText).mockRejectedValueOnce(
      new ResumeFileError("read-failed", { cause: new Error('No "GlobalWorkerOptions.workerSrc" specified.') }),
    );

    const refusal = await importResume(ctx, alexPdf()).catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      kind: "our-fault",
      code: "read-failed",
      message: "Jobgoblin could not read this file. This is a problem on our side, not with your file.",
      action: "Try again. If it keeps happening, choose a Word copy of your resume.",
    });
    expect(describeError(refusal).status).toBe(500);
  });

  it("logs the code and the reader's error, and never the file's contents", async () => {
    const ctx = createTestContext({ withAlexRivera: false });
    const warn = vi.spyOn(ctx.logger, "warn");

    await expect(importResume(ctx, brokenFile("password-protected.pdf"))).rejects.toBeDefined();

    expect(warn).toHaveBeenCalledTimes(1);
    const [details] = warn.mock.calls[0] ?? [];
    expect(details).toEqual({ code: "password-protected", cause: expect.stringContaining("PasswordException") });
    expect(JSON.stringify(details)).not.toContain("Alex Rivera");
  });

  it("logs a file with no readable text too", async () => {
    const ctx = createTestContext({ withAlexRivera: false });
    const warn = vi.spyOn(ctx.logger, "warn");
    vi.mocked(extractResumeText).mockResolvedValueOnce("");

    await expect(importResume(ctx, alexPdf())).rejects.toBeDefined();

    expect(warn).toHaveBeenCalledWith({ code: "no-readable-text" }, expect.any(String));
  });

  it("refuses a file over 10 MB", async () => {
    const ctx = createTestContext({ withAlexRivera: false });

    await expect(
      importResume(ctx, { fileName: "big.pdf", bytes: new Uint8Array(10 * 1024 * 1024 + 1), kind: "resume" }),
    ).rejects.toMatchObject({ code: "file-too-large" });
  });
});

describe("finishSetup", () => {
  it("builds the master resume from the confirmed items and marks setup complete", () => {
    const ctx = createTestContext({ withAlexRivera: false });
    const job = addStoryItem(ctx, { kind: "experience", parentId: null, data: { text: "Engineer at Acme", title: "Engineer", organization: "Acme", tools: [], numbers: [] }, keywords: [] });
    const pending = addStoryItem(ctx, { kind: "skill", parentId: null, data: { text: "Rust", tools: [], numbers: [] }, keywords: [] });
    confirmStoryItem(ctx, pending.id);

    const settings = finishSetup(ctx);

    expect(settings.setupComplete).toBe(true);
    expect(getSetting(ctx.db, "setupComplete")).toBe(true);
    const master = getMasterResume(ctx.db)?.body;
    expect(master?.sections.experience.map((entry) => entry.src)).toEqual([job.id]);
    expect(master?.skills).toHaveLength(1);
  });

  it("needs the person's folder first", () => {
    const ctx = createTestContext({ withAlexRivera: false, withFolder: false });

    expect(() => finishSetup(ctx)).toThrowError(expect.objectContaining({ code: "no-person-folder" }));
  });
});
