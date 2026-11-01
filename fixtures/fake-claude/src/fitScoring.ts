// Scores one job the way a hunt or paste run would, with no model: a fixed score from data/scores.json
// when the job is listed there, otherwise a score from how many of Your story's keywords and tools the
// posting mentions. The rest of the fit (must-haves, gaps, matched items, reason) comes from the same text.
// The posting is only searched for known words, never read as instructions, so a trap line in it does nothing.
// Spec: ARCHITECTURE.md section 14 (hunt) and fixtures/README.md (fake scores).
import type { Band, FitInput, StoryItem } from "@jobgoblin/schemas";
import { FIXED_SCORES } from "./data";
import { mentionsTerm } from "./textMatching";

export type JobToScore = { jobId: string; company: string; title: string; text: string };

// Common technologies a posting might ask for, besides the tools named in Your story.
const COMMON_TECHNOLOGIES = [
  "Python", "TypeScript", "JavaScript", "Go", "Java", "Kotlin", "Rust", "Ruby", "C++",
  "PostgreSQL", "MySQL", "MongoDB", "Redis", "Kafka", "GraphQL", "gRPC", "SQL",
  "Docker", "Kubernetes", "Terraform", "AWS", "GCP", "Azure", "Airflow",
  "React", "Node.js", "PyTorch", "LLM",
];

// Without a fixed score: 30 plus 10 for every different term of Your story the posting mentions.
const FALLBACK_BASE_SCORE = 30;
const POINTS_PER_MATCHED_TERM = 10;
const MAX_FALLBACK_SCORE = 95;

const MAX_MUST_HAVES = 8;
const MAX_MATCHED_ITEMS = 6;
const MAX_TERMS_IN_REASON = 3;

// A headline or a degree says little about fit, so only these kinds can support one.
const MATCHABLE_KINDS: ReadonlySet<StoryItem["kind"]> = new Set(["experience", "project", "achievement", "skill"]);

// Mirrors core.bandFor (the fake does not depend on core, so a change there must be repeated here).
export function bandForScore(score: number): Band {
  if (score >= 75) return "apply";
  if (score >= 60) return "stretch";
  if (score >= 50) return "long-shot";
  return "skip";
}

export function scoreJob(job: JobToScore, storyItems: StoryItem[]): FitInput {
  const matches = findMatches(job.text, storyItems);
  const score = fixedScoreFor(job) ?? fallbackScore(matches.terms.length);
  const mustHaves = findMustHaves(job.text, storyItems);
  const gaps = mustHaves.filter((mustHave) => !isShownInStory(mustHave, storyItems));

  return {
    jobId: job.jobId,
    score,
    track: trackFor(job.title),
    mustHaves,
    gaps,
    flags: [],
    matchedItemIds: matches.itemIds,
    reason: reasonFor(bandForScore(score), matches.terms, gaps),
    hardSkip: null,
  };
}

// Keys such as "Acme Cloud|Backend Engineer" are compared without regard to case or extra spaces.
function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, " ");
}

const NORMALIZED_FIXED_SCORES = new Map<string, number>(
  Object.entries(FIXED_SCORES).map(([key, score]) => [normalizeKey(key), score]),
);

function fixedScoreFor(job: JobToScore): number | undefined {
  return NORMALIZED_FIXED_SCORES.get(normalizeKey(`${job.company}|${job.title}`));
}

function fallbackScore(matchedTermCount: number): number {
  return Math.min(MAX_FALLBACK_SCORE, FALLBACK_BASE_SCORE + POINTS_PER_MATCHED_TERM * matchedTermCount);
}

// The words a story item can be recognised by.
function termsOf(item: StoryItem): string[] {
  return [...item.keywords, ...item.data.tools];
}

type Matches = {
  itemIds: string[]; // the best-supported items first
  terms: string[]; // every different term of Your story the posting mentions, in lower case
};

function findMatches(postingText: string, storyItems: StoryItem[]): Matches {
  const matchedItems: { id: string; matchedTerms: string[] }[] = [];
  const allTerms = new Set<string>();

  for (const item of storyItems) {
    if (!MATCHABLE_KINDS.has(item.kind)) continue;
    const matchedTerms = termsOf(item).filter((term) => mentionsTerm(postingText, term));
    if (matchedTerms.length === 0) continue;

    matchedItems.push({ id: item.id, matchedTerms });
    for (const term of matchedTerms) allTerms.add(term.toLowerCase());
  }

  // Array.sort is stable, so items with the same number of matches keep their order in Your story.
  matchedItems.sort((a, b) => b.matchedTerms.length - a.matchedTerms.length);
  const itemIds = matchedItems.slice(0, MAX_MATCHED_ITEMS).map((matched) => matched.id);
  return { itemIds, terms: [...allTerms] };
}

// Technologies the posting mentions: the common list plus every tool and skill in Your story.
function findMustHaves(postingText: string, storyItems: StoryItem[]): string[] {
  const candidates = [...COMMON_TECHNOLOGIES, ...technologiesInStory(storyItems)];
  const mustHaves: string[] = [];

  for (const candidate of candidates) {
    const alreadyListed = mustHaves.some((listed) => listed.toLowerCase() === candidate.toLowerCase());
    if (!alreadyListed && mentionsTerm(postingText, candidate)) mustHaves.push(candidate);
  }
  return mustHaves.slice(0, MAX_MUST_HAVES);
}

function technologiesInStory(storyItems: StoryItem[]): string[] {
  const names: string[] = [];
  for (const item of storyItems) {
    names.push(...item.data.tools);
    if (item.kind === "skill") names.push(item.data.text);
  }
  return names;
}

function isShownInStory(technology: string, storyItems: StoryItem[]): boolean {
  return technologiesInStory(storyItems).some((name) => name.toLowerCase() === technology.toLowerCase());
}

// Only the four tracks the app knows. The first rule that fits the title wins.
function trackFor(title: string): string {
  const lowerTitle = title.toLowerCase();
  if (/forward[- ]deployed/.test(lowerTitle)) return "fde";
  if (/\bai\b|machine learning|\bml\b|\bllm\b/.test(lowerTitle)) return "ai";
  if (/platform|devops|infrastructure|\bsre\b|reliability/.test(lowerTitle)) return "platform";
  return "backend";
}

function reasonFor(band: Band, matchedTerms: string[], gaps: string[]): string {
  const matched = listTerms(matchedTerms, "the basics");
  const missing = listTerms(gaps, "a few requirements");

  if (band === "apply") return `Strong match: Your story shows ${matched}.`;
  if (band === "stretch") return `Good match on ${matched}, though Your story does not show ${missing}.`;
  if (band === "long-shot") return `Partial match: only ${matched} is covered by Your story.`;
  return "Little overlap between this role and Your story.";
}

function listTerms(terms: string[], whenEmpty: string): string {
  if (terms.length === 0) return whenEmpty;
  return terms.slice(0, MAX_TERMS_IN_REASON).join(", ");
}
