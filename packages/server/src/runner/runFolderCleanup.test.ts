import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeOldRunDirectories, RUN_FOLDER_KEEP_DAYS } from "./runFolderCleanup";
import { makeTempDir, removeTempDirs } from "./testSupport";

afterEach(removeTempDirs);

const NOW = new Date("2026-11-01T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function aRunFolder(appDataDir: string, name: string, ageInDays: number): string {
  const folder = path.join(appDataDir, "runs", name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "transcript.jsonl"), "{}\n");
  const modified = new Date(NOW.getTime() - ageInDays * DAY);
  fs.utimesSync(folder, modified, modified);
  return folder;
}

describe("removeOldRunDirectories", () => {
  it("removes run folders older than the keep time and leaves newer ones", () => {
    const appDataDir = makeTempDir();
    const old = aRunFolder(appDataDir, "old-run", RUN_FOLDER_KEEP_DAYS + 1);
    const recent = aRunFolder(appDataDir, "recent-run", RUN_FOLDER_KEEP_DAYS - 1);

    const removed = removeOldRunDirectories(appDataDir, NOW);

    expect(removed).toBe(1);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
  });

  it("does nothing when no run has ever started", () => {
    expect(removeOldRunDirectories(makeTempDir(), NOW)).toBe(0);
  });
});
