// The two tools of an answers run, which writes screening answers for an application the person approved:
// get_approved (the job, the questions, the data sheet with personal values as "{key}" placeholders, and the
// approved resume) and save_answers. The run never sees a phone number, salary or EEO answer.
// Spec: ARCHITECTURE.md section 9 (get_approved, save_answers); packages/server/README.md decision 5.
import { SaveAnswersInput, SaveAnswersOutput, GetApprovedInput } from "@jobgoblin/schemas";
import { GetApprovedForRunOutput, getApprovedForRun, saveAnswers } from "../../services/answers";
import { defineTool } from "./defineTool";
import { assertRunMayUseApplication, replyFromOutcome, succeededWith } from "./toolHelpers";

export const getApprovedTool = defineTool({
  name: "get_approved",
  description:
    "Read an approved application: the job, the form's screening questions, the data sheet (personal values are placeholders such as {phone}), the approved resume and the person's earlier answers.",
  input: GetApprovedInput,
  // The service returns the approved resume too. GetApprovedOutput alone would strip it, so the wider shape is used.
  output: GetApprovedForRunOutput,
  readOnly: true,
  handle: (call, input) => {
    assertRunMayUseApplication(call, input.applicationId);
    return succeededWith(getApprovedForRun(call.ctx, input.applicationId), "Write an answer to each question, then call save_answers.");
  },
});

export const saveAnswersTool = defineTool({
  name: "save_answers",
  description:
    "Save the answers to an application's screening questions. Keep placeholders such as {phone} exactly as they are; code fills them in later.",
  input: SaveAnswersInput,
  output: SaveAnswersOutput,
  readOnly: false,
  handle: (call, input) => {
    assertRunMayUseApplication(call, input.applicationId);
    return replyFromOutcome(
      saveAnswers(call.ctx, input),
      "Call complete_task for this application with outcome done.",
      "Fix the answers listed and call save_answers again.",
    );
  },
});
