// Helpers for the runner's tests only: temporary folders, a ready database, and a builder for run records.
// Nothing here is used by the server itself. Tests use temporary folders and databases; they never touch the
// person's real folders or the network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Run } from "@jobgoblin/schemas";
import { defaultMigrationsDir, openDatabase } from "@jobgoblin/storage";
import type { Database } from "@jobgoblin/storage";

const tempDirectories: string[] = [];
const openDatabases: Database[] = [];

export function makeTempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jobgoblin-runner-"));
  tempDirectories.push(directory);
  return directory;
}

// Call from afterEach. Windows cannot delete a database file while it is open, so databases close first.
export function removeTempDirs(): void {
  for (const db of openDatabases.splice(0)) {
    if (db.sqlite.isOpen) db.close();
  }
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export function openTestDatabase(): Database {
  const db = openDatabase({
    appDataDir: makeTempDir(),
    migrationsDir: defaultMigrationsDir(),
    backupBeforeMigrate: () => undefined,
  });
  openDatabases.push(db);
  return db;
}

export function aRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    kind: "tailor",
    status: "running",
    model: "haiku",
    input: {},
    sessionId: null,
    pid: null,
    step: "Checking every bullet",
    progressDone: 0,
    progressTotal: null,
    outcomeMessage: null,
    resultText: null,
    retryOf: null,
    queuedAt: "2026-10-31T14:00:00.000Z",
    startedAt: "2026-10-31T14:01:00.000Z",
    endedAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

// The repository root, which is the resourcesDir in development (decision D2): playbooks/ lives there.
export const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
