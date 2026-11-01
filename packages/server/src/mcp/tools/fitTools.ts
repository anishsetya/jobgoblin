// The tools for scoring a job: get_fit_context (the rubric, the person's targets and every confirmed item of
// Your story) and record_fit (save the score; the server adds the band and moves the application).
// Spec: ARCHITECTURE.md section 9 (get_fit_context, record_fit).
import { GetFitContextInput, GetFitContextOutput, RecordFitInput, RecordFitOutput } from "@jobgoblin/schemas";
import { getFitContext, recordFit } from "../../services/fits";
import { defineTool } from "./defineTool";
import { replyFromOutcome, succeededWith } from "./toolHelpers";

export const getFitContextTool = defineTool({
  name: "get_fit_context",
  description: "Read the scoring rubric, the person's targets and every confirmed item of Your story. Call it once, then score every job by the rubric.",
  input: GetFitContextInput,
  output: GetFitContextOutput,
  readOnly: true,
  handle: ({ ctx }) => succeededWith(getFitContext(ctx), "Score the job by the rubric, then call record_fit."),
});

export const recordFitTool = defineTool({
  name: "record_fit",
  description:
    "Save a job's fit score with its track, must-haves, gaps, flags, matched story items and a one-line reason. It creates the application and marks the job as seen. A hard skip is recorded as score 0.",
  input: RecordFitInput,
  output: RecordFitOutput,
  readOnly: false,
  handle: ({ ctx, run }, input) => {
    const nextWhenOk =
      run.kind === "hunt"
        ? "Go on to the next job on the page. When the page is done, call mark_seen for the jobs you screened out."
        : "Write your final message.";
    return replyFromOutcome(recordFit(ctx, input), nextWhenOk, "Read the problem. Fix the input and call record_fit once more, or move on.");
  },
});
