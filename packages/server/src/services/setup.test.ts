import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMasterResume, getProfileSection, getSetting, listLatestUploads, listRunsByStatus, saveProfileSection } from "@jobgoblin/storage";
import { extractResumeText } from "@jobgoblin/render";
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

    await expect(
      importResume(ctx, { fileName: "notes.txt", bytes: new Uint8Array([1, 2, 3]), kind: "resume" }),
    ).rejects.toMatchObject({ code: "unsupported-type" });
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
