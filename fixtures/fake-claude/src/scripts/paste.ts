// The "paste" run, scripted. The person pasted one job; Claude scores it. The job id is in the run input.
//
// The calls, in order:
//   1. get_job          the pasted posting
//   2. get_fit_context  the rubric, the targets, and every confirmed story item
//   3. record_fit       the score; the server creates the application
// Spec: ARCHITECTURE.md section 14 (paste).
import { scoreJob } from "../fitScoring";
import type { RunScript } from "../session";

export const runPasteScript: RunScript = async (session) => {
  const { jobId } = session.input;
  if (jobId === undefined) throw new Error("A paste run needs a jobId in its run input.");

  const job = await session.callForData("get_job", { jobId });
  const fitContext = await session.callForData("get_fit_context", {});

  const fit = scoreJob(job, fitContext.storyItems);
  const recorded = await session.callForData("record_fit", fit);

  return `Scored ${job.company}, ${job.title}: ${fit.score} (${recorded.band}).`;
};
