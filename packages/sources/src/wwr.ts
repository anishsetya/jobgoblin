// We Work Remotely's public RSS feeds, one per job category, no key needed:
//   feed: GET https://weworkremotely.com/categories/<category>.rss
// An item's title reads "Company: Role". The description is escaped HTML, which htmlToText turns into text.
// Every job on the site is remote. Spec: "Job discovery" (We Work Remotely).
import type { FeedPosting } from "@jobgoblin/schemas";
import { htmlToText } from "./htmlToText";
import { acceptPosting, buildJobId, collectPostings, httpUrlOrNull, toIsoOrNull } from "./postings";
import { readRssItems, readXmlText } from "./rss";
import type { FeedReader } from "./types";

// The categories we read. A job can be listed in more than one, so exact repeats are removed after all are read.
export const WWR_CATEGORY_SLUGS = [
  "remote-back-end-programming-jobs",
  "remote-full-stack-programming-jobs",
  "remote-devops-sysadmin-jobs",
];

// Job ids look like "wwr:wwr:<last part of the posting link>".
const JOB_ID_SLUG = "wwr";

export function wwrCategoryUrl(categorySlug: string): string {
  return `https://weworkremotely.com/categories/${encodeURIComponent(categorySlug)}.rss`;
}

export function parseWwrFeed(responseBody: string): FeedPosting[] {
  return collectPostings(readRssItems(responseBody), toWwrPosting);
}

function toWwrPosting(itemXml: unknown): FeedPosting | null {
  if (typeof itemXml !== "string") {
    return null;
  }
  const link = readXmlText(itemXml, "link");
  const nativeId = lastPathPart(link);
  const { company, title } = splitTitle(readXmlText(itemXml, "title"));
  if (nativeId === "" || title === "") {
    return null;
  }

  return acceptPosting({
    jobId: buildJobId("wwr", JOB_ID_SLUG, nativeId),
    source: "wwr",
    company,
    title,
    location: describeLocation(itemXml),
    url: httpUrlOrNull(link),
    text: htmlToText(readXmlText(itemXml, "description")),
    questions: [],
    postedAt: toIsoOrNull(readXmlText(itemXml, "pubDate")),
  });
}

// "https://weworkremotely.com/remote-jobs/acme-backend-engineer" -> "acme-backend-engineer"
function lastPathPart(link: string): string {
  const parts = link.split("/").filter((part) => part !== "");
  return parts[parts.length - 1] ?? "";
}

// "Dropbox: Backend Engineer" -> company "Dropbox", title "Backend Engineer". The company is whatever
// comes before the first colon, since a role can contain colons of its own.
function splitTitle(fullTitle: string): { company: string; title: string } {
  const colon = fullTitle.indexOf(":");
  if (colon === -1) {
    return { company: "Unknown", title: fullTitle.trim() };
  }
  return {
    company: fullTitle.slice(0, colon).trim() || "Unknown",
    title: fullTitle.slice(colon + 1).trim(),
  };
}

// The feed gives a region ("Anywhere in the World", "USA Only") and sometimes a country or state.
function describeLocation(itemXml: string): string {
  const places = ["region", "country", "state"]
    .map((tagName) => readXmlText(itemXml, tagName).trim())
    .filter((place) => place !== "");
  return places.length === 0 ? "Remote" : `Remote - ${places.join(", ")}`;
}

export async function fetchWwrCategory(reader: FeedReader, categorySlug: string): Promise<FeedPosting[]> {
  const body = await reader.read({ url: wwrCategoryUrl(categorySlug), fixtureFile: `wwr/${categorySlug}.xml` });
  return body === null ? [] : parseWwrFeed(body);
}
