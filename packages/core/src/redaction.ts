// Contact-detail redaction: strips the person's contact details from resume text before any run sees it.
// It removes the header block (everything before the first section heading), plus any email address, phone
// number or web link anywhere, and returns what it found so the setup can fill in the contact section.
// Spec: "Security and privacy". ARCHITECTURE.md decision D10 and section 6.
import type { ContactSection } from "@jobgoblin/schemas";
import { escapeRegExp } from "./textHelpers";

export type RedactionResult = {
  redacted: string; // the text a run may read; placeholders such as {email} stand where details were
  found: Partial<ContactSection>; // what was removed, to be confirmed by the person
};

// ---------------------------------------------------------------------------------------------
// What contact details look like
// ---------------------------------------------------------------------------------------------

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// Not "net": it would turn "ASP.NET" into a link.
const TOP_LEVEL_DOMAINS = "com|org|io|dev|co|ai|app|me|us|edu|tech|xyz|info|page|site|blog|cloud";
// "https://...", "www....", or a bare domain such as "github.com/name" or "alex.dev".
const LINK = new RegExp(
  String.raw`(?:https?:\/\/|www\.)[^\s<>"'|]+|\b(?:[a-z0-9-]+\.)+(?:${TOP_LEVEL_DOMAINS})\b(?:\/[^\s<>"'|]*)?`,
  "gi",
);

const PHONE = new RegExp(
  [
    String.raw`\+\d[ \t\d().-]{5,}\d`, // international: +1 555 0100, +91 98765 43210
    String.raw`\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b`, // US style: (555) 010-0100, 555-010-0100
    String.raw`\b\d{10}\b`, // ten digits in a row
  ].join("|"),
  "g",
);

// Trailing punctuation belongs to the sentence, not to the link or the number.
function trimTrailingPunctuation(match: string): string {
  return match.replace(/[.,;:)\]]+$/, "");
}

function findAll(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].map((match) => trimTrailingPunctuation(match[0]));
}

// Emails are blanked first, or the domain of "alex@example.com" would be reported as a link.
function findLinks(text: string): string[] {
  return findAll(LINK, text.replace(EMAIL, " "));
}

type Replacements = { email: string; link: string; phone: string };

// Emails first, so "alex@example.com" is not also read as the link "example.com"; links before phones.
function replaceContactPatterns(text: string, replacements: Replacements): string {
  const keepTrailing = (replacement: string) => (match: string) =>
    replacement + match.slice(trimTrailingPunctuation(match).length);

  return text
    .replace(EMAIL, replacements.email)
    .replace(LINK, keepTrailing(replacements.link))
    .replace(PHONE, keepTrailing(replacements.phone));
}

// ---------------------------------------------------------------------------------------------
// The header block
// ---------------------------------------------------------------------------------------------

// A LinkedIn "Save to PDF" export starts with a sidebar (Contact, Top Skills, ...) and gives the name, headline
// and place only after it, just before Summary or Experience. Headings are compared after hyphens turn into
// spaces, so "Honors-Awards" is written "honors awards" here.
const SIDEBAR_HEADINGS = new Set(["contact", "top skills", "honors awards", "certifications", "languages"]);

const SECTION_HEADINGS = new Set([
  ...SIDEBAR_HEADINGS,
  "summary", "professional summary", "profile", "objective", "about", "about me",
  "experience", "work experience", "professional experience", "employment", "employment history", "work history",
  "education", "skills", "technical skills", "projects", "personal projects", "certifications",
  "awards", "publications", "languages", "interests", "achievements", "activities", "volunteering", "leadership",
]);

function headingWords(line: string): string {
  return line.trim().replace(/[:\-_=*#|]+/g, " ").trim().toLowerCase();
}

function isSectionHeading(line: string): boolean {
  return SECTION_HEADINGS.has(headingWords(line));
}

function isLinkedInExport(lines: readonly string[]): boolean {
  const firstLine = lines.find((line) => line.trim() !== "");
  return firstLine !== undefined && SIDEBAR_HEADINGS.has(headingWords(firstLine));
}

// Without any heading to stop at, the top of the text is still the header: its first few lines.
const HEADER_LINES_WHEN_NO_HEADING = 3;

// The number of lines before the first section heading. In a LinkedIn export the sidebar headings do not
// end the header: the name sits after them.
function headerLength(lines: readonly string[]): number {
  const skipSidebarHeadings = isLinkedInExport(lines);
  const endsHeader = (line: string): boolean =>
    isSectionHeading(line) && !(skipSidebarHeadings && SIDEBAR_HEADINGS.has(headingWords(line)));
  const firstHeading = lines.findIndex(endsHeader);
  if (firstHeading !== -1) return firstHeading;

  let seen = 0;
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    seen += 1;
    if (seen === HEADER_LINES_WHEN_NO_HEADING) return index + 1;
  }
  return lines.length;
}

// A header line is kept when it is a sentence of the person's own words (an un-headed summary or
// headline), not contact details: no email, phone or link, not a place, and at least six words.
const SENTENCE_MIN_WORDS = 6;
const PLACE_LINE =
  /^\p{L}[\p{L}.'-]*(?: \p{L}[\p{L}.'-]*){0,3}(?:, ?\p{L}[\p{L}.'-]*(?: \p{L}[\p{L}.'-]*){0,3}){1,2}$/u;

