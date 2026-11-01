// What a line of resume text claims: its numbers, dates, named tools, and the names of employers and job
// titles. The truth trace compares these claims with the story item the line cites. Wording may change;
// facts may not. There is one small function per kind of fact: findDates, findNumbers, findTools, findNames.
// Spec: "Resume pipeline" step 2. ARCHITECTURE.md section 8.2 rule 3.
import type { StoryItem } from "@jobgoblin/schemas";
import { WELL_KNOWN_COMPANIES } from "./knownCompanies";
import { EVERYDAY_WORD_TECHNOLOGIES, KNOWN_TECHNOLOGIES } from "./knownTechnologies";
import { escapeRegExp, normalizeSpaces } from "./textHelpers";

export type FactKind = "number" | "date" | "tool" | "name";

export type Fact = {
  kind: FactKind;
  key: string; // what two facts are compared by, for example "number:40%" or "tool:postgresql"
  shown: string; // how a message writes it, for example "40%" or "PostgreSQL"
};

// ---------------------------------------------------------------------------------------------
// Vocabulary: the tool and name lists a text is searched with
// ---------------------------------------------------------------------------------------------

type TermMatcher = {
  term: string; // as the story or the built-in list spells it
  kind: "tool" | "name";
  key: string;
  pattern: RegExp; // finds the term as a whole word or phrase
};

export type Vocabulary = {
  tools: readonly TermMatcher[];
  names: readonly TermMatcher[];
};

export type VocabularyTerms = { tools: readonly string[]; names: readonly string[] };

// The terms given, plus the built-in lists of common technologies and well-known employers.
export function createVocabulary(terms: VocabularyTerms): Vocabulary {
  return {
    tools: compileTerms("tool", [...terms.tools, ...KNOWN_TECHNOLOGIES]),
    names: compileTerms("name", [...terms.names, ...WELL_KNOWN_COMPANIES]),
  };
}

// Everything in Your story counts, confirmed or not: a tool or employer that appears anywhere in the story
// must be backed by the item a line cites, so a pending or rejected item cannot be used to slip it in.
export function vocabularyFromStory(storyItems: readonly StoryItem[]): Vocabulary {
  const tools: string[] = [];
  const names: string[] = [];

  for (const item of storyItems) {
    tools.push(...item.data.tools);
    if (item.kind === "skill") tools.push(item.data.text);
    if (item.data.title !== undefined) names.push(item.data.title);
    if (item.data.organization !== undefined) names.push(item.data.organization);
  }
  return createVocabulary({ tools, names });
}

