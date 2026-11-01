// Stops one run's process tree: politely first, and for good after a short grace period. Used for cancel, for the
// time limit, and (without the grace period) for a run that failed the safety check on its init line.
// A polite stop is `taskkill /T` (Windows) or SIGTERM; a console program often refuses it, so after 5 seconds the
// tree is ended with /F or SIGKILL.
// Spec: ARCHITECTURE.md section 10 (Cancel).
import type { Logger } from "../logger";
import { killProcessTree } from "./processes";

export const GRACE_PERIOD_MS = 5_000;

export type StopInput = {
  pid: number;
  exited: Promise<unknown>; // settles when the process has ended (SpawnedRun.exit)
  logger: Logger;
  immediately: boolean; // true: skip the polite attempt
};

export async function stopProcessPolitelyThenForce(input: StopInput): Promise<void> {
  try {
    if (!input.immediately) {
      await killProcessTree(input.pid, { force: false });
      const hasExited = await exitsWithin(input.exited, GRACE_PERIOD_MS);
      if (hasExited) return;
    }
    await killProcessTree(input.pid, { force: true });
  } catch (error) {
    input.logger.error({ err: error, pid: input.pid }, "A run's process could not be stopped.");
  }
}

function exitsWithin(exited: Promise<unknown>, milliseconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), milliseconds);
    void exited.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
