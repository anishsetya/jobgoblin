// Y Combinator's public job listings (ycombinator.com/jobs). There is no API: each role page is HTML
// that carries its data as JSON inside a `data-page="..."` attribute, which we read.
//   page: GET https://www.ycombinator.com/jobs/role/<role>   for a few engineering roles
// The page lists a company's one-liner and the role's basics, not the full description, so the posting
// text is built from those. Applying needs a YC login, which is why the link we keep is the public posting.
// Spec: "Job discovery" (YC jobs).
import type { FeedPosting } from "@jobgoblin/schemas";
import { decodeEntities } from "./entities";
import { asRecord, parseJson, readArray, readIdText, readRecord, readString, type JsonRecord } from "./json";
import { acceptPosting, buildJobId, collectPostings, httpUrlOrNull } from "./postings";
import type { FeedReader } from "./types";

// The role pages we read. A job can appear on several, so exact repeats are removed after all are read.
export const YC_ROLE_SLUGS = [
  "software-engineer",
  "machine-learning-engineer",
  "devops-engineer",
  "backend-engineer",
  "full-stack-engineer",
];

const SITE = "https://www.ycombinator.com";
const DATA_PAGE_ATTRIBUTE = /data-page="([^"]+)"/;

// Job ids look like "yc:yc:<YC job id>": the same job gets one id whichever role page it came from.
const JOB_ID_SLUG = "yc";

export function ycRoleUrl(roleSlug: string): string {
  return `${SITE}/jobs/role/${encodeURIComponent(roleSlug)}`;
}

export function parseYcPage(responseBody: string): FeedPosting[] {
  const match = DATA_PAGE_ATTRIBUTE.exec(responseBody);
  if (match === null || match[1] === undefined) {
    throw new Error("The YC jobs page had no data-page attribute, so its layout may have changed.");
  }
  // The attribute is HTML-escaped JSON (&quot; for quotes), so decode first and parse second.
  const page = asRecord(parseJson(decodeEntities(match[1]), "The YC jobs page data"));
  const props = page === null ? null : readRecord(page, "props");
  if (props === null) {
    throw new Error("The YC jobs page data had no props.");
  }
  return collectPostings(readArray(props, "jobPostings"), toYcPosting);
}

function toYcPosting(entry: unknown): FeedPosting | null {
  const job = asRecord(entry);
  if (job === null) {
    return null;
  }
  const nativeId = readIdText(job, "id");
  const title = readString(job, "title").trim();
  if (nativeId === "" || title === "") {
    return null;
  }

  return acceptPosting({
    jobId: buildJobId("yc", JOB_ID_SLUG, nativeId),
    source: "yc",
    company: readString(job, "companyName").trim() || "Unknown",
    title,
    location: readString(job, "location").trim(),
    url: httpUrlOrNull(SITE + readString(job, "url")),
    text: buildPostingText(job),
    questions: [],
    // The page says "4 months", not a date, so there is nothing reliable to record.
    postedAt: null,
  });
}

function buildPostingText(job: JsonRecord): string {
  const details = [
    labeledLine("Role type", readString(job, "roleSpecificType")),
    labeledLine("Employment", readString(job, "type")),
    labeledLine("Experience", readString(job, "minExperience")),
    labeledLine("Visa", readString(job, "visa")),
    labeledLine("Salary", readString(job, "salaryRange")),
    labeledLine("Equity", readString(job, "equityRange")),
  ];
  const oneLiner = readString(job, "companyOneLiner").trim();
  const detailLines = details.filter((line) => line !== "").join("\n");
  return [oneLiner, detailLines].filter((part) => part !== "").join("\n\n");
}

function labeledLine(label: string, value: string): string {
  return value.trim() === "" ? "" : `${label}: ${value.trim()}`;
}

export async function fetchYcRolePage(reader: FeedReader, roleSlug: string): Promise<FeedPosting[]> {
  const body = await reader.read({ url: ycRoleUrl(roleSlug), fixtureFile: `yc/${roleSlug}.html` });
  return body === null ? [] : parseYcPage(body);
}
