// Greenhouse job boards. Every company has a public board API named by its "slug", no key needed:
//   board:  GET https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true
//   one job: GET https://boards-api.greenhouse.io/v1/boards/<slug>/jobs/<id>?questions=true
// The board list carries every description but not the application questions; those only come with a single
// job (checked against the live API: the list ignores questions=true). Spec: "Job discovery".
import type { Company, FeedPosting } from "@jobgoblin/schemas";
import { htmlToText } from "./htmlToText";
import { decodeEntities } from "./entities";
import {
  asRecord,
  readArray,
  readIdText,
  readRecord,
  readString,
  parseJsonObject,
  type JsonRecord,
} from "./json";
import { acceptPosting, buildJobId, collectPostings, companyNameFor, httpUrlOrNull, toIsoOrNull } from "./postings";
import type { AtsParseContext, FeedReader } from "./types";

const API_ROOT = "https://boards-api.greenhouse.io/v1/boards";

// Greenhouse names its own form fields (first_name, email, resume...). The company's screening
// questions are the ones whose field names start with "question_".
const CUSTOM_QUESTION_FIELD_PREFIX = "question_";

export function greenhouseBoardUrl(slug: string): string {
  return `${API_ROOT}/${encodeURIComponent(slug)}/jobs?content=true`;
}

export function greenhouseJobUrl(slug: string, jobId: string): string {
  return `${API_ROOT}/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(jobId)}?questions=true`;
}

export function parseGreenhouseBoard(responseBody: string, context: AtsParseContext): FeedPosting[] {
  const board = parseJsonObject(responseBody, "The Greenhouse board response");
  return collectPostings(readArray(board, "jobs"), (entry) => toGreenhousePosting(entry, context));
}

// A single job from the one-job endpoint. Returns null when the response is not a usable posting.
export function parseGreenhouseJob(responseBody: string, context: AtsParseContext): FeedPosting | null {
  const job = parseJsonObject(responseBody, "The Greenhouse job response");
  return toGreenhousePosting(job, context);
}

function toGreenhousePosting(entry: unknown, context: AtsParseContext): FeedPosting | null {
  const job = asRecord(entry);
  if (job === null) {
    return null;
  }
  const nativeId = readIdText(job, "id");
  const title = readString(job, "title").trim();
  if (nativeId === "" || title === "") {
    return null;
  }

  const location = readRecord(job, "location");
  return acceptPosting({
    jobId: buildJobId("greenhouse", context.slug, nativeId),
    source: "greenhouse",
    company: companyNameFor(context, readString(job, "company_name")),
    title,
    location: location === null ? "" : readString(location, "name").trim(),
    url: httpUrlOrNull(readString(job, "absolute_url")),
    text: htmlToText(unescapeContent(readString(job, "content"))),
    questions: readScreeningQuestions(job),
    postedAt: toIsoOrNull(job.first_published ?? job.updated_at),
  });
}

// Greenhouse sends the description's HTML escaped ("&lt;p&gt;"). Undo that once, and only when no real
// tags are present, so a board that already sends plain HTML is not unescaped twice.
function unescapeContent(content: string): string {
  return content.includes("<") ? content : decodeEntities(content);
}

function readScreeningQuestions(job: JsonRecord): string[] {
  const questions: string[] = [];
  for (const entry of readArray(job, "questions")) {
    const question = asRecord(entry);
    if (question !== null && isCustomQuestion(question)) {
      questions.push(describeQuestion(question));
    }
  }
  return questions;
}

function isCustomQuestion(question: JsonRecord): boolean {
  for (const entry of readArray(question, "fields")) {
    const field = asRecord(entry);
    if (field !== null && readString(field, "name").startsWith(CUSTOM_QUESTION_FIELD_PREFIX)) {
      return true;
    }
  }
  return false;
}

// The label is often a short title and the description holds the real question, so keep both.
function describeQuestion(question: JsonRecord): string {
  const label = readString(question, "label").trim();
  const description = htmlToText(readString(question, "description"));
  if (description === "" || description === label) {
    return label;
  }
  return label === "" ? description : `${label}: ${description}`;
}

export async function fetchGreenhouseBoard(reader: FeedReader, company: Company): Promise<FeedPosting[]> {
  const body = await reader.read({
    url: greenhouseBoardUrl(company.slug),
    fixtureFile: `greenhouse/${company.slug}.json`,
  });
  if (body === null) {
    return [];
  }
  return parseGreenhouseBoard(body, { slug: company.slug, companyName: company.name });
}

// One job by its link, with its application questions. Saved files live at greenhouse/<slug>/<id>.json.
export async function fetchGreenhouseJob(reader: FeedReader, slug: string, jobId: string): Promise<FeedPosting | null> {
  const body = await reader.read({
    url: greenhouseJobUrl(slug, jobId),
    fixtureFile: `greenhouse/${slug}/${jobId}.json`,
  });
  if (body === null) {
    return null;
  }
  return parseGreenhouseJob(body, { slug, companyName: null });
}
