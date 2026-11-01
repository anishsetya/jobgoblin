// Marks runs that claim to be going as "interrupted" without looking for a process: used when a backup is
// restored, because the restored database remembers runs of another session. (At server start the runner's
// recovery.ts does the same and also stops a leftover Claude process.)
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
