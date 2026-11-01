// "Does this text mention this term?" used to find must-haves in a posting and to decide which resume
// bullets to put first. Whole words only, so "Java" is not found in "JavaScript".
// Spec: ARCHITECTURE.md section 14 (keyword overlap, bullets that match must-haves first).

// Names this short ("Go") are also ordinary words ("go"), so only their capitalised spelling counts.
const SHORT_TERM_LENGTH = 3;

export function mentionsTerm(text: string, term: string): boolean {
  if (term.length < SHORT_TERM_LENGTH) return mentionsWholeWord(text, capitalize(term), "");
  return mentionsWholeWord(text, term, "i");
}

function capitalize(term: string): string {
  return term.charAt(0).toUpperCase() + term.slice(1);
}

function mentionsWholeWord(text: string, word: string, flags: "" | "i"): boolean {
  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Look-arounds instead of \b, because terms such as "C++" and "on-call" end or start with a symbol.
  const wholeWord = new RegExp(`(?<![A-Za-z0-9])${escapedWord}(?![A-Za-z0-9])`, flags);
  return wholeWord.test(text);
}
