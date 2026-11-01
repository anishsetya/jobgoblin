// Remote OK's public job feed: one JSON list of remote jobs, no key needed.
//   feed: GET https://remoteok.com/api
// The first entry is a legal notice, not a job. Remote OK asks for a link back to the posting on its site,
// which is exactly the `url` we keep. Spec: "Job discovery" (RemoteOK).
import type { FeedPosting } from "@jobgoblin/schemas";
import { decodeEntities } from "./entities";
import { htmlToText } from "./htmlToText";
import { asRecord, parseJsonArray, readIdText, readNumber, readString, readStringArray, type JsonRecord } from "./json";
import { acceptPosting, buildJobId, collectPostings, httpUrlOrNull, toIsoOrNull } from "./postings";
import type { FeedReader } from "./types";

const FEED_URL = "https://remoteok.com/api";
const FEED_FIXTURE = "remoteok/feed.json";

// Job ids look like "remoteok:remoteok:<id>".
const JOB_ID_SLUG = "remoteok";

export function parseRemoteOk(responseBody: string): FeedPosting[] {
  const entries = parseJsonArray(responseBody, "The Remote OK response");
  return collectPostings(entries, toRemoteOkPosting);
}

function toRemoteOkPosting(entry: unknown): FeedPosting | null {
  const job = asRecord(entry);
  if (job === null) {
    return null;
  }
  const nativeId = readIdText(job, "id");
  // Titles and names arrive with HTML entities ("Support &amp; Booking"). The legal notice has no id or position.
  const title = decodeEntities(readString(job, "position")).trim();
  if (nativeId === "" || title === "") {
    return null;
  }

  return acceptPosting({
    jobId: buildJobId("remoteok", JOB_ID_SLUG, nativeId),
    source: "remoteok",
    company: decodeEntities(readString(job, "company")).trim() || "Unknown",
    title,
    location: describeLocation(readString(job, "location")),
    url: httpUrlOrNull(readString(job, "url")),
    text: buildPostingText(job),
    questions: [],
    postedAt: toIsoOrNull(readString(job, "date")),
  });
}

// Every Remote OK job is remote; the feed's location is where the company wants people to be.
function describeLocation(feedLocation: string): string {
  const place = decodeEntities(feedLocation).trim();
  return place === "" ? "Remote" : `Remote - ${place}`;
}

function buildPostingText(job: JsonRecord): string {
  const parts = [htmlToText(readString(job, "description"))];
  const tags = readStringArray(job, "tags");
  if (tags.length > 0) {
    parts.push(`Tags: ${tags.join(", ")}`);
  }
  const salaryMin = readNumber(job, "salary_min");
  const salaryMax = readNumber(job, "salary_max");
  // The feed uses 0 for "not given".
  if (salaryMin !== null && salaryMax !== null && salaryMax > 0) {
    parts.push(`Salary: $${salaryMin} - $${salaryMax}`);
  }
  return parts.filter((part) => part !== "").join("\n\n");
}

export async function fetchRemoteOkPostings(reader: FeedReader): Promise<FeedPosting[]> {
  const body = await reader.read({ url: FEED_URL, fixtureFile: FEED_FIXTURE });
  return body === null ? [] : parseRemoteOk(body);
}
