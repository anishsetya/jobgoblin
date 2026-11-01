// The Pipeline screen's list: every application, with filters and search, overdue follow-ups marked.
// Spec: ARCHITECTURE.md section 11 (GET /api/pipeline).
import type { PipelineQuery, PipelineRow } from "@jobgoblin/schemas";
import { formatLocalDay, listApplications } from "@jobgoblin/storage";
import type { ServerContext } from "../context";

export function listPipeline(ctx: ServerContext, query: PipelineQuery): PipelineRow[] {
  return listApplications(ctx.db, query, formatLocalDay(ctx.now()));
}
