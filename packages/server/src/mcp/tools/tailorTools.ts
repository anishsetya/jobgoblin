// The two tools of a tailor run: get_tailoring_context (what to build from) and submit_resume_draft (check,
// render and save the draft). A draft that fails a check comes back as ok:false with every error at once.
// Both are limited to the applications in the run's own queue.
// Spec: ARCHITECTURE.md sections 8.4 and 9 (get_tailoring_context, submit_resume_draft).
import {
  GetTailoringContextInput,
  GetTailoringContextOutput,
  SubmitResumeDraftInput,
  SubmitResumeDraftOutput,
} from "@jobgoblin/schemas";
import { submitResumeDraft } from "../../services/resumes";
import { getTailoringContext } from "../../services/tailoringContext";
import { defineTool } from "./defineTool";
import { assertRunMayUseApplication, replyFromOutcome, succeededWith } from "./toolHelpers";

export const getTailoringContextTool = defineTool({
  name: "get_tailoring_context",
  description:
    "Read what you need to tailor one resume: the default resume to start from, every confirmed Your story item, the job's must-haves and gaps, the banned terms, a job summary, the person's edit note and earlier answers.",
  input: GetTailoringContextInput,
  output: GetTailoringContextOutput,
  readOnly: true,
  handle: (call, input) => {
    assertRunMayUseApplication(call, input.applicationId);
    const context = getTailoringContext(call.ctx, { runId: call.run.id, applicationId: input.applicationId });
    return succeededWith(context, "Build the resume from this, then call submit_resume_draft.");
  },
});

export const submitResumeDraftTool = defineTool({
  name: "submit_resume_draft",
  description:
    "Submit a resume draft for one application. It is checked against Your story, the banned terms and the one-page limit. If it fails, every error comes back at once with its path.",
  input: SubmitResumeDraftInput,
  output: SubmitResumeDraftOutput,
  readOnly: false,
  handle: async (call, input) => {
    assertRunMayUseApplication(call, input.applicationId);
    const outcome = await submitResumeDraft(call.ctx, input);
    return replyFromOutcome(
      outcome,
      "Call complete_task for this application with outcome done.",
      "Fix every error in one go and call submit_resume_draft again (at most 3 times in all). If it still fails, call complete_task with outcome failed and a short note.",
    );
  },
});
