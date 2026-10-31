// Ashby job boards. Every company has a public posting API named by its "slug", no key needed:
//   board: GET https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true
// Ashby has no single-posting endpoint, so a pasted Ashby link reads the whole board and picks the job out.
// Ashby does not publish application questions, so `questions` is always empty. Spec: "Job discovery".
import type { Company, FeedPosting } from "@jobgoblin/schemas";
import { htmlToText, tidyText } from "./htmlToText";
import { asRecord, parseJsonObject, readArray, readIdText, readRecord, readString, type JsonRecord } from "./json";
import {
  acceptPosting,
  buildJobId,
  collectPostings,
  companyNameFor,
  httpUrlOrNull,
  locationWithRemoteNote,
  toIsoOrNull,
} from "./postings";
import type { AtsParseContext, FeedReader } from "./types";

const API_ROOT = "https://api.ashbyhq.com/posting-api/job-board";

export function ashbyBoardUrl(slug: string): string {
  return `${API_ROOT}/${encodeURIComponent(slug)}?includeCompensation=true`;
}

export function parseAshbyBoard(responseBody: string, context: AtsParseContext): FeedPosting[] {
  const board = parseJsonObject(responseBody, "The Ashby board response");
  return collectPostings(readArray(board, "jobs"), (entry) => toAshbyPosting(entry, context));
}

function toAshbyPosting(entry: unknown, context: AtsParseContext): FeedPosting | null {
  const job = asRecord(entry);
  if (job === null) {
    return null;
  }
  const nativeId = readIdText(job, "id");
  const title = readString(job, "title").trim();
  // Ashby keeps unlisted jobs (hidden from the public board) in the response; they are not open to apply.
  const isUnlisted = job.isListed === false;
  if (nativeId === "" || title === "" || isUnlisted) {
    return null;
  }

  const feedSaysRemote = job.isRemote === true || readString(job, "workplaceType") === "Remote";
  return acceptPosting({
    jobId: buildJobId("ashby", context.slug, nativeId),
    source: "ashby",
    company: companyNameFor(context, ""),
    title,
    location: locationWithRemoteNote(readLocations(job), feedSaysRemote),
    url: httpUrlOrNull(readString(job, "jobUrl")),
    text: buildPostingText(job),
    questions: [],
    postedAt: toIsoOrNull(readString(job, "publishedAt")),
  });
}

// The main location first, then any secondary ones: "San Francisco, CA / New York, NY".
function readLocations(job: JsonRecord): string {
  const locations = [readString(job, "location").trim()];
  for (const entry of readArray(job, "secondaryLocations")) {
    const secondary = asRecord(entry);
    if (secondary !== null) {
      locations.push(readString(secondary, "location").trim());
    }
  }
  const named = locations.filter((location) => location !== "");
  return [...new Set(named)].join(" / ");
}

function buildPostingText(job: JsonRecord): string {
  const description = readString(job, "descriptionPlain") || htmlToText(readString(job, "descriptionHtml"));
  const compensation = readRecord(job, "compensation");
  const summary = compensation === null ? "" : readString(compensation, "compensationTierSummary").trim();
  const text = tidyText(description);
  return summary === "" ? text : `${text}\n\nCompensation: ${summary}`;
}

export async function fetchAshbyBoard(reader: FeedReader, company: Company): Promise<FeedPosting[]> {
  const body = await reader.read({
    url: ashbyBoardUrl(company.slug),
    fixtureFile: `ashby/${company.slug}.json`,
  });
  if (body === null) {
    return [];
  }
  return parseAshbyBoard(body, { slug: company.slug, companyName: company.name });
}

// One posting by its link: read the slug's board and keep the job with that id.
export async function fetchAshbyPosting(reader: FeedReader, slug: string, postingId: string): Promise<FeedPosting | null> {
  const body = await reader.read({
    url: ashbyBoardUrl(slug),
    fixtureFile: `ashby/${slug}.json`,
  });
  if (body === null) {
    return null;
  }
  const wantedJobId = buildJobId("ashby", slug, postingId);
  const postings = parseAshbyBoard(body, { slug, companyName: null });
  return postings.find((posting) => posting.jobId === wantedJobId) ?? null;
}
