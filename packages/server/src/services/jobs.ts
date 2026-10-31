// "Add a job": the person pastes a link or the job text. A public Greenhouse, Lever or Ashby link is read
// by code; any other link (or a site that needs a login) asks for the text. The job is checked against the
// ones already known, an application is created in Found, and a paste run is queued to score it.
// Spec: ARCHITECTURE.md section 11 (POST /api/jobs), 5.9 (AddJobRequest) and decision D9.
import { HttpUrl, type AddJobRequest, type AddJobResponse, type FeedPosting, type Job } from "@jobgoblin/schemas";
import { classifyRegion, dedupeKey } from "@jobgoblin/core";
import { readPostingFromUrl } from "@jobgoblin/sources";
import {
  getApplicationByJobId,
  getJob,
  insertJobIfNew,
  listJobsByDedupeKey,
  markJobsSeen,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { createFeedCache } from "../feedCache";
import { createApplicationInFound } from "./applicationCreation";
import { announceApplication, saveChangesSoon } from "./changes";
import { pastedJobId } from "./jobIds";
import { invalid } from "./serviceError";
import { queueRun } from "./runs";

const MESSAGE_LOGIN_ONLY = "That site needs you to sign in, so Jobgoblin can't read the page. Paste the job text here instead.";
const MESSAGE_UNREADABLE = "Jobgoblin couldn't read that link. Paste the job text here instead.";
const MESSAGE_ADDED = "Added. Jobgoblin is scoring it now.";

export async function addPastedJob(ctx: ServerContext, request: AddJobRequest): Promise<AddJobResponse> {
  // Reading a link uses the network, so it happens before any database change.
  const posting = await readPosting(ctx, request);
  if ("needsText" in posting) {
    return { applicationId: null, runId: null, needsText: true, message: posting.message };
  }

  const job = findOrCreateJob(ctx, posting.posting);
  const existing = getApplicationByJobId(ctx.db, job.jobId);
  if (existing !== null) {
    return {
      applicationId: existing.id,
      runId: null,
      needsText: false,
      message: `You already have this job (${existing.status}). Open it from Pipeline.`,
    };
  }

  const application = createApplicationInFound(ctx, job, "server", "server");
  announceApplication(ctx, application.id);
  saveChangesSoon(ctx);

  // The playbook reads both ids from the run input (D6). A paste run has no tasks: it scores one job.
  const run = queueRun(ctx, { kind: "paste", applicationIds: [], input: { jobId: job.jobId, applicationId: application.id } });
  return { applicationId: application.id, runId: run.id, needsText: false, message: MESSAGE_ADDED };
}

// ---------------------------------------------------------------------------------------------
// Getting the posting
// ---------------------------------------------------------------------------------------------

type PostingResult = { posting: FeedPosting } | { needsText: true; message: string };

async function readPosting(ctx: ServerContext, request: AddJobRequest): Promise<PostingResult> {
  if (request.text !== undefined) return { posting: postingFromPastedText(request, request.text) };
  if (request.url === undefined) {
    throw invalid("invalid-request", "Add a link or paste the job text.", "Fill in one of the two boxes.");
  }

  const url = request.url.trim();
  if (!HttpUrl.safeParse(url).success) {
    throw invalid("invalid-url", "That doesn't look like a web link.", "Paste the whole address, starting with https://.");
  }
  const result = await readPostingFromUrl(url, {
    cache: createFeedCache(() => ctx.db),
    fixturesDir: ctx.options.feedFixturesDir,
  });
  if (result.kind === "posting") return { posting: result.posting };
  return { needsText: true, message: result.reason === "login-only" ? MESSAGE_LOGIN_ONLY : MESSAGE_UNREADABLE };
}

// The person typed the company and title themselves (the schema insists on both when text is given).
// The id comes from the text, so pasting the same text twice is recognised as the same job.
function postingFromPastedText(request: AddJobRequest, text: string): FeedPosting {
  const company = request.company ?? "";
  const title = request.title ?? "";
  const link = request.url?.trim();
  return {
    jobId: pastedJobId(company, text),
    source: "pasted",
    company,
    title,
    location: request.location ?? "",
    url: link !== undefined && HttpUrl.safeParse(link).success ? link : null,
    text,
    questions: [],
    postedAt: null,
  };
}

// ---------------------------------------------------------------------------------------------
// The job record
// ---------------------------------------------------------------------------------------------

// A job the feeds already found (same id, or the same role on another site) is reused instead of added twice.
// The person asked for this one, so it is marked as seen and no hunt shows it again.
function findOrCreateJob(ctx: ServerContext, posting: FeedPosting): Job {
  const key = dedupeKey(posting.company, posting.title, posting.location);
  const known = getJob(ctx.db, posting.jobId) ?? chooseKnownJob(listJobsByDedupeKey(ctx.db, key), ctx);
  const now = ctx.now().toISOString();

  if (known !== null) {
    markJobsSeen(ctx.db, [known.jobId], now);
    return known;
  }

  const job: Job = {
    ...posting,
    dedupeKey: key,
    region: classifyRegion(posting.location),
    foundAt: now,
    seenAt: now,
    filteredReason: null, // the person chose this one, so the code filter does not apply
  };
  insertJobIfNew(ctx.db, job);
  return job;
}

// Of several jobs with the same dedupe key, prefer the one that already has an application.
function chooseKnownJob(sameRole: Job[], ctx: ServerContext): Job | null {
  const withApplication = sameRole.find((job) => getApplicationByJobId(ctx.db, job.jobId) !== null);
  return withApplication ?? sameRole[0] ?? null;
}
