// Cheap checks on a job posting, done by code before any run reads it: which region it is in and whether it
// is remote, a key that recognises the same job on two sites, and the code filter built from the person's
// targets (places, cities, roles to avoid, and a years limit that follows their own experience).
// Ported from the prototype's classify_region, classify_title and SENIOR_YEARS (tools/jobs-mcp), but driven
// by the person's targets instead of hard-coded tracks.
// Spec: "Job discovery" (code filter first, dedupe). ARCHITECTURE.md section 6.
import { TODO, type Profile, type Region, type TargetsSection, type YearsLimit } from "@jobgoblin/schemas";
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

// A word that makes a location remote wherever it stands: "Remote - US", "US Remote", "Anywhere in Europe".
const REMOTE_WORD = /(?<![a-z])(?:remote|anywhere|worldwide|distributed)(?![a-z])/;

// Remote is a way of working, not a place: "Remote - US" is a remote job in the US. A location with no place
// at all ("", "Global") counts as remote too, as classifyRegion reads it.
export function isRemoteLocation(location: string): boolean {
  return classifyRegion(location) === "REMOTE" || REMOTE_WORD.test(location.toLowerCase());
}

// The country of "Where you live" ("Austin, TX" is the US), or null when it is not filled in or names no
// country. A remote job is done from there, so it decides which work authorization answers it needs.
export function homeRegionOf(location: string): Region | null {
  if (location === TODO || location.trim() === "") return null;
  const region = classifyRegion(location);
  return region === "REMOTE" ? null : region;
}

// The names the screens use for each region code, for reasons and labels a person reads.
const REGION_NAMES: Readonly<Record<string, string>> = {
  US: "United States",
  IN: "India",
  REMOTE: "Remote",
  OTHER: "Somewhere else",
};

export function regionName(code: string): string {
  return REGION_NAMES[code.toUpperCase()] ?? code;
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

// A job may ask for up to two years more than the person has and still be worth a real shot.
export const YEARS_ALLOWED_OVER_EXPERIENCE = 2;

// The whole years in a "Years of experience" answer ("2", "3 years", "5+", "1.5"), or null when the answer is
// missing or has no number in it.
export function parseYearsExperience(answer: string): number | null {
  const match = /\d+(?:\.\d+)?/.exec(answer);
  return match === null ? null : Math.floor(Number(match[0]));
}

// The most years a job may ask for: the person's years of experience + 2, or the stored maxYearsRequired
// while that answer is missing. The feed filter, jobs a run adds, what a run is told and the Targets screen
// all use this one number.
export function yearsLimitFor(profile: Pick<Profile, "employment" | "targets">): YearsLimit {
  const experience = parseYearsExperience(profile.employment.yearsExperience);
  const limit = experience === null ? profile.targets.maxYearsRequired : experience + YEARS_ALLOWED_OVER_EXPERIENCE;
  return { limit, experience };
}

// ---------------------------------------------------------------------------------------------
// Code filter
// ---------------------------------------------------------------------------------------------

export type PostingToFilter = { title: string; location: string; text: string };
export type CodeFilterTargets = Pick<TargetsSection, "rolesToAvoid" | "maxYearsRequired" | "regions" | "cities">;
export type CodeFilterResult = { passes: true } | { passes: false; reason: string };

// What the code filter needs from the profile: the person's targets, with the years limit worked out.
export function codeFilterTargetsFor(profile: Pick<Profile, "employment" | "targets">): CodeFilterTargets {
  const { rolesToAvoid, regions, cities } = profile.targets;
  return { rolesToAvoid, regions, cities, maxYearsRequired: yearsLimitFor(profile).limit };
}

// Drops a posting before any run reads it, for one of four reasons from the person's targets: the title
// names a role to avoid, it asks for more years than the person's limit, it is not in a place they can work,
// or it is on-site outside the cities they chose. Every other worry (class year, relocation, a school screen)
// is a flag for the run.
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

  if (isOutsideTargetRegions(posting.location, targets)) {
    const places = targets.regions.map(regionName).join(", ");
    const reason = isRemoteLocation(posting.location)
      ? `The location "${posting.location}" is a remote job outside the places you chose (${places}).`
      : `The location "${posting.location}" is not in a place you chose (${places}).`;
    return { passes: false, reason };
  }

  if (isOutsideTargetCities(posting.location, targets.cities)) {
    return {
      passes: false,
      reason: `The location "${posting.location}" is not in a city you chose (${chosenCities(targets.cities).join(", ")}).`,
    };
  }

  return { passes: true };
}

// No places chosen means any place. A job in a chosen country counts, on-site or remote. A remote job also
// counts when Remote jobs is chosen and it names no country, or names any country when Remote jobs is the only
// place chosen (no country limits it then). An on-site job in a city the person chose counts wherever it is.
function isOutsideTargetRegions(location: string, targets: Pick<CodeFilterTargets, "regions" | "cities">): boolean {
  if (targets.regions.length === 0) return false;
  const chosen = targets.regions.map((code) => code.toUpperCase());
  const countries = chosen.filter((code) => code !== "REMOTE");
  const region = classifyRegion(location);
  if (countries.includes(region)) return false;

  if (isRemoteLocation(location)) {
    return !(chosen.includes("REMOTE") && (region === "REMOTE" || countries.length === 0));
  }
  return !namesAChosenCity(location, targets.cities);
}

// With cities chosen, an on-site job must name one of them as whole words, in any case ("Austin, TX" names
// Austin). A remote job always counts: it is done from home.
function isOutsideTargetCities(location: string, cities: readonly string[]): boolean {
  if (chosenCities(cities).length === 0 || isRemoteLocation(location)) return false;
  return !namesAChosenCity(location, cities);
}

function chosenCities(cities: readonly string[]): string[] {
  return cities.map((city) => city.trim()).filter((city) => city !== "");
}

function namesAChosenCity(location: string, cities: readonly string[]): boolean {
  return chosenCities(cities).some((city) => containsWholeWord(location, city));
}
