// The input and output schema of every MCP tool, looked up by tool name.
// @jobgoblin/schemas exports them as separate constants; the fake wants them by name so it can check
// what it sends and what the server answers, and so every call is typed from the tool's name alone.
// `satisfies` makes the build fail if a tool is added to MCP_TOOL_NAMES and not listed here.
// Spec: ARCHITECTURE.md section 9.
import type { z } from "zod";
import {
  AddJobInput,
  AddJobOutput,
  AskPersonInput,
  AskPersonOutput,
  CompleteTaskInput,
  CompleteTaskOutput,
  GetApplicationInput,
  GetApplicationOutput,
  GetApprovedInput,
  GetApprovedOutput,
  GetFitContextInput,
  GetFitContextOutput,
  GetJobInput,
  GetJobOutput,
  GetPipelineInput,
  GetPipelineOutput,
  GetProfileInput,
  GetProfileOutput,
  GetTailoringContextInput,
  GetTailoringContextOutput,
  ImportResumeInput,
  ImportResumeOutput,
  ListReadyInput,
  ListReadyOutput,
  MarkSeenInput,
  MarkSeenOutput,
  NextTaskInput,
  NextTaskOutput,
  ProposeStoryItemsInput,
  ProposeStoryItemsOutput,
  RecordFitInput,
  RecordFitOutput,
  SaveAnswersInput,
  SaveAnswersOutput,
  SaveProfileSectionInput,
  SaveProfileSectionOutput,
  SearchJobsInput,
  SearchJobsOutput,
  SubmitResumeDraftInput,
  SubmitResumeDraftOutput,
  UpdateStatusInput,
  UpdateStatusOutput,
} from "@jobgoblin/schemas";
import type { McpToolName } from "@jobgoblin/schemas";

type ToolSchemas = { input: z.ZodType; output: z.ZodType };

export const TOOL_SCHEMAS = {
  get_profile: { input: GetProfileInput, output: GetProfileOutput },
  save_profile_section: { input: SaveProfileSectionInput, output: SaveProfileSectionOutput },
  propose_story_items: { input: ProposeStoryItemsInput, output: ProposeStoryItemsOutput },
  import_resume: { input: ImportResumeInput, output: ImportResumeOutput },
  search_jobs: { input: SearchJobsInput, output: SearchJobsOutput },
  add_job: { input: AddJobInput, output: AddJobOutput },
  mark_seen: { input: MarkSeenInput, output: MarkSeenOutput },
  get_job: { input: GetJobInput, output: GetJobOutput },
  get_fit_context: { input: GetFitContextInput, output: GetFitContextOutput },
  record_fit: { input: RecordFitInput, output: RecordFitOutput },
  get_tailoring_context: { input: GetTailoringContextInput, output: GetTailoringContextOutput },
  submit_resume_draft: { input: SubmitResumeDraftInput, output: SubmitResumeDraftOutput },
  save_answers: { input: SaveAnswersInput, output: SaveAnswersOutput },
  list_ready: { input: ListReadyInput, output: ListReadyOutput },
  get_approved: { input: GetApprovedInput, output: GetApprovedOutput },
  update_status: { input: UpdateStatusInput, output: UpdateStatusOutput },
  get_pipeline: { input: GetPipelineInput, output: GetPipelineOutput },
  get_application: { input: GetApplicationInput, output: GetApplicationOutput },
  ask_person: { input: AskPersonInput, output: AskPersonOutput },
  next_task: { input: NextTaskInput, output: NextTaskOutput },
  complete_task: { input: CompleteTaskInput, output: CompleteTaskOutput },
} as const satisfies Record<McpToolName, ToolSchemas>;

export type ToolName = keyof typeof TOOL_SCHEMAS;

// What a script passes in (defaults may be left out) and what the server's `data` holds once parsed.
export type ToolInput<Name extends ToolName> = z.input<(typeof TOOL_SCHEMAS)[Name]["input"]>;
export type ToolOutput<Name extends ToolName> = z.output<(typeof TOOL_SCHEMAS)[Name]["output"]>;
