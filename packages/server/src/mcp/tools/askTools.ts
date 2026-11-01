// The read-only tools of an ask run, which answers the person's question about their applications:
// what is waiting for approval, how the pipeline looks, and one application in full.
// Spec: ARCHITECTURE.md section 9 and decision D20 (list_ready, get_pipeline, get_application).
import {
  GetApplicationInput,
  GetApplicationOutput,
  GetPipelineInput,
  GetPipelineOutput,
  ListReadyInput,
  ListReadyOutput,
} from "@jobgoblin/schemas";
import { getApplicationForRun, getPipelineSummary, listReady } from "../../services/askReadModels";
import { defineTool } from "./defineTool";
import { succeededWith } from "./toolHelpers";

const ANSWER_NEXT = "Answer the person's question in plain words. You cannot change anything.";

export const listReadyTool = defineTool({
  name: "list_ready",
  description: "List the applications that are waiting for the person's approval, with their fit scores.",
  input: ListReadyInput,
  output: ListReadyOutput,
  readOnly: true,
  handle: ({ ctx }) => succeededWith(listReady(ctx), ANSWER_NEXT),
});

export const getPipelineTool = defineTool({
  name: "get_pipeline",
  description: "Read how many applications are in each status, and one row for every application.",
  input: GetPipelineInput,
  output: GetPipelineOutput,
  readOnly: true,
  handle: ({ ctx }) => succeededWith(getPipelineSummary(ctx), ANSWER_NEXT),
});

export const getApplicationTool = defineTool({
  name: "get_application",
  description: "Read one application in full: its status, the job, the fit, the resume, the answers and the history.",
  input: GetApplicationInput,
  output: GetApplicationOutput,
  readOnly: true,
  handle: ({ ctx }, input) => succeededWith(getApplicationForRun(ctx, input.applicationId), ANSWER_NEXT),
});
