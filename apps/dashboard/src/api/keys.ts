// Every query key in one place. A key names a piece of server data in the cache.
// Keys that start the same way belong together: invalidating ["pipeline"] refreshes every filtered
// view of the pipeline at once, and invalidating ["application"] refreshes every open application.
import type { PipelineQuery } from "@jobgoblin/schemas";

export const queryKeys = {
  today: () => ["today"] as const,
  pipeline: (query?: PipelineQuery) => (query === undefined ? (["pipeline"] as const) : (["pipeline", query] as const)),
  application: (applicationId?: string) =>
    applicationId === undefined ? (["application"] as const) : (["application", applicationId] as const),
  profile: () => ["profile"] as const,
  story: () => ["story"] as const,
  // A run's latest state, kept up to date by live updates (see runs.ts, useLiveRun). Never fetched.
  run: (runId: string) => ["run", runId] as const,
  claudeStatus: () => ["claude-status"] as const,
  settings: () => ["settings"] as const,
  backups: () => ["backups"] as const,
};