function compileTerms(kind: "tool" | "name", terms: readonly string[]): TermMatcher[] {
  const matchers: TermMatcher[] = [];
  const seenKeys = new Set<string>();

  for (const rawTerm of terms) {
    const term = normalizeSpaces(rawTerm);
    if (term === "") continue;
    const key = `${kind}:${term.toLowerCase()}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    matchers.push({ term, kind, key, pattern: wholeTermPattern(term) });
  }
  return matchers;
}

// "Go" and "REST" are everyday words, and one or two letters match too much, so those must be written
// exactly as listed. Other terms ignore case. A term is a whole word: "Java" does not match "JavaScript".
// "&" stops "R" matching in "R&D"; "+" and "#" stop "C" matching in "C++" and "C#".
function wholeTermPattern(term: string): RegExp {
  const body = term.split(" ").map(escapeRegExp).join("\\s+");
  const mustMatchCase = term.length <= 2 || EVERYDAY_WORD_TECHNOLOGIES.includes(term);
  return new RegExp(`(?<![A-Za-z0-9&])${body}(?![A-Za-z0-9+#&])`, mustMatchCase ? "" : "i");
}

// ---------------------------------------------------------------------------------------------
// extractFacts
// ---------------------------------------------------------------------------------------------

export function extractFacts(text: string, vocabulary: Vocabulary): Fact[] {
  const dates = findDates(text);
  const facts = [
    ...dates.facts,
    ...findNumbers(dates.textWithoutDates), // so "2024-06" is one date, not the numbers 2024 and 06
    ...findTools(text, vocabulary),
    ...findNames(text, vocabulary),
  ];
  return withoutDuplicateFacts(facts);
}

// A month-and-year date also backs its bare year: "since 2024" is true when the story says 2024-06.
// Used on the story's side of the comparison only, so "June 2025" is not excused by "2025" elsewhere.
export function supportedKeys(storyFacts: readonly Fact[]): Set<string> {
  const keys = new Set<string>();
  for (const fact of storyFacts) {
    keys.add(fact.key);
    const monthYear = /^date:(\d{4})-\d{2}$/.exec(fact.key);
    if (monthYear?.[1] !== undefined) keys.add(`date:${monthYear[1]}`);
  }
  return keys;
}

// Keeps the first fact of each key, in order.
export function withoutDuplicateFacts(facts: readonly Fact[]): Fact[] {
  const byKey = new Map<string, Fact>();
  for (const fact of facts) {
    if (!byKey.has(fact.key)) byKey.set(fact.key, fact);
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------------------------
// Dates: "June 2024", "Jun 2024", "2024-06", "06/2024" and bare years like "2024"
// ---------------------------------------------------------------------------------------------

const MONTH_PREFIXES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAME =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

type DateReader = { pattern: RegExp; toKey: (match: RegExpMatchArray) => string };

// Tried in this order, so "June 2024" is read as a month and year before "2024" is read as a bare year.
const DATE_READERS: readonly DateReader[] = [
  {
    pattern: new RegExp(String.raw`\b${MONTH_NAME}\.?,?\s+((?:19|20)\d{2})\b`, "gi"),
    toKey: (match) => `${group(match, 2)}-${monthNumber(group(match, 1))}`,
  },
  {
    pattern: /\b((?:19|20)\d{2})-(0[1-9]|1[0-2])\b/g,
    toKey: (match) => `${group(match, 1)}-${group(match, 2)}`,
  },
  {
    pattern: /\b(0?[1-9]|1[0-2])\/((?:19|20)\d{2})\b/g,
    toKey: (match) => `${group(match, 2)}-${group(match, 1).padStart(2, "0")}`,
  },
  {
    pattern: /\b((?:19|20)\d{2})\b/g,
    toKey: (match) => group(match, 1),
  },
];

function findDates(text: string): { facts: Fact[]; textWithoutDates: string } {
  const facts: Fact[] = [];
  let remaining = text;

  for (const reader of DATE_READERS) {
    for (const match of remaining.matchAll(reader.pattern)) {
      facts.push({ kind: "date", key: `date:${reader.toKey(match)}`, shown: match[0] });
    }
    remaining = remaining.replace(reader.pattern, " ");
  }
  return { facts, textWithoutDates: remaining };
}

function group(match: RegExpMatchArray, index: number): string {
  return match[index] ?? "";
}

function monthNumber(monthName: string): string {
  const index = MONTH_PREFIXES.indexOf(monthName.slice(0, 3).toLowerCase());
  return String(index + 1).padStart(2, "0");
}

// ---------------------------------------------------------------------------------------------
// Numbers: "500", "1,200", "40%", "3x", "$2M", "2 million", "99.9%"
// ---------------------------------------------------------------------------------------------

// A number is not part of a longer word (the 3 in "S3" or "p95" is a name, not a number). It may end in
// a unit: %, x, k, m or b stuck to the digits, or the words percent, thousand, million, billion.
const NUMBER_PATTERN =
  /(?<![A-Za-z0-9])(\$?)(\d+(?:,\d{3})*(?:\.\d+)?)(?:(%|x|k|m|b)(?![A-Za-z0-9])|\s?(percent|thousand|million|billion)(?![A-Za-z]))?/gi;

const UNIT_WORDS: Record<string, string> = { percent: "%", thousand: "k", million: "m", billion: "b" };

function findNumbers(text: string): Fact[] {
  const facts: Fact[] = [];
  for (const match of text.matchAll(NUMBER_PATTERN)) {
    const dollar = group(match, 1);
    const digits = group(match, 2).replaceAll(",", "");
    const unit = (match[3] ?? match[4] ?? "").toLowerCase();
    const normalizedUnit = UNIT_WORDS[unit] ?? unit;
    facts.push({ kind: "number", key: `number:${dollar}${digits}${normalizedUnit}`, shown: match[0].trim() });
  }
  return facts;
}

// ---------------------------------------------------------------------------------------------
// Tools and names
// ---------------------------------------------------------------------------------------------

// Tools and skills from Your story, plus the built-in list of common technologies.
function findTools(text: string, vocabulary: Vocabulary): Fact[] {
  return findTerms(text, vocabulary.tools);
}

// Job titles and organizations from Your story, plus well-known employers.
function findNames(text: string, vocabulary: Vocabulary): Fact[] {
  return findTerms(text, vocabulary.names);
}

function findTerms(text: string, matchers: readonly TermMatcher[]): Fact[] {
  const facts: Fact[] = [];
  for (const matcher of matchers) {
    if (matcher.pattern.test(text)) facts.push({ kind: matcher.kind, key: matcher.key, shown: matcher.term });
  }
  return facts;
}
