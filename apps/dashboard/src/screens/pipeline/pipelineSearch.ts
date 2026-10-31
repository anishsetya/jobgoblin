// The Pipeline screen's settings, kept in the address (?view=list&q=acme&status=Applied) so the browser's
// Back button and a reload bring the person back to the same view. `parsePipelineSearch` is the route's
// validator: whatever is in the address, the screen only ever sees a valid PipelineSearch.
import { ApplicationStatus, Band, type PipelineQuery } from "@jobgoblin/schemas";

export type PipelineView = "board" | "list";

// Every field is optional, so a plain link to /pipeline is valid and means "the board, unfiltered".
export type PipelineSearch = {
  view?: PipelineView;
  q?: string;
  status?: ApplicationStatus;
  band?: Band;
  overdue?: boolean;
};

export function parsePipelineSearch(raw: Record<string, unknown>): PipelineSearch {
  const status = ApplicationStatus.safeParse(raw.status);
  const band = Band.safeParse(raw.band);
  const text = typeof raw.q === "string" && raw.q.trim() !== "" ? raw.q : undefined;

  return {
    view: raw.view === "list" ? "list" : undefined,
    q: text,
    status: status.success ? status.data : undefined,
    band: band.success ? band.data : undefined,
    overdue: raw.overdue === true || raw.overdue === "true" ? true : undefined,
  };
}

// The same settings in the shape the pipeline route takes.
export function toPipelineQuery(search: PipelineSearch): PipelineQuery {
  return {
    status: search.status === undefined ? undefined : [search.status],
    band: search.band === undefined ? undefined : [search.band],
    search: search.q,
    overdueOnly: search.overdue,
  };
}

export function hasFilters(search: PipelineSearch): boolean {
  return search.q !== undefined || search.status !== undefined || search.band !== undefined || search.overdue === true;
}
