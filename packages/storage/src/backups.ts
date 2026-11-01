// Backups: a copy of the database in the person's Backups folder, made shortly after changes and once a day,
// kept for a while, and restorable in one click (also on a new computer, from the same synced folder).
// The copy is made with VACUUM INTO into a temporary file and renamed, so a sync tool only ever sees a finished file.
// File names and which backups are kept are in backupFiles.ts.
// Spec: ARCHITECTURE.md section 7 ("Backups"); tech spec "Rules" (Backups).
import fs from "node:fs";
import path from "node:path";
import { Backup } from "@jobgoblin/schemas";
import {
  chooseBackupsToKeep,
  chooseUnusedBackupName,
  newestFirst,
  parseBackupFileName,
  type BackupFile,
} from "./backupFiles";
import type { Database } from "./database";
import { BackupNotFoundError, InvalidBackupIdError, NoPersonFolderError } from "./errors";
import { formatLocalDay } from "./localTime";
import { BACKUPS_DIR, type PersonFolder } from "./personFolder";
import { realScheduler, reportErrorToConsole, type ReportError, type ScheduledTimer, type Scheduler } from "./scheduler";
import { getSetting, setSetting } from "./tables/settings";

const BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1000; // PRD S5: after changes, at most one backup every 5 minutes
const BACKUP_SETTLE_DELAY_MS = 2_000; // lets a burst of changes finish before copying

// Why a backup is made. The reason is passed to onBackupDone so the server can log it.
export type BackupReason = "manual" | "after-change" | "daily" | "before-upgrade" | "before-restore";

export interface Backups {
  // Makes a backup now. Returns null when the person has not chosen a folder yet.
  backupNow(reason: BackupReason): Backup | null;
  // Something changed: make a backup soon, but at most one every 5 minutes.
  scheduleAfterChange(): void;
  // Makes a backup unless one has already been made today. Call it when the app starts.
  runDailyIfDue(): Backup | null;
  // The backups in the Backups folder, newest first.
  list(): Backup[];
  // Replaces the database with a backup. `reopen` must open the database again and make the result the app's
  // current database. Returns that reopened database.
  restore(id: string, reopen: () => Database): Database;
}

export type BackupsOptions = {
  // Getters rather than values, because restoring replaces the database and choosing another folder
  // replaces the folder while the Backups object lives on.
  getDb: () => Database;
  getFolder: () => PersonFolder | null;
  now: () => Date;
  scheduler?: Scheduler;
  reportError?: ReportError;
  onBackupDone?: (backup: Backup, reason: BackupReason) => void;
};