function isSentenceOfOwnWords(line: string): boolean {
  const trimmed = line.trim();
  if (containsContactDetail(trimmed) || PLACE_LINE.test(trimmed)) return false;
  return (trimmed.match(/\p{L}[\p{L}'-]*/gu) ?? []).length >= SENTENCE_MIN_WORDS;
}

// `search` is used because it ignores the "g" flag's remembered position, unlike `test`.
function containsContactDetail(text: string): boolean {
  return [EMAIL, LINK, PHONE].some((pattern) => text.search(pattern) !== -1);
}

// ---------------------------------------------------------------------------------------------
// Finding the details
// ---------------------------------------------------------------------------------------------

// A name is one to four words of letters: "Alex Rivera", "Mary-Jane O'Neil Jr.". Not a title such as "Resume".
const NAME_LINE = /^\p{L}[\p{L}.'’-]*(?: \p{L}[\p{L}.'’-]*){0,3}$/u;
// Section headings are one or two capitalised words too, so "Contact" must not become the person's name.
const NOT_A_NAME = new Set(["resume", "curriculum vitae", "cv", ...SECTION_HEADINGS]);
const LINES_AFTER_SIDEBAR = 3; // name, headline, place

function findName(headerLines: readonly string[]): string | undefined {
  const lines = headerLines.map((line) => line.trim());
  // In a LinkedIn export the name is among the last lines before Summary; earlier lines are the sidebar's
  // skills and the like, which can look like names too ("TypeScript").
  const candidates = isLinkedInExport(lines) ? lines.filter((line) => line !== "").slice(-LINES_AFTER_SIDEBAR) : lines;
  return candidates.find((line) => NAME_LINE.test(line) && !NOT_A_NAME.has(line.toLowerCase()));
}

// "Austin, TX" or "Bengaluru, India": looked for between the separators of the contact line.
function findLocation(headerLines: readonly string[], name: string | undefined): string | undefined {
  const withoutDetails = headerLines.map((line) => replaceContactPatterns(line, { email: "|", link: "|", phone: "|" }));
  const segments = withoutDetails.flatMap((line) => line.split(/\s*[|•·–—]\s*|\t+/));
  return segments.map((segment) => segment.trim()).find((segment) => segment !== name && PLACE_LINE.test(segment));
}

function findContactDetails(headerText: string, wholeText: string): Partial<ContactSection> {
  const headerLines = headerText.split("\n");
  const found: Partial<ContactSection> = {};

  const fullName = findName(headerLines);
  if (fullName !== undefined) found.fullName = fullName;

  // The header is looked at first; a detail that appears only further down is still reported.
  const email = findAll(EMAIL, headerText)[0] ?? findAll(EMAIL, wholeText)[0];
  if (email !== undefined) found.email = email;
  const phone = findAll(PHONE, headerText)[0] ?? findAll(PHONE, wholeText)[0];
  if (phone !== undefined) found.phone = phone;

  const location = findLocation(headerLines, fullName);
  if (location !== undefined) found.location = location;

  const links = [...findLinks(headerText), ...findLinks(wholeText)];
  const linkedin = links.find((link) => /linkedin\.com/i.test(link));
  const github = links.find((link) => /github\.com/i.test(link));
  const portfolio = links.find((link) => link !== linkedin && link !== github);
  if (linkedin !== undefined) found.linkedin = linkedin;
  if (github !== undefined) found.github = github;
  if (portfolio !== undefined) found.portfolio = portfolio;

  return found;
}

// ---------------------------------------------------------------------------------------------
// redactContactDetails
// ---------------------------------------------------------------------------------------------

export function redactContactDetails(text: string): RedactionResult {
  const lines = text.split(/\r?\n/);
  const headerEnd = headerLength(lines);
  const headerLines = lines.slice(0, headerEnd);
  const bodyLines = lines.slice(headerEnd);

  const found = findContactDetails(headerLines.join("\n"), lines.join("\n"));

  // The header goes, except any sentence the person wrote there (an un-headed summary), which is still
  // scrubbed below like the rest of the text.
  const keptHeader = headerLines.filter(isSentenceOfOwnWords);
  const remaining = [...keptHeader, ...bodyLines].join("\n");

  let redacted = replaceContactPatterns(remaining, { email: "{email}", link: "{link}", phone: "{phone}" });
  if (found.fullName !== undefined) {
    redacted = redacted.replace(new RegExp(escapeRegExp(found.fullName), "gi"), "{fullName}");
  }
  return { redacted: tidyBlankLines(redacted), found };
}

function tidyBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
