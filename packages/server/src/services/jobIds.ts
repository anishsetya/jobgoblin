// Ids for jobs that did not come from a feed: "<source>:<slug>:<id>" like every job id. The id part is made
// from the posting text or link, so adding the same thing twice gives the same id and is recognised.
// Spec: ARCHITECTURE.md section 5.4 (Job.jobId).
import { sha256Hex } from "@jobgoblin/core";

const ID_CHARACTERS = 12;

function slugOf(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug === "" ? "company" : slug;
}

// A job the person pasted as text.
export function pastedJobId(company: string, text: string): string {
  return `pasted:${slugOf(company)}:${sha256Hex(text).slice(0, ID_CHARACTERS)}`;
}

// A job a hunt run found on the web: the link when there is one, else the text.
export function webJobId(company: string, link: string | undefined, text: string): string {
  return `web:${slugOf(company)}:${sha256Hex(link ?? text).slice(0, ID_CHARACTERS)}`;
}
