// Fetching job feeds before a hunt run starts. Code reads every watched company's board and the open boards
// (through packages/sources), then each new posting is run through the person's code filter and the dedupe
// key, and stored in the jobs table. The run itself only reads that table (search_jobs).
// A posting the filter drops, or that repeats a role already found elsewhere, is stored with the reason, so
// it is not shown. Targets change, so before the new postings are stored, every job nobody has been shown
// yet is checked again against the current targets: a change reaches the jobs found before too.
// Spec: ARCHITECTURE.md section 10 (refreshFeedsIfHunt) and 6 (jobFilters).
import fs from "node:fs";
import path from "node:path";
import { Company, type FeedPosting, type Job } from "@jobgoblin/schemas";
import { classifyRegion, codeFilter, codeFilterTargetsFor, dedupeKey, type CodeFilterTargets } from "@jobgoblin/core";
import { fetchFeeds, type FeedFailure } from "@jobgoblin/sources";
import {
  deleteFeedCacheEntriesBefore,
  getJob,
  getProfile as readProfile,
  insertCompanyIfMissing,
  insertJobIfNew,
  listCompanies,
  listJobsByDedupeKey,
  listJobsNotYetSeen,
  setJobFilteredReason,
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
  restored: number; // jobs found before that the current targets let through again
  setAside: number; // jobs found before, not shown yet, that the current targets now rule out
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

  const targets = codeFilterTargetsFor(readProfile(ctx.db));
  const rechecked = recheckUnseenJobs(ctx, targets);
  const report = { ...storeNewPostings(ctx, result.postings, targets), ...rechecked, failures: result.failures };
  forgetOldFeedResponses(ctx);
  logReport(ctx, report);
  return report;
}

// ---------------------------------------------------------------------------------------------
// Checking the jobs found before
// ---------------------------------------------------------------------------------------------

type RecheckCounts = Pick<RefreshFeedsReport, "restored" | "setAside">;

// A job an old target ruled out comes back, and one the new targets rule out is put aside. A job that was
// already shown keeps its verdict (PRD D3): it is not in this list. Of the jobs that pass, a repeat of a role
// already in play (shown before, or kept earlier in this check) is a duplicate, so no role shows twice.
function recheckUnseenJobs(ctx: ServerContext, targets: CodeFilterTargets): RecheckCounts {
  const counts: RecheckCounts = { restored: 0, setAside: 0 };

  ctx.db.transaction(() => {
    const keptRoles = new Set<string>();
    for (const job of listJobsNotYetSeen(ctx.db)) {
      const verdict = codeFilter(job, targets);
      const isRepeat = verdict.passes && (keptRoles.has(job.dedupeKey) || wasShownAsAnotherPosting(ctx, job));
      const reason = !verdict.passes ? verdict.reason : isRepeat ? DUPLICATE_REASON : null;
      if (reason === null) keptRoles.add(job.dedupeKey);
      if (reason === job.filteredReason) continue;

      setJobFilteredReason(ctx.db, job.jobId, reason);
      if (reason === null) counts.restored += 1;
      else if (job.filteredReason === null) counts.setAside += 1;
    }
  });
  return counts;
}

// Another posting of the same role was shown to a run already, and the code filter let it through.
function wasShownAsAnotherPosting(ctx: ServerContext, job: Job): boolean {
  return listJobsByDedupeKey(ctx.db, job.dedupeKey).some(
    (other) => other.jobId !== job.jobId && other.seenAt !== null && other.filteredReason === null,
  );
}

// ---------------------------------------------------------------------------------------------
// Storing postings
// ---------------------------------------------------------------------------------------------

type NewPostingCounts = Pick<RefreshFeedsReport, "added" | "filtered" | "duplicates">;

function storeNewPostings(ctx: ServerContext, postings: FeedPosting[], targets: CodeFilterTargets): NewPostingCounts {
  const now = ctx.now().toISOString();
  const counts: NewPostingCounts = { added: 0, filtered: 0, duplicates: 0 };

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
    {
      added: report.added,
      filtered: report.filtered,
      duplicates: report.duplicates,
      restored: report.restored,
      setAside: report.setAside,
      failedFeeds: report.failures.length,
    },
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

const CompanyList = z.array(Company);
const WHAT_COMPANIES_JSON_HOLDS = "a JSON list of companies, each with id, name, ats, slug and status, like fixtures/feeds/demo/companies.json";

// The companies a first start adds. A demo board folder that can't give them stops the start with one plain line
// naming the file and what it must hold, never a raw ENOENT or JSON error. startServer reads it once before it
// creates anything, so a mistyped folder leaves no empty database behind.
export function readSeedCompanies(feedFixturesDir: string | null): Company[] {
  if (feedFixturesDir === null) return CompanyList.parse(seedCompanies);

  if (!fs.existsSync(feedFixturesDir)) {
    throw new Error(
      `The demo job board folder ${feedFixturesDir} doesn't exist. Point JOBGOBLIN_FEED_FIXTURES at fixtures/feeds/demo, or leave it unset to read the real job boards.`,
    );
  }
  const file = path.join(feedFixturesDir, "companies.json");
  if (!fs.existsSync(file)) {
    throw new Error(`The demo job board folder ${feedFixturesDir} has no companies.json. Add one: ${WHAT_COMPANIES_JSON_HOLDS}.`);
  }

  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file} is not valid JSON. It must be ${WHAT_COMPANIES_JSON_HOLDS}.`);
  }
  const companies = CompanyList.safeParse(json);
  if (!companies.success) {
    const where = companies.error.issues[0]?.path.join(".") ?? "";
    throw new Error(`${file} is not a list of companies${where === "" ? "" : ` (see ${where})`}. It must be ${WHAT_COMPANIES_JSON_HOLDS}.`);
  }
  return companies.data;
}
