// Tests of resume import: the text of an uploaded PDF or Word file, and the errors for files that
// cannot be read. The inputs are the demo person's resume files in fixtures/resumes.
// Spec: ARCHITECTURE.md section 15 (resume import from the sample PDF and DOCX).
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";
import { ResumeFileError, extractResumeText } from "./index";
import { readPdf } from "./readPdf";
import { readResumeFixture } from "./testSupport";

// Only the PDF reading can be made to fail on purpose; everything else in this file is the real code.
vi.mock("./readPdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./readPdf")>();
  return { ...actual, readPdf: vi.fn(actual.readPdf) };
});

// Written into fixtures/resumes/broken/password-protected.pdf by scripts/passwordProtectedPdf.ts.
const PASSWORD_PROTECTED_FIXTURE_PASSWORD = "jobgoblin";

const SOME_TEXT_BYTES = new TextEncoder().encode("This is plain text, not a resume file.");

describe("extractResumeText", () => {
  it("reads the company and the email from the sample PDF", async () => {
    const pdf = readResumeFixture("alex-rivera.pdf");

    const text = await extractResumeText(pdf, "alex-rivera.pdf");

    expect(text).toContain("Northwind Logistics");
    expect(text).toContain("alex.rivera@example.com");
  });

  it("reads the company and the email from the sample Word file", async () => {
    const docx = readResumeFixture("alex-rivera.docx");

    const text = await extractResumeText(docx, "alex-rivera.docx");

    expect(text).toContain("Northwind Logistics");
    expect(text).toContain("alex.rivera@example.com");
  });

  it("gives the same achievements from the PDF and the Word file", async () => {
    const fromPdf = await extractResumeText(readResumeFixture("alex-rivera.pdf"), "alex-rivera.pdf");
    const fromWord = await extractResumeText(readResumeFixture("alex-rivera.docx"), "alex-rivera.docx");

    const bullet = "Cut p95 latency of the orders service 40% by adding a Redis read-through cache";
    expect(fromPdf.replace(/\s+/g, " ")).toContain(bullet);
    expect(fromWord.replace(/\s+/g, " ")).toContain(bullet);
  });

  it("decides the file type from the extension in any letter case", async () => {
    const pdf = readResumeFixture("alex-rivera.pdf");

    const text = await extractResumeText(pdf, "Alex Rivera RESUME.PDF");

    expect(text).toContain("Northwind Logistics");
  });

  it("throws a clear error for a file type it cannot read", async () => {
    const read = extractResumeText(SOME_TEXT_BYTES, "resume.txt");

    await expect(read).rejects.toMatchObject({
      name: "ResumeFileError",
      code: "unsupported-type",
      message: "This file is not a PDF or a Word file.",
      action: "Choose a PDF or a Word (.docx) file.",
    });
  });

  it("explains how to fix an old .doc file", async () => {
    const read = extractResumeText(SOME_TEXT_BYTES, "resume.doc");

    await expect(read).rejects.toMatchObject({
      code: "unsupported-type",
      action: "Save it as a .docx or a PDF, then choose the new file.",
    });
  });

  it("throws for a file name with no extension", async () => {
    const read = extractResumeText(SOME_TEXT_BYTES, "resume");

    await expect(read).rejects.toBeInstanceOf(ResumeFileError);
  });
});

// The files in fixtures/resumes/broken are made by `pnpm --filter @jobgoblin/render fixtures`.
describe("extractResumeText with files that cannot be read", () => {
  it("says a text file named .png is not a PDF or a Word file", async () => {
    const read = extractResumeText(readResumeFixture("broken/text-file.png"), "text-file.png");

    await expect(read).rejects.toMatchObject({ code: "unsupported-type", message: "This file is not a PDF or a Word file." });
  });

  it("says a password-protected PDF is protected with a password", async () => {
    const read = extractResumeText(readResumeFixture("broken/password-protected.pdf"), "password-protected.pdf");

    await expect(read).rejects.toMatchObject({
      code: "password-protected",
      message: "This PDF is protected with a password.",
      action: "Open it, save a copy without a password, and choose that copy.",
    });
  });

  it("keeps the fixture honest: it opens with its password, so the password is the only problem", async () => {
    const loadingTask = getDocument({
      data: Uint8Array.from(readResumeFixture("broken/password-protected.pdf")),
      password: PASSWORD_PROTECTED_FIXTURE_PASSWORD,
      verbosity: 0,
    });

    const document = await loadingTask.promise;

    expect(document.numPages).toBe(1);
    await loadingTask.destroy();
  });

  it.each([
    ["a PDF cut in half", "broken/truncated.pdf"],
    ["a text file renamed .pdf", "broken/text-file.pdf"],
    ["a Word file cut in half", "broken/truncated.docx"],
    ["a text file renamed .docx", "broken/text-file.docx"],
  ])("says %s looks damaged or incomplete", async (_description, fixture) => {
    const fileName = fixture.replace("broken/", "");

    const read = extractResumeText(readResumeFixture(fixture), fileName);

    await expect(read).rejects.toMatchObject({
      code: "damaged",
      message: "This file looks damaged or incomplete.",
      action: "Export your resume again as a PDF and choose the new file.",
    });
  });

  it("keeps the reader's own error as the cause, for the log", async () => {
    const read = extractResumeText(readResumeFixture("broken/password-protected.pdf"), "password-protected.pdf");

    await expect(read).rejects.toMatchObject({ cause: expect.objectContaining({ name: "PasswordException" }) });
  });

  it("blames Jobgoblin, not the file, for an error it does not recognise", async () => {
    vi.mocked(readPdf).mockRejectedValueOnce(new Error('No "GlobalWorkerOptions.workerSrc" specified.'));

    const read = extractResumeText(readResumeFixture("alex-rivera.pdf"), "alex-rivera.pdf");

    await expect(read).rejects.toMatchObject({
      code: "read-failed",
      message: "Jobgoblin could not read this file. This is a problem on our side, not with your file.",
      action: "Try again. If it keeps happening, choose a Word copy of your resume.",
    });
  });

  it("does not call a thrown value that is not an error 'damaged'", async () => {
    vi.mocked(readPdf).mockRejectedValueOnce("something odd");

    const read = extractResumeText(readResumeFixture("alex-rivera.pdf"), "alex-rivera.pdf");

    await expect(read).rejects.toMatchObject({ code: "read-failed" });
  });
});
