// The tools about the person: get_profile (every run kind), and the three a setup run uses to read the resume,
// suggest items for Your story and fill in missing form answers. None of them can return contact details,
// compensation or EEO answers, and none can confirm anything: only the person does that.
// Spec: ARCHITECTURE.md section 9 (get_profile, save_profile_section, propose_story_items, import_resume).
import {
  GetProfileInput,
  GetProfileOutput,
  ImportResumeInput,
  ImportResumeOutput,
  ProposeStoryItemsInput,
  ProposeStoryItemsOutput,
  SaveProfileSectionInput,
  SaveProfileSectionOutput,
} from "@jobgoblin/schemas";
import { getProfileForRun, saveProfileSectionFromRun } from "../../services/profileForRuns";
import { getUploadsForRun } from "../../services/setup";
import { proposeStoryItems } from "../../services/storyProposals";
import { defineTool } from "./defineTool";
import { replyFromOutcome, succeededWith } from "./toolHelpers";

export const getProfileTool = defineTool({
  name: "get_profile",
  description:
    "Read the person's work authorization, employment facts, job targets and rules, and which form answers are still missing. It never returns contact details, pay or EEO answers.",
  input: GetProfileInput,
  output: GetProfileOutput,
  readOnly: true,
  handle: ({ ctx }) => succeededWith(getProfileForRun(ctx), null),
});

export const saveProfileSectionTool = defineTool({
  name: "save_profile_section",
  description:
    "Fill in values of the employment, workAuthorization or targets section that are still TODO or empty. It never overwrites a value the person typed.",
  input: SaveProfileSectionInput,
  output: SaveProfileSectionOutput,
  readOnly: false,
  handle: ({ ctx }, input) =>
    replyFromOutcome(
      saveProfileSectionFromRun(ctx, input),
      "Write your final message: what you filled in and what is still missing.",
      "Fix the data to match the section, then call save_profile_section again.",
    ),
});

export const proposeStoryItemsTool = defineTool({
  name: "propose_story_items",
  description:
    "Suggest items for Your story (headline, experience, project, achievement, skill, education), taken only from the person's resume text. They are saved as pending; only the person can confirm them.",
  input: ProposeStoryItemsInput,
  output: ProposeStoryItemsOutput,
  readOnly: false,
  handle: ({ ctx }, input) =>
    replyFromOutcome(
      proposeStoryItems(ctx, input.items),
      "Call save_profile_section for any employment facts the resume states, then write your final message.",
      "Fix every problem listed, then call propose_story_items again with the whole list.",
    ),
});

export const importResumeTool = defineTool({
  name: "import_resume",
  description: "Read the text of the resume and other documents the person uploaded. Contact details have already been taken out.",
  input: ImportResumeInput,
  output: ImportResumeOutput,
  readOnly: true,
  handle: ({ ctx }) =>
    succeededWith(getUploadsForRun(ctx), "Call propose_story_items with the items you found. Use only what the text says."),
});
