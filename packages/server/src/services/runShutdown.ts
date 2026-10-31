// What happens to runs when Jobgoblin quits: queued runs are cancelled (they would never start), and runs that
// are going are asked to stop through the launcher (which waits a few seconds, then ends the process tree).
// A run waiting for the person's answer is left alone: it holds no process and the question stays open.
// Spec: tech spec "Processes and startup" (Shutdown); ARCHITECTURE.md section 11 (shutdown message).
import { listRunsByStatus, updateRun } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { cancelRun } from "./runs";

const SHUTDOWN_MESSAGE = "Cancelled because Jobgoblin was closed.";

export async function cancelRunsForShutdown(ctx: ServerContext): Promise<void> {
  for (const run of listRunsByStatus(ctx.db, ["queued"])) {
    updateRun(ctx.db, run.id, { status: "cancelled", endedAt: ctx.now().toISOString(), outcomeMessage: SHUTDOWN_MESSAGE });
  }

  for (const run of listRunsByStatus(ctx.db, ["running"])) {
    try {
      await cancelRun(ctx, run.id);
    } catch (error) {
      ctx.logger.error({ err: error, runId: run.id }, "A running run could not be stopped at shutdown.");
    }
  }
}
