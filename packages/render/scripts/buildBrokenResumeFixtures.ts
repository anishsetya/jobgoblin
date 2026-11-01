// Makes the files that Jobgoblin must refuse with an honest message, in fixtures/resumes/broken/:
//   password-protected.pdf  a real password-protected PDF (the password is "jobgoblin")
//   truncated.pdf           the demo PDF cut in half, as an interrupted download leaves it
//   truncated.docx          the demo Word file cut in half
//   text-file.pdf           a plain text file that was renamed to .pdf
//   text-file.docx          a plain text file that was renamed to .docx
//   text-file.png           a plain text file named .png (a type Jobgoblin does not read at all)
// It cuts the demo files, so run it after buildResumeFixtures: `pnpm --filter @jobgoblin/render fixtures` does both.
// Spec: fixtures/README.md ("resumes/broken/"); RCA-2026-11-01-pdf-upload.md follow-up 3.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resumeFixturePath } from "../src/testSupport";
import { buildPasswordProtectedPdf } from "./passwordProtectedPdf";

const PLAIN_TEXT = "Alex Rivera\nSoftware engineer\nThis is plain text. It is not a resume file.\n";

function halfOf(fileName: string): Buffer {
  const whole = readFileSync(resumeFixturePath(fileName));
  return whole.subarray(0, Math.floor(whole.length / 2));
}

mkdirSync(resumeFixturePath("broken"), { recursive: true });

const brokenFiles: Record<string, Buffer | string> = {
  "password-protected.pdf": buildPasswordProtectedPdf(),
  "truncated.pdf": halfOf("alex-rivera.pdf"),
  "truncated.docx": halfOf("alex-rivera.docx"),
  "text-file.pdf": PLAIN_TEXT,
  "text-file.docx": PLAIN_TEXT,
  "text-file.png": PLAIN_TEXT,
};

for (const [fileName, contents] of Object.entries(brokenFiles)) {
  writeFileSync(resumeFixturePath(`broken/${fileName}`), contents);
}
console.log(`Wrote ${Object.keys(brokenFiles).length} files to fixtures/resumes/broken/`);
