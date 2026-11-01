// update_status exists so the tool list matches the spec, but no run kind may call it in the proof of concept
// (RUN_KIND_TOOLS), so the server never offers it. The service refuses any move a run is not allowed to make,
// so even a later run kind could never reach Approved or Applied through it.
// Spec: ARCHITECTURE.md section 9 (update_status: "none in the POC").
import { UpdateStatusInput, UpdateStatusOutput } from "@jobgoblin/schemas";
import { updateStatusFromRun } from "../../services/statusForRuns";
import { defineTool } from "./defineTool";
import { replyFromOutcome } from "./toolHelpers";

export const updateStatusTool = defineTool({
  name: "update_status",
  description: "Move an application to another status, when the rules allow a run to make that move.",
  input: UpdateStatusInput,
  output: UpdateStatusOutput,
  readOnly: false,
  handle: ({ ctx }, input) => replyFromOutcome(updateStatusFromRun(ctx, input), null, null),
});
