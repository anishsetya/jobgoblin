// What to do at start-up with runs that were still going when the server last stopped. Their Claude Code
// process is gone (or must be stopped), so they are marked "interrupted" and their card offers Retry.
//
// LAUNCHER PLUG-IN POINT: this is the default. The run launcher owns real recovery (finding a leftover
// process by its pid, checking that it is Claude Code and stopping its process tree, section 10 "recovery.ts")
// and replaces the call to this function in startServer.ts. Until then, a "running" run is simply marked.
// A "waiting" run has no process; it is waiting for the person's answer and stays as it is.
// Spec: ARCHITECTURE.md section 10 (Recovery).
import { listRunsByStatus, updateRun } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { announceRun } from "./changes";

export const INTERRUPTED_MESSAGE = "This run was interrupted";

// Returns how many runs were marked.
export function recoverInterruptedRuns(ctx: ServerContext): number {
  const leftovers = listRunsByStatus(ctx.db, ["running"]);
  for (const run of leftovers) {
    const interrupted = updateRun(ctx.db, run.id, {
      status: "interrupted",
      endedAt: ctx.now().toISOString(),
      outcomeMessage: INTERRUPTED_MESSAGE,
      pid: null,
    });
    if (interrupted !== null) announceRun(ctx, interrupted);
  }
  return leftovers.length;
}