export function createBackups(options: BackupsOptions): Backups {
  const scheduler = options.scheduler ?? realScheduler;
  const reportError = options.reportError ?? reportErrorToConsole;
  let pendingTimer: ScheduledTimer | null = null;

  function backupsDirectory(folder: PersonFolder): string {
    return path.join(folder.root, BACKUPS_DIR);
  }

  // Newest first. Files that are not backups (a temporary file, a note the person added) are ignored.
  function readBackupFiles(): BackupFile[] {
    const folder = options.getFolder();
    if (folder === null || !fs.existsSync(backupsDirectory(folder))) return [];

    const files: BackupFile[] = [];
    for (const fileName of fs.readdirSync(backupsDirectory(folder))) {
      const parsed = parseBackupFileName(fileName);
      if (parsed === null) continue;
      const sizeBytes = fs.statSync(path.join(backupsDirectory(folder), fileName)).size;
      const backup = Backup.parse({ id: fileName, createdAt: parsed.createdAt.toISOString(), sizeBytes });
      files.push({ backup, sequence: parsed.sequence });
    }
    files.sort(newestFirst);
    return files;
  }

  function list(): Backup[] {
    return readBackupFiles().map((file) => file.backup);
  }

  function backupNow(reason: BackupReason): Backup | null {
    const folder = options.getFolder();
    if (folder === null) return null;

    const directory = backupsDirectory(folder);
    fs.mkdirSync(directory, { recursive: true });
    const finalName = chooseUnusedBackupName(directory, options.now());
    copyDatabaseInto(options.getDb(), directory, finalName);

    const backup = list().find((candidate) => candidate.id === finalName);
    if (backup === undefined) throw new Error(`The backup ${finalName} was written but cannot be found.`);

    deleteBackupsNoLongerKept();
    options.onBackupDone?.(backup, reason);
    return backup;
  }

  function deleteBackupsNoLongerKept(): void {
    const folder = options.getFolder();
    if (folder === null) return;
    const backups = list();
    const keep = chooseBackupsToKeep(backups, options.now());
    for (const backup of backups) {
      if (!keep.has(backup.id)) fs.rmSync(path.join(backupsDirectory(folder), backup.id), { force: true });
    }
  }

  function scheduleAfterChange(): void {
    if (pendingTimer !== null || options.getFolder() === null) return; // one is already waiting, or nowhere to put it

    const newest = list()[0];
    const sinceLastBackupMs = newest === undefined ? Infinity : options.now().getTime() - Date.parse(newest.createdAt);
    const waitMs = Math.max(BACKUP_SETTLE_DELAY_MS, BACKUP_MIN_INTERVAL_MS - sinceLastBackupMs);

    pendingTimer = scheduler(() => {
      pendingTimer = null;
      try {
        backupNow("after-change");
      } catch (error) {
        reportError("Could not back up your data.", error);
      }
    }, waitMs);
  }

  function runDailyIfDue(): Backup | null {
    const newest = list()[0];
    const today = formatLocalDay(options.now());
    if (newest !== undefined && formatLocalDay(new Date(newest.createdAt)) === today) return null;
    return backupNow("daily");
  }

  function restore(id: string, reopen: () => Database): Database {
    // Security: the id becomes part of a file path. Only a real backup file name is accepted, so
    // something like "..\\evil" can never make restore copy another file over the database.
    if (parseBackupFileName(id) === null) throw new InvalidBackupIdError(id);

    const folder = options.getFolder();
    if (folder === null) throw new NoPersonFolderError();
    const backupPath = path.join(backupsDirectory(folder), id);
    if (!fs.existsSync(backupPath)) throw new BackupNotFoundError(id);

    const currentDb = options.getDb();
    // The backup may come from another computer, where the folder lives somewhere else. Keep this one's.
    const personFolderSetting = getSetting(currentDb, "personFolder");

    // Copy the chosen backup aside first: making the safety backup below could delete an old one.
    const stagedPath = `${currentDb.path}.restoring`;
    fs.copyFileSync(backupPath, stagedPath);
    const safetyBackup = backupNow("before-restore");
    if (safetyBackup === null) throw new NoPersonFolderError();

    currentDb.close();
    removeWriteAheadFiles(currentDb.path);
    fs.renameSync(stagedPath, currentDb.path);

    let restoredDb: Database;
    try {
      restoredDb = reopen();
    } catch (error) {
      // The backup could not be opened (damaged, or from a newer Jobgoblin). Put the data back as it was.
      removeWriteAheadFiles(currentDb.path);
      fs.copyFileSync(path.join(backupsDirectory(folder), safetyBackup.id), currentDb.path);
      reopen();
      throw error;
    }

    setSetting(restoredDb, "personFolder", personFolderSetting);
    return restoredDb;
  }

  return { backupNow, scheduleAfterChange, runDailyIfDue, list, restore };
}

// ---------------------------------------------------------------------------------------------
// Copying the database file
// ---------------------------------------------------------------------------------------------

// VACUUM INTO writes a compact, consistent copy of the live database. It goes to a temporary file first and
// is renamed once complete.
function copyDatabaseInto(db: Database, directory: string, finalName: string): void {
  const temporaryPath = path.join(directory, `backup-in-progress-${process.pid}.tmp`);
  fs.rmSync(temporaryPath, { force: true }); // VACUUM INTO needs a path that does not exist; a crash may have left one
  try {
    db.sqlite.prepare("VACUUM INTO ?").run(temporaryPath);
    fs.renameSync(temporaryPath, path.join(directory, finalName));
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function removeWriteAheadFiles(databasePath: string): void {
  fs.rmSync(`${databasePath}-wal`, { force: true });
  fs.rmSync(`${databasePath}-shm`, { force: true });
}
