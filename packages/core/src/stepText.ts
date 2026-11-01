// Plain words for what a run is doing, shown on the run card ("Checking every bullet against your profile").
// Every MCP tool has a line, so a new tool in @jobgoblin/schemas will not compile until it has one here.
// Spec: "Runner" (run steps). ARCHITECTURE.md sections 6 and 9.
import type { McpToolName } from "@jobgoblin/schemas";

// The step shown while the server fetches job boards before a hunt run starts (no tool is involved).
export const STEP_CHECKING_JOB_BOARDS = "Checking job boards";

const STEP_WHEN_UNKNOWN = "Working on it";

const STEP_FOR_TOOL: Record<McpToolName, string> = {
  get_profile: "Reading your form answers and targets",
  save_profile_section: "Filling in your form answers",
  propose_story_items: "Suggesting items for Your story",
  import_resume: "Reading your resume",
  search_jobs: "Looking through new jobs",
  add_job: "Adding a job that was found",
  mark_seen: "Marking jobs as looked at",
  get_job: "Reading a job posting",
  get_fit_context: "Getting Your story and targets ready",
  record_fit: "Scoring how well a job fits",
  get_tailoring_context: "Getting the job and Your story ready for a resume",
  submit_resume_draft: "Checking every bullet against your profile",
  save_answers: "Writing answers to the application questions",
  list_ready: "Looking at the applications that are ready",
  get_approved: "Reading the approved application",
  update_status: "Updating an application's status",
  get_pipeline: "Looking over your pipeline",
  get_application: "Reading the application",
  ask_person: "Asking you a question",
  next_task: "Picking the next application",
  complete_task: "Finishing an application",
};

// Claude Code reports tools as "mcp__jobgoblin__<name>", the server sees the bare name. Both work here.
const TOOL_PREFIX = "mcp__jobgoblin__";

export function stepForTool(toolName: string): string {
  const bareName = toolName.startsWith(TOOL_PREFIX) ? toolName.slice(TOOL_PREFIX.length) : toolName;
  return isKnownTool(bareName) ? STEP_FOR_TOOL[bareName] : STEP_WHEN_UNKNOWN;
}

function isKnownTool(name: string): name is McpToolName {
  return Object.hasOwn(STEP_FOR_TOOL, name);
}
