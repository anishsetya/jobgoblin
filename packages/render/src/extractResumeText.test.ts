// Tests of resume import: the text of an uploaded PDF or Word file, and the errors for files that
// cannot be read. The inputs are the demo person's resume files in fixtures/resumes.
// Spec: ARCHITECTURE.md section 15 (resume import from the sample PDF and DOCX).
import { describe, expect, it } from "vitest";
import { ResumeFileError, extractResumeText } from "./index";
import { readResumeFixture } from "./testSupport";

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

    await expect(read).rejects.toMatchObject({ name: "ResumeFileError", code: "unsupported-type" });
    await expect(read).rejects.toThrow(/not a PDF or Word/);
  });

  it("explains how to fix an old .doc file", async () => {
    const read = extractResumeText(SOME_TEXT_BYTES, "resume.doc");

    await expect(read).rejects.toThrow(/Save it as \.docx or PDF/);
  });

  it("throws for a file name with no extension", async () => {
    const read = extractResumeText(SOME_TEXT_BYTES, "resume");

    await expect(read).rejects.toBeInstanceOf(ResumeFileError);
  });

  it("throws an unreadable-file error for a damaged PDF", async () => {
    const read = extractResumeText(SOME_TEXT_BYTES, "broken.pdf");

    await expect(read).rejects.toMatchObject({ name: "ResumeFileError", code: "unreadable" });
  });

  it("throws an unreadable-file error for a damaged Word file", async () => {
    const read = extractResumeText(SOME_TEXT_BYTES, "broken.docx");

    await expect(read).rejects.toMatchObject({ name: "ResumeFileError", code: "unreadable" });
  });
});
