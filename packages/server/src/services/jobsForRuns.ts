// What a hunt (and every other) run may do with jobs: list the ones nobody has looked at, add one found on
// the web, mark some as looked at, and read one. Posting text always reaches a run wrapped as untrusted data.
// Spec: ARCHITECTURE.md section 9 (search_jobs, add_job, mark_seen, get_job).
import type {
  AddJobInput,
  AddJobOutput,
  GetJobOutput,
  Job,
  MarkSeenOutput,
  SearchJobsOutput,
} from "@jobgoblin/schemas";
import { classifyRegion, codeFilter, dedupeKey } from "@jobgoblin/core";
import {
  countUnseenJobs,
  getJob,
  getProfileSection,
  insertJobIfNew,
  listJobsByDedupeKey,
  listUnseenJobs,
  markJobsSeen,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { webJobId } from "./jobIds";
import { loadJobOrFail } from "./loaders";
import { failed, succeeded, type Outcome } from "./serviceError";
import { wrapSnippet, wrapUntrustedPosting } from "./untrustedText";

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;

export function searchUnseenJobs(ctx: ServerContext, request: { limit?: number }): SearchJobsOutput {
  const limit = Math.min(request.limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
  const jobs = listUnseenJobs(ctx.db, limit);
  return {
    jobs: jobs.map((job) => ({
      jobId: job.jobId,
      company: job.company,
      title: job.title,
      location: job.location,
      region: job.region,
      snippet: wrapSnippet(job.text),
    })),
    remaining: Math.max(0, countUnseenJobs(ctx.db) - jobs.length),
  };
}

export function markSeen(ctx: ServerContext, jobIds: string[]): MarkSeenOutput {
  return { marked: markJobsSeen(ctx.db, jobIds, ctx.now().toISOString()) };
}

export function getJobForRun(ctx: ServerContext, jobId: string): GetJobOutput {
  const job = loadJobOrFail(ctx, jobId);
  return {
    jobId: job.jobId,
    company: job.company,
    title: job.title,
    location: job.location,
    region: job.region,
    url: job.url,
    text: wrapUntrustedPosting(job.text),
    questions: job.questions,
  };
}

// A job the hunt run found on the web. It is checked like a feed job: a duplicate is recognised and a job
// the person's targets rule out is refused (the run should not spend effort scoring it). A job that is
// accepted is marked as seen at once, because the run that found it is about to score it.
export function addJobFromRun(ctx: ServerContext, input: AddJobInput): Outcome<AddJobOutput> {
  const key = dedupeKey(input.company, input.title, input.location);
  const known = listJobsByDedupeKey(ctx.db, key)[0];
  if (known !== undefined) return succeeded({ jobId: known.jobId, duplicate: true });

  const jobId = webJobId(input.company, input.url, input.text);
  const sameId = getJob(ctx.db, jobId);
  if (sameId !== null) return succeeded({ jobId, duplicate: true });

  const verdict = codeFilter(
    { title: input.title, location: input.location, text: input.text },
    getProfileSection(ctx.db, "targets"),
  );
  const now = ctx.now().toISOString();
  const job: Job = {
    jobId,
    dedupeKey: key,
    source: "web",
    company: input.company,
    title: input.title,
    location: input.location,
    region: classifyRegion(input.location),
    url: input.url ?? null,
    text: input.text,
    questions: [],
    postedAt: null,
    foundAt: now,
    seenAt: now,
    filteredReason: verdict.passes ? null : verdict.reason,
  };
  insertJobIfNew(ctx.db, job);

  if (!verdict.passes) {
    return failed([{ code: "filtered-out", message: `This job does not match the person's targets. ${verdict.reason} Skip it.` }]);
  }
  return succeeded({ jobId, duplicate: false });
}
