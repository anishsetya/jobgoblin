// Fetching job feeds before a hunt run starts. Code reads every watched company's board and the open boards
// (through packages/sources), then each new posting is run through the person's code filter and the dedupe
// key, and stored in the jobs table. The run itself only reads that table (search_jobs).
// A posting the filter drops, or that repeats a role already found elsewhere, is still stored with the
// reason, so it is never shown and never looked at again.
// Spec: ARCHITECTURE.md section 10 (refreshFeedsIfHunt) and 6 (jobFilters).
import fs from "node:fs";
import path from "node:path";
import { Company, type FeedPosting, type Job } from "@jobgoblin/schemas";
import { classifyRegion, codeFilter, codeFilterTargetsFor, dedupeKey } from "@jobgoblin/core";
import { fetchFeeds, type FeedFailure } from "@jobgoblin/sources";
import {
  deleteFeedCacheEntriesBefore,
  getJob,
  getProfile,
  insertCompanyIfMissing,
  insertJobIfNew,
  listCompanies,
  listJobsByDedupeKey,
} from "@jobgoblin/storage";
import { z } from "zod";
import seedCompanies from "../seed/companies.json";
import type { ServerContext } from "../context";
import { createFeedCache } from "../feedCache";

const OPEN_BOARDS = ["hn", "yc", "remoteok", "wwr"] as const;
const FEED_CACHE_KEEP_DAYS = 14;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const DUPLICATE_REASON = "It is the same role as a posting that was already found, perhaps on another site.";

export type RefreshFeedsReport = {
  added: number; // new jobs a run may be shown
  filtered: number; // new jobs the person's targets ruled out
  duplicates: number; // new postings that repeat a role already found
  failures: FeedFailure[]; // feeds that could not be read; the others were still used
};

export async function refreshFeeds(ctx: ServerContext): Promise<RefreshFeedsReport> {
  seedCompaniesIfEmpty(ctx);

  const result = await fetchFeeds({
    companies: listCompanies(ctx.db),
    boards: [...OPEN_BOARDS],
    cache: createFeedCache(() => ctx.db),
    fixturesDir: ctx.options.feedFixturesDir,
    now: ctx.now,
  });

  const report = { ...storeNewPostings(ctx, result.postings), failures: result.failures };
  forgetOldFeedResponses(ctx);
  logReport(ctx, report);
  return report;
}

// ---------------------------------------------------------------------------------------------
// Storing postings
// ---------------------------------------------------------------------------------------------

type Counts = Omit<RefreshFeedsReport, "failures">;

function storeNewPostings(ctx: ServerContext, postings: FeedPosting[]): Counts {
  const targets = codeFilterTargetsFor(getProfile(ctx.db));
  const now = ctx.now().toISOString();
  const counts: Counts = { added: 0, filtered: 0, duplicates: 0 };

  // One transaction: thousands of postings are one commit, and a failure stores none of them.
  ctx.db.transaction(() => {
    for (const posting of postings) {
      if (getJob(ctx.db, posting.jobId) !== null) continue; // fetched before; nothing to decide again

      const key = dedupeKey(posting.company, posting.title, posting.location);
      const isDuplicate = listJobsByDedupeKey(ctx.db, key).some((other) => other.filteredReason === null);
      const verdict = codeFilter(posting, targets);

      const filteredReason = isDuplicate ? DUPLICATE_REASON : verdict.passes ? null : verdict.reason;
      insertJobIfNew(ctx.db, toJob(posting, key, filteredReason, now));

      if (isDuplicate) counts.duplicates += 1;
      else if (filteredReason !== null) counts.filtered += 1;
      else counts.added += 1;
    }
  });
  return counts;
}

function toJob(posting: FeedPosting, key: string, filteredReason: string | null, foundAt: string): Job {
  return {
    ...posting,
    dedupeKey: key,
    region: classifyRegion(posting.location),
    foundAt,
    seenAt: null,
    filteredReason,
  };
}

// A saved response of a board nobody reads any more would otherwise stay in the database for ever.
function forgetOldFeedResponses(ctx: ServerContext): void {
  const cutoff = new Date(ctx.now().getTime() - FEED_CACHE_KEEP_DAYS * MILLISECONDS_PER_DAY).toISOString();
  deleteFeedCacheEntriesBefore(ctx.db, cutoff);
}

function logReport(ctx: ServerContext, report: RefreshFeedsReport): void {
  ctx.logger.info(
    { added: report.added, filtered: report.filtered, duplicates: report.duplicates, failedFeeds: report.failures.length },
    "Checked job boards.",
  );
  for (const failure of report.failures) {
    ctx.logger.warn({ source: failure.source, slug: failure.slug, reason: failure.message }, "A job board could not be read.");
  }
}

// ---------------------------------------------------------------------------------------------
// The company list
// ---------------------------------------------------------------------------------------------

// On the very first start the companies table is empty. It is filled from the demo board's list when the
// server was started in demo mode, and from the built-in list of well-known companies otherwise.
// Returns how many companies were added.
export function seedCompaniesIfEmpty(ctx: ServerContext): number {
  if (listCompanies(ctx.db).length > 0) return 0;

  let added = 0;
  for (const company of readSeedCompanies(ctx.options.feedFixturesDir)) {
    if (insertCompanyIfMissing(ctx.db, company)) added += 1;
  }
  return added;
}

function readSeedCompanies(feedFixturesDir: string | null): Company[] {
  const CompanyList = z.array(Company);
  if (feedFixturesDir === null) return CompanyList.parse(seedCompanies);

  const text = fs.readFileSync(path.join(feedFixturesDir, "companies.json"), "utf8");
  return CompanyList.parse(JSON.parse(text));
}
