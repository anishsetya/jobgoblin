// Cheap checks on a job posting, done by code before any run reads it: which region it is in, a key that
// recognises the same job on two sites, and the code filter built from the person's targets.
// Ported from the prototype's classify_region, classify_title and SENIOR_YEARS (tools/jobs-mcp), but driven
// by the person's targets instead of hard-coded tracks.
// Spec: "Job discovery" (code filter first, dedupe). ARCHITECTURE.md section 6.
import type { Region, TargetsSection } from "@jobgoblin/schemas";
import { containsWholeWord, escapeRegExp } from "./textHelpers";
import { sha256Hex } from "./versionId";

// ---------------------------------------------------------------------------------------------
// Region
// ---------------------------------------------------------------------------------------------

const US_STATE_CODES = new Set(
  ("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY " +
    "NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC US").split(" "),
);

const US_PLACE_WORDS = [
  "united states", "usa", "u.s.", "us-remote", "remote us", "remote - us", "remote (us", "us remote",
  "americas", "north america", "san francisco", "new york", "nyc", "seattle", "austin", "boston",
  "los angeles", "chicago", "denver", "palo alto", "mountain view", "menlo park", "sunnyvale",
  "san jose", "san mateo", "redwood city", "bay area", "atlanta", "washington", "miami", "portland",
];

const INDIA_PLACE_WORDS = [
  "india", "bengaluru", "bangalore", "hyderabad", "pune", "mumbai", "gurgaon", "gurugram", "noida",
  "delhi", "chennai",
];

// A place word counts only as a whole word, so "usa" does not match inside "Thousand Oaks".
function placeWordsPattern(words: readonly string[]): RegExp {
  const alternatives = words.map(escapeRegExp).join("|");
  return new RegExp(`(?<![a-z])(?:${alternatives})(?![a-z])`);
}

const US_PLACES = placeWordsPattern(US_PLACE_WORDS);
const INDIA_PLACES = placeWordsPattern(INDIA_PLACE_WORDS);

// Nothing but "remote", "anywhere", "global" ... and the punctuation between them.
const ONLY_REMOTE_WORDS = /^[\s\-/(),]*(?:(?:remote|anywhere|global|worldwide|distributed)[\s\-/(),]*)+$/;

// India is checked first, as in the prototype: "Remote - US / Bengaluru" is a job the person can reach in India.
// REMOTE means remote with no country named ("Remote - Worldwide"); "Remote (Canada)" is OTHER.
export function classifyRegion(location: string): Region {
  const lowerCase = location.toLowerCase();
  if (INDIA_PLACES.test(lowerCase)) return "IN";
  if (US_PLACES.test(lowerCase)) return "US";
  if (mentionsUsStateCode(location)) return "US";
  if (lowerCase.trim() === "" || ONLY_REMOTE_WORDS.test(lowerCase)) return "REMOTE";
  return "OTHER";
}

// "Austin, TX" or "Remote, US": a two-letter capital word that is a state code.
function mentionsUsStateCode(location: string): boolean {
  const capitalWords = location.match(/\b[A-Z]{2}\b/g) ?? [];
  return capitalWords.some((word) => US_STATE_CODES.has(word));
}

// ---------------------------------------------------------------------------------------------
// Dedupe key
// ---------------------------------------------------------------------------------------------

