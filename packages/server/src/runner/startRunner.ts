// Gets the runner ready at server start, in this order: deal with runs the last session left going (stop a
// leftover Claude Code process, mark the run interrupted), then create the launcher. The launcher is woken
// later, once the server is listening, because a run's mcp.json needs the real port.
// Spec: ARCHITECTURE.md section 10 (Recovery).
import type { ServerContext } from "../context";
import { createClaudeCliFor, createLauncher } from "./launcher";
import { isProcessAlive, killProcessTree, processImageName } from "./processes";
import { imageNamesOfCommand, recoverLeftoverRuns } from "./recovery";

export async function startRunner(ctx: ServerContext): Promise<void> {
  const claudeCommand = await createClaudeCliFor(ctx).resolveCommand();
  const report = await recoverLeftoverRuns({
    db: ctx.db,
    isAlive: isProcessAlive,
    imageName: processImageName,
    kill: (pid) => killProcessTree(pid, { force: true }),
    expectedImageNames: imageNamesOfCommand(claudeCommand),
    now: ctx.now,
  });
  if (report.length > 0) ctx.logger.warn({ interrupted: report.length }, "Runs left going by the last session were marked interrupted.");

  ctx.launcher = createLauncher(ctx);
}
