// Helpers every feed parser shares when it builds a FeedPosting: job ids, dates, links, company names,
// and the final check against the shared schema. Spec: "Job discovery"; ARCHITECTURE.md section 5.4.
import { FeedPosting, HttpUrl, type JobSource } from "@jobgoblin/schemas";
import type { AtsParseContext } from "./types";

// The job id format used everywhere: "<source>:<slug>:<native id>", for example "greenhouse:acmecloud:4012345".
export function buildJobId(source: JobSource, slug: string, nativeId: string): string {
  return `${source}:${slug}:${nativeId}`;
}

// Feeds give dates as ISO text with an offset, as epoch milliseconds (Lever), or as nothing useful
// (YC says "4 months"). Anything that is not a real date becomes null.
export function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// A posting link ends up in a click that opens the person's browser, so only web links survive.
export function httpUrlOrNull(value: string): string | null {
  const result = HttpUrl.safeParse(value.trim());
  return result.success ? result.data : null;
}

// The last gate for every parser: a posting leaves this package only if it satisfies the shared schema.
export function acceptPosting(candidate: unknown): FeedPosting | null {
  const result = FeedPosting.safeParse(candidate);
  return result.success ? result.data : null;
}

// Turns each raw entry into a posting and keeps the ones that worked. A raw entry with no id or title
// has nothing the person could open or read, so it is skipped rather than failing the whole feed.
export function collectPostings(rawEntries: unknown[], toPosting: (entry: unknown) => FeedPosting | null): FeedPosting[] {
  const postings: FeedPosting[] = [];
  for (const entry of rawEntries) {
    const posting = toPosting(entry);
    if (posting !== null) {
      postings.push(posting);
    }
  }
  return postings;
}

// The person's own name for the company wins; then the feed's name; then the slug made readable.
export function companyNameFor(context: AtsParseContext, nameInFeed: string): string {
  if (context.companyName !== null && context.companyName.trim() !== "") {
    return context.companyName.trim();
  }
  if (nameInFeed.trim() !== "") {
    return nameInFeed.trim();
  }
  return displayNameFromSlug(context.slug);
}

// "copper-leaf" becomes "Copper Leaf". Only used when a pasted link gives us nothing better.
export function displayNameFromSlug(slug: string): string {
  const words = slug.split(/[-_]+/).filter((word) => word !== "");
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

// Feeds that mark a job as remote in a separate field would lose that fact in a plain location string,
// so say it in words when the location text does not already.
export function locationWithRemoteNote(location: string, feedSaysRemote: boolean): string {
  if (!feedSaysRemote || /remote/i.test(location)) {
    return location;
  }
  return location === "" ? "Remote" : `${location} (Remote)`;
}

// The same posting can reach us twice from one source (a job listed in two We Work Remotely categories).
// Exact repeats of a job id are dropped here; matching the same job across sites is the server's dedupe key.
export function removeRepeatedJobIds(postings: FeedPosting[]): FeedPosting[] {
  const seen = new Set<string>();
  const unique: FeedPosting[] = [];
  for (const posting of postings) {
    if (!seen.has(posting.jobId)) {
      seen.add(posting.jobId);
      unique.push(posting);
    }
  }
  return unique;
}