// Lower case, letters and digits only, one space between words.
function lettersAndDigits(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Legal endings that sites write differently: "Acme", "Acme Inc." and "Acme, LLC" are one company.
const LEGAL_ENDINGS = new Set(["inc", "llc", "ltd", "corp", "corporation", "co", "gmbh"]);

export function normalizeCompanyName(name: string): string {
  const words = lettersAndDigits(name).split(" ");
  while (words.length > 1 && LEGAL_ENDINGS.has(words[words.length - 1] ?? "")) words.pop();
  return words.join(" ");
}

// "United States", "U.S." and "USA" are all "us". Words are sorted so "Remote - US" and "US Remote" agree.
function normalizeLocation(location: string): string {
  const withShortUs = location.toLowerCase().replace(/united states( of america)?|u\.s\.a\.?|u\.s\.?|\busa\b/g, "us");
  return lettersAndDigits(withShortUs).split(" ").sort().join(" ");
}

// The same role posted twice (a new id, or on another site) gets the same key: a SHA-256 of the
// normalized company, title and location. "Remote - US" and "Remote (US)" count as the same place.
export function dedupeKey(company: string, title: string, location: string): string {
  const parts = [normalizeCompanyName(company), lettersAndDigits(title), normalizeLocation(location)];
  return sha256Hex(parts.join("|"));
}

// ---------------------------------------------------------------------------------------------
// Years of experience
// ---------------------------------------------------------------------------------------------

// "5+ years", "5 years", "3-5 years", "3 to 5 years", "5 plus years". The first number is the lowest the
// posting asks for. The lookbehind stops "100 years" from being read as "00 years".
const YEARS_PHRASE = /(?<![\d.,])(\d{1,2})\s*(?:\+|plus)?(?:\s*(?:-|–|—|to)\s*\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b/gi;

// Larger numbers are about a company's history ("20 years in business"), not a requirement.
const LARGEST_PLAUSIBLE_REQUIREMENT = 15;

// In the posting's body, a years phrase counts only in a sentence that is about experience or requirements.
const REQUIREMENT_WORDS = /experience|required|requirement|qualification|minimum|at least/i;

// "We have 10 years of experience in logistics" is about the company, not about what the job asks for. A
// sentence that speaks as the company counts only when it also says who is wanted. Wrongly hiding a good
// job is worse than letting one through, because the run flags a long requirement anyway.
const SPEAKS_AS_COMPANY = /\b(we|our)\b/i;
const SAYS_WHO_IS_WANTED = /\b(you|candidate|applicant|someone|looking for|seeking|ideal|require[sd]?|minimum|at least)\b/i;

function isRequirementSentence(sentence: string): boolean {
  if (!REQUIREMENT_WORDS.test(sentence)) return false;
  return !SPEAKS_AS_COMPANY.test(sentence) || SAYS_WHO_IS_WANTED.test(sentence);
}

function yearsMentioned(text: string): number[] {
  const mentioned: number[] = [];
  for (const match of text.matchAll(YEARS_PHRASE)) {
    const years = Number(match[1]);
    if (years <= LARGEST_PLAUSIBLE_REQUIREMENT) mentioned.push(years);
  }
  return mentioned;
}

// The most years of experience the posting asks for (the lowest number of each range), or null when it
// does not say. The title is read as it is; the body only sentence by sentence.
export function yearsRequired(title: string, text: string): number | null {
  const requirementSentences = text.split(/\n+|(?<=[.!?])\s+/).filter(isRequirementSentence);
  const found = [...yearsMentioned(title), ...requirementSentences.flatMap(yearsMentioned)];
  return found.length === 0 ? null : Math.max(...found);
}

// ---------------------------------------------------------------------------------------------
// Code filter
// ---------------------------------------------------------------------------------------------

export type PostingToFilter = { title: string; location: string; text: string };
export type CodeFilterTargets = Pick<TargetsSection, "rolesToAvoid" | "maxYearsRequired" | "regions">;
export type CodeFilterResult = { passes: true } | { passes: false; reason: string };

// Drops a posting before any run reads it, for one of three reasons from the person's targets:
// the title names a role to avoid, it asks for more years than the person's limit, or it is in a region
// outside their targets. Every other worry (class year, relocation, a school screen) is a flag for the run.
export function codeFilter(posting: PostingToFilter, targets: CodeFilterTargets): CodeFilterResult {
  const avoided = targets.rolesToAvoid.find((role) => containsWholeWord(posting.title, role, true));
  if (avoided !== undefined) {
    return { passes: false, reason: `The title matches "${avoided}", a role you chose to avoid.` };
  }

  const years = yearsRequired(posting.title, posting.text);
  if (years !== null && years > targets.maxYearsRequired) {
    return {
      passes: false,
      reason: `It asks for ${years} years of experience, and your limit is ${targets.maxYearsRequired}.`,
    };
  }

  if (isOutsideTargetRegions(posting.location, targets.regions)) {
    return {
      passes: false,
      reason: `The location "${posting.location}" is outside your target regions (${targets.regions.join(", ")}).`,
    };
  }

  return { passes: true };
}

// No regions listed means the person has no region preference.
function isOutsideTargetRegions(location: string, targetRegions: readonly string[]): boolean {
  if (targetRegions.length === 0) return false;
  const wanted = targetRegions.map((region) => region.toUpperCase());
  return !wanted.includes(classifyRegion(location));
}
