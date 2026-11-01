// Hacker News "Ask HN: Who is hiring?", read through the public Algolia API (no key needed):
//   find the thread: GET https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring
//   read the thread: GET https://hn.algolia.com/api/v1/items/<thread id>   -> the thread with all comments
// Each top-level comment is one company's job post. By custom the first line is a header such as
// "Company | Role | Location | Remote | Full-time", which is what we read the company, title and location from.
// Spec: "Job discovery" (HN Who is hiring).
import type { FeedPosting } from "@jobgoblin/schemas";
import { htmlToText } from "./htmlToText";
import { asRecord, parseJsonObject, readArray, readIdText, readString } from "./json";
import { acceptPosting, buildJobId, collectPostings, toIsoOrNull } from "./postings";
import type { FeedReader } from "./types";

const SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5";
const THREAD_FIXTURE = "hn/thread.json";

// Job ids look like "hn:hn:<comment id>". HN comment ids are unique across the whole site, so no thread
// name is needed in the id.
const JOB_ID_SLUG = "hn";

// Headers separate their parts with "|" or with a spaced dash: "Acme — Backend Engineer — Remote".
const HEADER_SEPARATOR = /\s*\|\s*|\s+[—–-]\s+/;
const ROLE_WORDS = /engineer|developer|\bswe\b|programmer|member of technical staff|\bmts\b/i;
// Parts that say where the job is. Anything else (a tech stack, a funding stage) is not a location.
const LOCATION_WORDS = /remote|onsite|on-site|hybrid|united states|europe|india|canada|bay area/i;
const LOCATION_CODES = /\b(US|USA|UK|EU|NYC|SF)\b|,\s*[A-Z]{2}\b/; // "NYC", or "Austin, TX"
const MAX_COMPANY_LENGTH = 80;
const MAX_HEADER_FIELD_LENGTH = 120;

export function hnThreadUrl(threadId: string): string {
  return `https://hn.algolia.com/api/v1/items/${encodeURIComponent(threadId)}`;
}

// The search returns "Who is hiring?" and "Who wants to be hired?" side by side; we want the first.
export function findHiringThreadId(searchResponseBody: string): string {
  const search = parseJsonObject(searchResponseBody, "The Hacker News search response");
  for (const entry of readArray(search, "hits")) {
    const hit = asRecord(entry);
    if (hit !== null && readString(hit, "title").toLowerCase().includes("who is hiring")) {
      return readIdText(hit, "objectID");
    }
  }
  throw new Error('No "Who is hiring?" thread was found on Hacker News.');
}

export function parseHnThread(responseBody: string): FeedPosting[] {
  const thread = parseJsonObject(responseBody, "The Hacker News thread response");
  // Only top-level comments are job posts; replies underneath them are people asking questions.
  return collectPostings(readArray(thread, "children"), toHnPosting);
}

function toHnPosting(entry: unknown): FeedPosting | null {
  const comment = asRecord(entry);
  if (comment === null) {
    return null;
  }
  const commentId = readIdText(comment, "id");
  const text = htmlToText(readString(comment, "text"));
  // Deleted comments have no text.
  if (commentId === "" || text === "") {
    return null;
  }

  const header = readHeader(text);
  return acceptPosting({
    jobId: buildJobId("hn", JOB_ID_SLUG, commentId),
    source: "hn",
    company: header.company,
    title: header.title,
    location: header.location,
    url: `https://news.ycombinator.com/item?id=${commentId}`,
    text,
    questions: [],
    postedAt: toIsoOrNull(readString(comment, "created_at")),
  });
}

type HnHeader = { company: string; title: string; location: string };

function readHeader(text: string): HnHeader {
  const headerLine = text.split("\n", 1)[0] ?? "";
  const parts = headerLine
    .split(HEADER_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== "");

  const companyPart = parts[0] ?? "";
  const otherParts = parts.slice(1);
  const rolePart = otherParts.find((part) => ROLE_WORDS.test(part));
  const locationParts = otherParts.filter((part) => part !== rolePart && looksLikeLocation(part));
  // "PrairieLearn (Remote US)" hides the location in brackets after the company name.
  const bracketedLocation = readBracketedLocation(companyPart);
  if (bracketedLocation !== "") {
    locationParts.unshift(bracketedLocation);
  }

  return {
    company: removeBrackets(companyPart).slice(0, MAX_COMPANY_LENGTH) || "Unknown",
    // When nothing in the header looks like a role or a place, the whole line is the best description.
    title: (rolePart ?? headerLine).slice(0, MAX_HEADER_FIELD_LENGTH),
    location: (locationParts.join(" / ") || headerLine).slice(0, MAX_HEADER_FIELD_LENGTH),
  };
}

function looksLikeLocation(text: string): boolean {
  return LOCATION_WORDS.test(text) || LOCATION_CODES.test(text);
}

function removeBrackets(text: string): string {
  return text.replace(/\s*\([^)]*\)/g, "").trim();
}

function readBracketedLocation(text: string): string {
  const match = /\(([^)]*)\)/.exec(text);
  const inside = match?.[1] ?? "";
  return looksLikeLocation(inside) ? inside.trim() : "";
}

export async function fetchHnPostings(reader: FeedReader): Promise<FeedPosting[]> {
  const body = await readThread(reader);
  return body === null ? [] : parseHnThread(body);
}

async function readThread(reader: FeedReader): Promise<string | null> {
  if (reader.readsSavedFiles) {
    // The saved file already is the thread, so there is no search to run. The url is not used.
    return reader.read({ url: SEARCH_URL, fixtureFile: THREAD_FIXTURE });
  }
  const searchBody = await reader.read({ url: SEARCH_URL, fixtureFile: THREAD_FIXTURE });
  if (searchBody === null) {
    return null;
  }
  const threadId = findHiringThreadId(searchBody);
  return reader.read({ url: hnThreadUrl(threadId), fixtureFile: THREAD_FIXTURE });
}
