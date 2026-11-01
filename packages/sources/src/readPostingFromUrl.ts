// Reads one job from a link the person pasted. Public Greenhouse, Lever and Ashby links are fetched by
// code; sites that need a login, and anything we do not recognize, ask the person to paste the text instead.
// Spec: "Job discovery" (Paste a job); ARCHITECTURE.md section 11 (POST /api/jobs).
import type { FeedPosting } from "@jobgoblin/schemas";
import { fetchAshbyPosting } from "./ashby";
import { createFeedReader } from "./feedReaders";
import { fetchGreenhouseJob } from "./greenhouse";
import { fetchLeverPosting } from "./lever";
import { recognizePostingLink, type PostingLink } from "./postingLinks";
import type { FeedReader, ReadPostingOptions, ReadPostingResult } from "./types";

export async function readPostingFromUrl(url: string, options: ReadPostingOptions): Promise<ReadPostingResult> {
  const link = recognizePostingLink(url);
  if (link.kind === "login-only") {
    return { kind: "needs-text", reason: "login-only" };
  }
  if (link.kind === "unknown") {
    return { kind: "needs-text", reason: "unreadable" };
  }

  const reader = createFeedReader({ ...options, now: () => new Date() });
  const posting = await readPublicPosting(reader, link);
  if (posting === null) {
    return { kind: "needs-text", reason: "unreadable" };
  }
  return { kind: "posting", posting };
}

type PublicPostingLink = Exclude<PostingLink, { kind: "login-only" | "unknown" }>;

// A closed posting, a typo in the link and a network problem all look the same to the person: they paste
// the text. The result type has no place for the reason, so the error is turned into null here.
async function readPublicPosting(reader: FeedReader, link: PublicPostingLink): Promise<FeedPosting | null> {
  try {
    switch (link.kind) {
      case "greenhouse":
        return await fetchGreenhouseJob(reader, link.slug, link.id);
      case "lever":
        return await fetchLeverPosting(reader, link.slug, link.id);
      case "ashby":
        return await fetchAshbyPosting(reader, link.slug, link.id);
    }
  } catch {
    return null;
  }
}
