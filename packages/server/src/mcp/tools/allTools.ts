// All 21 tools by name. The type is a Record over every McpToolName, so adding a tool to @jobgoblin/schemas
// does not compile until it is listed here. Which run kind sees which tool is decided in mcp/runServer.ts,
// from RUN_KIND_TOOLS.
// Spec: ARCHITECTURE.md section 9.
import type { McpToolName } from "@jobgoblin/schemas";
import { getApprovedTool, saveAnswersTool } from "./answerTools";
import { getApplicationTool, getPipelineTool, listReadyTool } from "./askTools";
import type { ToolDefinition } from "./defineTool";
import { getFitContextTool, recordFitTool } from "./fitTools";
import { addJobTool, getJobTool, markSeenTool, searchJobsTool } from "./jobTools";
import { getProfileTool, importResumeTool, proposeStoryItemsTool, saveProfileSectionTool } from "./profileTools";
import { updateStatusTool } from "./statusTool";
import { getTailoringContextTool, submitResumeDraftTool } from "./tailorTools";
import { askPersonTool, completeTaskTool, nextTaskTool } from "./taskTools";

export const TOOLS_BY_NAME: Record<McpToolName, ToolDefinition> = {
  get_profile: getProfileTool,
  save_profile_section: saveProfileSectionTool,
  propose_story_items: proposeStoryItemsTool,
  import_resume: importResumeTool,
  search_jobs: searchJobsTool,
  add_job: addJobTool,
  mark_seen: markSeenTool,
  get_job: getJobTool,
  get_fit_context: getFitContextTool,
  record_fit: recordFitTool,
  get_tailoring_context: getTailoringContextTool,
  submit_resume_draft: submitResumeDraftTool,
  save_answers: saveAnswersTool,
  list_ready: listReadyTool,
  get_approved: getApprovedTool,
  update_status: updateStatusTool,
  get_pipeline: getPipelineTool,
  get_application: getApplicationTool,
  ask_person: askPersonTool,
  next_task: nextTaskTool,
  complete_task: completeTaskTool,
};
