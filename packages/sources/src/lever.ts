// Lever postings. Every company has a public postings API named by its "slug", no key needed:
//   board:  GET https://api.lever.co/v0/postings/<slug>?mode=json   -> a JSON list of postings
//   one job: GET https://api.lever.co/v0/postings/<slug>/<id>        -> the same object, on its own
// Lever does not publish application questions, so `questions` is always empty. Spec: "Job discovery".
import type { Company, FeedPosting } from "@jobgoblin/schemas";
import { htmlToText, tidyText } from "./htmlToText";
import {
  asRecord,
  parseJsonArray,
  parseJsonObject,
  readIdText,
  readNumber,
  readRecord,
  readStringArray,
  readString,
  readArray,
  type JsonRecord,
} from "./json";
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

const API_ROOT = "https://api.lever.co/v0/postings";

export function leverBoardUrl(slug: string): string {
  return `${API_ROOT}/${encodeURIComponent(slug)}?mode=json`;
}

export function leverPostingUrl(slug: string, postingId: string): string {
  return `${API_ROOT}/${encodeURIComponent(slug)}/${encodeURIComponent(postingId)}`;
}

export function parseLeverBoard(responseBody: string, context: AtsParseContext): FeedPosting[] {
  const postings = parseJsonArray(responseBody, "The Lever postings response");
  return collectPostings(postings, (entry) => toLeverPosting(entry, context));
}

export function parseLeverPosting(responseBody: string, context: AtsParseContext): FeedPosting | null {
  const posting = parseJsonObject(responseBody, "The Lever posting response");
  return toLeverPosting(posting, context);
}

function toLeverPosting(entry: unknown, context: AtsParseContext): FeedPosting | null {
  const posting = asRecord(entry);
  if (posting === null) {
    return null;
  }
  const nativeId = readIdText(posting, "id");
  const title = readString(posting, "text").trim();
  if (nativeId === "" || title === "") {
    return null;
  }

  const feedSaysRemote = readString(posting, "workplaceType") === "remote";
  return acceptPosting({
    jobId: buildJobId("lever", context.slug, nativeId),
    source: "lever",
    company: companyNameFor(context, ""),
    title,
    location: locationWithRemoteNote(readLocation(posting), feedSaysRemote),
    url: httpUrlOrNull(readString(posting, "hostedUrl")),
    text: buildPostingText(posting),
    questions: [],
    postedAt: toIsoOrNull(readNumber(posting, "createdAt")),
  });
}

function readLocation(posting: JsonRecord): string {
  const categories = readRecord(posting, "categories");
  if (categories === null) {
    return "";
  }
  const location = readString(categories, "location").trim();
  return location !== "" ? location : readStringArray(categories, "allLocations").join(", ");
}

// Lever splits a posting into an intro, then named lists (responsibilities, requirements), then a closing note.
function buildPostingText(posting: JsonRecord): string {
  const intro = readString(posting, "descriptionPlain") || htmlToText(readString(posting, "description"));
  const parts = [tidyText(intro)];
  for (const entry of readArray(posting, "lists")) {
    const list = asRecord(entry);
    if (list !== null) {
      parts.push(`${readString(list, "text").trim()}\n${htmlToText(readString(list, "content"))}`);
    }
  }
  parts.push(tidyText(readString(posting, "additionalPlain")));
  return parts.filter((part) => part !== "").join("\n\n");
}

export async function fetchLeverBoard(reader: FeedReader, company: Company): Promise<FeedPosting[]> {
  const body = await reader.read({
    url: leverBoardUrl(company.slug),
    fixtureFile: `lever/${company.slug}.json`,
  });
  if (body === null) {
    return [];
  }
  return parseLeverBoard(body, { slug: company.slug, companyName: company.name });
}

// One posting by its link. Saved files live at lever/<slug>/<id>.json.
export async function fetchLeverPosting(reader: FeedReader, slug: string, postingId: string): Promise<FeedPosting | null> {
  const body = await reader.read({
    url: leverPostingUrl(slug, postingId),
    fixtureFile: `lever/${slug}/${postingId}.json`,
  });
  if (body === null) {
    return null;
  }
  return parseLeverPosting(body, { slug, companyName: null });
}
