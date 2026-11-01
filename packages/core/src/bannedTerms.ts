// Banned terms: words the person never wants on a resume, in an answer or on a data sheet.
// The same check runs on resume text, on the text read back from the rendered PDF, on saved answers
// and on the data sheet before approval.
// Spec: "Resume pipeline" step 3. ARCHITECTURE.md section 6.
import type { ResumeCheckError } from "@jobgoblin/schemas";
import { containsWholeWord } from "./textHelpers";

// A piece of text and where it is, for example { path: "sections.experience[0].bullets[1]", text: "..." }.
export type TextToCheck = { path: string; text: string };

// Matches whole words and their plurals, ignoring case: banning "test" finds "Test" and "tests" but not
// "latest", and banning "QA" does not trip on "Qatar". Returns one error per banned term per text,
// naming where it was found. `code` is "banned-in-pdf" when the text was read back from the PDF.
export function findBannedTerms(
  texts: readonly TextToCheck[],
  bannedTerms: readonly string[],
  code: "banned" | "banned-in-pdf" = "banned",
): ResumeCheckError[] {
  const terms = bannedTerms.map((term) => term.trim()).filter((term) => term !== "");
  const errors: ResumeCheckError[] = [];

  for (const { path, text } of texts) {
    for (const term of terms) {
      if (!containsWholeWord(text, term, true)) continue;
      errors.push({ code, path, message: describeBannedTerm(term, code) });
    }
  }
  return errors;
}

function describeBannedTerm(term: string, code: "banned" | "banned-in-pdf"): string {
  if (code === "banned-in-pdf") {
    return `The resume file contains "${term}", which is on your banned words list. Reword the line that uses it.`;
  }
  return `"${term}" is on your banned words list. Reword this text without it.`;
}
