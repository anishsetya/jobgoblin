// Reads every watched company's board plus the chosen job boards and returns their postings, along with
// the feeds that failed. It does not filter, score or dedupe by role: the server does that with the rules
// in packages/core. Spec: "Job discovery"; ARCHITECTURE.md sections 5.4 and 10 (refreshFeedsIfHunt).
import type { Company, FeedPosting, JobSource } from "@jobgoblin/schemas";
import { fetchAshbyBoard } from "./ashby";
import { createFeedReader } from "./feedReaders";
import { fetchGreenhouseBoard } from "./greenhouse";
import { fetchHnPostings } from "./hn";
import { fetchLeverBoard } from "./lever";
import { removeRepeatedJobIds } from "./postings";
import { fetchRemoteOkPostings } from "./remoteok";
import type { FeedFailure, FeedReader, FetchFeedsInput, FetchFeedsResult } from "./types";
import { fetchWwrCategory, WWR_CATEGORY_SLUGS } from "./wwr";
import { fetchYcRolePage, YC_ROLE_SLUGS } from "./yc";

type Board = FetchFeedsInput["boards"][number];

// One feed to read: a company's board, one YC role page, one We Work Remotely category, and so on.
// `slug` names it in a failure message ("greenhouse / acmecloud: HTTP 404").
type FeedTask = {
  source: JobSource;
  slug: string;
  read: () => Promise<FeedPosting[]>;
};

export async function fetchFeeds(input: FetchFeedsInput): Promise<FetchFeedsResult> {
  const now = input.now ?? (() => new Date());
  const reader = createFeedReader({ cache: input.cache, fixturesDir: input.fixturesDir, now });
  return fetchFeedsWithReader(reader, input.companies, input.boards);
}

// The part of fetchFeeds that does not care where responses come from, so tests can pass a reader of their own.
export async function fetchFeedsWithReader(
  reader: FeedReader,
  companies: Company[],
  boards: Board[],
): Promise<FetchFeedsResult> {
  const tasks = [...planCompanyTasks(reader, companies), ...planBoardTasks(reader, boards)];
  // Every task starts at once. The polite fetcher still spaces requests to the same host one second apart,
  // while Greenhouse, Lever and Ashby (three different hosts) proceed side by side.
  const outcomes = await Promise.all(tasks.map(runTask));

  const postings: FeedPosting[] = [];
  const failures: FeedFailure[] = [];
  for (const outcome of outcomes) {
    if (outcome.failure !== null) {
      failures.push(outcome.failure);
    } else {
      postings.push(...outcome.postings);
    }
  }
  return { postings: removeRepeatedJobIds(postings), failures };
}

// Only Watching companies are read; Suggested ones wait for the person and Passed ones are ignored.
function planCompanyTasks(reader: FeedReader, companies: Company[]): FeedTask[] {
  const tasks: FeedTask[] = [];
  for (const company of companies) {
    if (company.status !== "Watching") {
      continue;
    }
    tasks.push({
      source: company.ats,
      slug: company.slug,
      read: () => readCompanyBoard(reader, company),
    });
  }
  return tasks;
}

function readCompanyBoard(reader: FeedReader, company: Company): Promise<FeedPosting[]> {
  switch (company.ats) {
    case "greenhouse":
      return fetchGreenhouseBoard(reader, company);
    case "lever":
      return fetchLeverBoard(reader, company);
    case "ashby":
      return fetchAshbyBoard(reader, company);
  }
}

function planBoardTasks(reader: FeedReader, boards: Board[]): FeedTask[] {
  const tasks: FeedTask[] = [];
  for (const board of boards) {
    switch (board) {
      case "hn":
        tasks.push({ source: "hn", slug: "thread", read: () => fetchHnPostings(reader) });
        break;
      case "yc":
        for (const role of YC_ROLE_SLUGS) {
          tasks.push({ source: "yc", slug: role, read: () => fetchYcRolePage(reader, role) });
        }
        break;
      case "remoteok":
        tasks.push({ source: "remoteok", slug: "feed", read: () => fetchRemoteOkPostings(reader) });
        break;
      case "wwr":
        for (const category of WWR_CATEGORY_SLUGS) {
          tasks.push({ source: "wwr", slug: category, read: () => fetchWwrCategory(reader, category) });
        }
        break;
    }
  }
  return tasks;
}

type TaskOutcome = { postings: FeedPosting[]; failure: FeedFailure | null };

// One bad feed (a closed board, a changed page layout, no network) must never sink the others.
async function runTask(task: FeedTask): Promise<TaskOutcome> {
  try {
    return { postings: await task.read(), failure: null };
  } catch (error) {
    return { postings: [], failure: { source: task.source, slug: task.slug, message: describeError(error) } };
  }
}

// Node's fetch reports "fetch failed" and keeps the useful reason (a DNS or connection error) in `cause`.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  if (error.cause instanceof Error) {
    return `${error.message} (${error.cause.message})`;
  }
  return error.message;
}
