// The Pipeline list: every application, optionally filtered.
// Route: GET /api/pipeline?status=&band=&search=&overdueOnly=1. Spec: ARCHITECTURE.md section 11.
import { PipelineRow, type PipelineQuery } from "@jobgoblin/schemas";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, arrayOf, withQuery } from "./client";
import { queryKeys } from "./keys";

// The screen's filters pick at most one status and one band, so each query parameter holds a single
// value. That also keeps the request the same whether the server reads repeated or comma-separated values.
function pipelinePath(query: PipelineQuery): string {
  return withQuery("/api/pipeline", {
    status: query.status?.[0],
    band: query.band?.[0],
    search: query.search,
    overdueOnly: query.overdueOnly === true ? "1" : undefined,
  });
}

export function usePipeline(query: PipelineQuery) {
  return useQuery({
    queryKey: queryKeys.pipeline(query),
    queryFn: () => apiFetch(pipelinePath(query), { schema: arrayOf(PipelineRow) }),
  });
}
