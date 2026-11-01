// Run folders (`<appData>/runs/<runId>/`) hold the playbook, the run's settings and its transcript. The transcript
// helps to understand a failed run, so folders are kept for 14 days and then removed.
// Spec: ARCHITECTURE.md section 10 (step 7: transcript.jsonl "kept 14 days").
import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export const RUN_FOLDER_KEEP_DAYS = 14;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// Returns how many folders were removed. A folder's age is when it was last changed (a file added or removed);
// a run lasts at most 30 minutes, so a folder of a run that is still going is never old enough.
export function removeOldRunDirectories(appDataDir: string, now: Date): number {
  const runsDir = path.join(appDataDir, "runs");
  const cutoff = now.getTime() - RUN_FOLDER_KEEP_DAYS * MILLISECONDS_PER_DAY;

  let removed = 0;
  for (const entry of readRunFolders(runsDir)) {
    const folder = path.join(runsDir, entry);
    if (statSync(folder).mtimeMs >= cutoff) continue;
    rmSync(folder, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

function readRunFolders(runsDir: string): string[] {
  try {
    return readdirSync(runsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return []; // no run yet
    throw error;
  }
}
