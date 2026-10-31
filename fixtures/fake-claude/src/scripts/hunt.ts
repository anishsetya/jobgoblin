// The "hunt" run, scripted. Claude would read each unseen job and score it against Your story.
// The fake scores with fitScoring.ts: a fixed score from data/scores.json, else keyword overlap.
//
// The calls, in order:
//   1. search_jobs      the next page of unseen jobs; an empty page ends the run
//   2. get_fit_context  once, after the first page: the rubric, the targets, and every confirmed story item
//   3. record_fit       one per job; the server creates the application and picks the band
//   4. mark_seen        the whole page, so search_jobs never shows these jobs again
// Then back to 1.
// Spec: ARCHITECTURE.md section 14 (hunt).
import type { GetFitContextOutput, SearchJobsOutput } from "@jobgoblin/schemas";
import { scoreJob } from "../fitScoring";
import type { RunScript, ScriptSession } from "../session";

const JOBS_PER_SEARCH = 10;
// A real hunt reads a few hundred jobs at most; this only stops a server that never runs out of jobs.
const MAX_SEARCH_PAGES = 50;

type FoundJob = SearchJobsOutput["jobs"][number];
type Tally = { apply: number; stretch: number; "long-shot": number; skip: number; refused: number };

export const runHuntScript: RunScript = async (session) => {
  const tally: Tally = { apply: 0, stretch: 0, "long-shot": 0, skip: 0, refused: 0 };
  let fitContext: GetFitContextOutput | null = null;

  for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
    const found = await session.callForData("search_jobs", { limit: JOBS_PER_SEARCH });
    if (found.jobs.length === 0) break;

    if (fitContext === null) fitContext = await session.callForData("get_fit_context", {});

    for (const job of found.jobs) {
      await recordFitForJob(session, job, fitContext, tally);
    }
    await session.callForData("mark_seen", { jobIds: found.jobs.map((job) => job.jobId) });
  }

  return describeTally(tally);
};

async function recordFitForJob(
  session: ScriptSession,
  job: FoundJob,
  fitContext: GetFitContextOutput,
  tally: Tally,
): Promise<void> {
  // The snippet is the posting's first 2,000 characters; the fake only looks for known words in it.
  const fit = scoreJob({ ...job, text: job.snippet }, fitContext.storyItems);

  const reply = await session.call("record_fit", fit);
  if (reply.ok) tally[reply.data.band] += 1;
  else tally.refused += 1; // for example "already-scored": not an error, the job was handled before
}

function describeTally(tally: Tally): string {
  const scored = tally.apply + tally.stretch + tally["long-shot"] + tally.skip;
  return (
    `Scored ${scored} jobs: ${tally.apply} apply, ${tally.stretch} stretch, ` +
    `${tally["long-shot"]} long shot, ${tally.skip} skipped. ${tally.refused} already scored.`
  );
}
