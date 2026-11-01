// The 21 tools a Claude Code run can call at /mcp, and which run kinds may call which. The schemas for each
// tool's input and output are in the other files of this folder, one file per area (the same areas as
// packages/server/src/mcp/tools/*Tools.ts). No tool can approve, submit, send or confirm anything.
// Spec: "MCP tools exposed to Claude runs". ARCHITECTURE.md sections 5.11 and 9.
import { z } from "zod";
import type { RunKind } from "../run";

// The 21st tool, get_application, was added in decision D20: without it an ask run has no way to
// read the application it was asked about.
export const MCP_TOOL_NAMES = [
  "get_profile",
  "save_profile_section",
  "propose_story_items",
  "import_resume",
  "search_jobs",
  "add_job",
  "mark_seen",
  "get_job",
  "get_fit_context",
  "record_fit",
  "get_tailoring_context",
  "submit_resume_draft",
  "save_answers",
  "list_ready",
  "get_approved",
  "update_status",
  "get_pipeline",
  "get_application",
  "ask_person",
  "next_task",
  "complete_task",
] as const;

export const McpToolName = z.enum(MCP_TOOL_NAMES);
export type McpToolName = z.infer<typeof McpToolName>;

// The "Run kinds" column of the section 9 table, read per run kind. The server shows a run only the
// tools listed for its kind; anything else is refused, even if the run asks for it by name.
//   - get_profile: every kind.
//   - ask_person: paste, tailor and answers only (decision D17).
//   - update_status: no kind.
export const RUN_KIND_TOOLS: Record<RunKind, readonly McpToolName[]> = {
  setup: ["get_profile", "save_profile_section", "propose_story_items", "import_resume"],
  hunt: [
    "get_profile",
    "search_jobs",
    "add_job",
    "mark_seen",
    "get_job",
    "get_fit_context",
    "record_fit",
  ],
  paste: ["get_profile", "get_job", "get_fit_context", "record_fit", "ask_person"],
  tailor: [
    "get_profile",
    "get_job",
    "get_tailoring_context",
    "submit_resume_draft",
    "ask_person",
    "next_task",
    "complete_task",
  ],
  answers: [
    "get_profile",
    "get_job",
    "save_answers",
    "get_approved",
    "ask_person",
    "next_task",
    "complete_task",
  ],
  ask: ["get_profile", "get_job", "list_ready", "get_pipeline", "get_application"],
};
