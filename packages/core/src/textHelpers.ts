// Small text helpers shared by the rules that look for words: banned terms, roles to avoid, tool names.
// They live in one place so every rule agrees on what "a whole word" means.
// Spec: ARCHITECTURE.md section 6 (no file or network access; plain functions only).

// Makes `text` safe to put inside a regular expression, so a banned term such as "C++" is matched as typed.
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Every run of spaces, tabs and line breaks becomes one space. Used before comparing two pieces of text.
export function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// True when `phrase` appears in `text` as whole words, ignoring case: "test" matches "Test Engineer" and
// "tests" (when plurals are allowed) but not "latest". A phrase of several words may be split by any spaces.
export function containsWholeWord(text: string, phrase: string, allowPlural: boolean = false): boolean {
  const words = phrase.split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return false;

  const body = words.map(escapeRegExp).join("\\s+");
  const plural = allowPlural ? "s?" : "";
  const pattern = new RegExp(`(?<![A-Za-z0-9])${body}${plural}(?![A-Za-z0-9])`, "i");
  return pattern.test(text);
}
