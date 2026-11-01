// The run queue's engine. `wake()` starts the oldest queued runs while there is room (settings.concurrency, default 1);
// each run is launched by launchRun.ts and followed by afterRun.ts. `cancel(runId)` stops a running run and waits
// until its end is recorded. A run that ends "blocked" (signed out, plan limit, Claude Code missing) pauses the queue
// until the person retries it or signs in again.
// Nothing here knows how a process is started; it only decides WHICH run goes WHEN.
// Spec: ARCHITECTURE.md section 10 (Queue, Cancel); packages/server/README.md ("How runs are queued").
import type { Run } from "@jobgoblin/schemas";
import { getRun, getSettings, listRunsByStatus, updateRun } from "@jobgoblin/storage";
import type { Launcher, ServerContext } from "../context";
import { announceRun } from "../services/changes";
import { afterRun } from "./afterRun";
import { createClaudeCli, type ClaudeCli } from "./claudeCli";
import { launchRun, type RunHandle } from "./launchRun";
import { removeOldRunDirectories } from "./runFolderCleanup";

// A run this launcher started and has not finished with yet.
type ActiveRun = { handle: RunHandle; finished: Promise<void> };

export function createLauncher(ctx: ServerContext): Launcher {
  const claudeCli = createClaudeCliFor(ctx);
  const activeRuns = new Map<string, ActiveRun>();
  let isPaused = false;

  removeOldRunFolders(ctx);

  function wake(): void {
    try {
      resumeIfABlockedRunWasRetried();
      startQueuedRuns();
    } catch (error) {
      // The database may be closing (shutdown). Nothing to start then, and nothing to show the person.
      ctx.logger.error({ err: error }, "The run queue could not be checked.");
    }
  }

  function startQueuedRuns(): void {
    if (isPaused) return;
    for (const queued of listRunsByStatus(ctx.db, ["queued"])) {
      if (activeRuns.size >= concurrencyLimit(ctx)) return;
      if (!activeRuns.has(queued.id)) start(queued);
    }
  }

  // Claims the run (status running) before anything slow happens, so no second launch can pick it up.
  function start(queued: Run): void {
    const claimed = updateRun(ctx.db, queued.id, { status: "running", startedAt: ctx.now().toISOString(), step: null });
    if (claimed === null) return;
    announceRun(ctx, claimed);

    const handle: RunHandle = { cancelRequested: false, stop: null };
    const finished = launchRun({ ctx, claudeCli }, claimed, handle)
      .then((ended) => handleEnd(ended))
      .catch((error: unknown) => ctx.logger.error({ err: error, runId: claimed.id }, "A finished run could not be followed up."));
    activeRuns.set(claimed.id, { handle, finished });
  }

  function handleEnd(ended: Run): void {
    if (ended.status === "blocked") isPaused = true;
    activeRuns.delete(ended.id);
    try {
      afterRun(ctx, ended);
    } catch (error) {
      ctx.logger.error({ err: error, runId: ended.id }, "What should follow a run could not be started.");
    }
    wake();
  }

  // Retry makes a new queued run whose retryOf is the blocked run: that is the person saying "try again now".
  function resumeIfABlockedRunWasRetried(): void {
    if (!isPaused) return;
    const retriesABlockedRun = listRunsByStatus(ctx.db, ["queued"]).some(
      (queued) => queued.retryOf !== null && getRun(ctx.db, queued.retryOf)?.status === "blocked",
    );
    if (retriesABlockedRun) isPaused = false;
  }

  async function cancel(runId: string): Promise<void> {
    const active = activeRuns.get(runId);
    if (active === undefined) return; // not ours: the queue records the cancel itself
    active.handle.cancelRequested = true;
    await active.handle.stop?.();
    await active.finished;
  }

  function resume(): void {
    isPaused = false;
    wake();
  }

  return { wake, cancel, resume };
}

// Also used at start-up, so the process recovery looks for the same program the runs start.
export function createClaudeCliFor(ctx: ServerContext): ClaudeCli {
  return createClaudeCli({ claudeCommand: ctx.options.claudeCommand, claudeInstallCommand: ctx.options.claudeInstallCommand });
}

function concurrencyLimit(ctx: ServerContext): number {
  return getSettings(ctx.db).concurrency;
}

function removeOldRunFolders(ctx: ServerContext): void {
  try {
    removeOldRunDirectories(ctx.appDataDir, ctx.now());
  } catch (error) {
    ctx.logger.warn({ err: error }, "Old run folders could not be removed.");
  }
}
