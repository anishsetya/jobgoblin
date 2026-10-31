// Backups: a copy of the database in the person's Backups folder, made shortly after changes and once a day,
// kept for a while, and restorable in one click (also on a new computer, from the same synced folder).
// The copy is made with VACUUM INTO into a temporary file and renamed, so a sync tool only ever sees a finished file.
// Spec: ARCHITECTURE.md section 7 ("Backups"); tech spec "Rules" (Backups).
import fs from "node:fs";
import path from "node:path";
import { Backup } from "@jobgoblin/schemas";
import type { Database } from "./database";
import { BackupNotFoundError, InvalidBackupIdError, NoPersonFolderError } from "./errors";
import { formatLocalDay, formatLocalMinute } from "./localTime";
import { BACKUPS_DIR, type PersonFolder } from "./personFolder";
import { realScheduler, reportErrorToConsole, type ReportError, type ScheduledTimer, type Scheduler } from "./scheduler";
import { getSetting, setSetting } from "./tables/settings";

export const BACKUP_FILE_EXTENSION = ".jobgoblin-backup";

// "2026-10-31 14-05.jobgoblin-backup", or "2026-10-31 14-05-2.jobgoblin-backup" for a second one in the same minute.
// This pattern is also the only thing restore() accepts as a backup id (see InvalidBackupIdError).
const BACKUP_FILE_NAME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})(?:-(\d+))?\.jobgoblin-backup$/;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const BACKUP_MIN_INTERVAL_MS = 5 * MINUTE_MS; // PRD S5: after changes, at most one backup every 5 minutes
const BACKUP_SETTLE_DELAY_MS = 2_000; // lets a burst of changes finish before copying
const KEEP_EVERY_BACKUP_FOR_MS = 2 * DAY_MS; // every backup from the last 2 days...
const KEEP_ONE_PER_DAY_FOR_MS = 14 * DAY_MS; // ...then one per day for 14 days

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

type BackupFile = { backup: Backup; sequence: number };

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
// Names and retention
// ---------------------------------------------------------------------------------------------

// Two backups made in the same minute differ only by the "-2" in their name, so that decides which is newer.
function newestFirst(a: BackupFile, b: BackupFile): number {
  if (a.backup.createdAt !== b.backup.createdAt) return b.backup.createdAt.localeCompare(a.backup.createdAt);
  return b.sequence - a.sequence;
}

function parseBackupFileName(fileName: string): { createdAt: Date; sequence: number } | null {
  const match = BACKUP_FILE_NAME.exec(fileName);
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const createdAt = new Date(year, month - 1, day, hour, minute);
  // new Date rolls "month 13" over into next year; a real backup name never does.
  const isRealDate = createdAt.getFullYear() === year && createdAt.getMonth() === month - 1 && createdAt.getDate() === day;
  if (!isRealDate) return null;

  return { createdAt, sequence: match[6] === undefined ? 1 : Number(match[6]) };
}

function chooseUnusedBackupName(directory: string, now: Date): string {
  const base = formatLocalMinute(now, "-");
  for (let sequence = 1; ; sequence += 1) {
    const suffix = sequence === 1 ? "" : `-${sequence}`;
    const name = `${base}${suffix}${BACKUP_FILE_EXTENSION}`;
    if (!fs.existsSync(path.join(directory, name))) return name;
  }
}

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

// Which backups to keep: every one from the last 2 days, then the newest one of each calendar day for
// 14 days in total, and nothing older. `backups` must be newest first (as list() returns them).
export function chooseBackupsToKeep(backups: readonly Backup[], now: Date): Set<string> {
  const keep = new Set<string>();
  const daysAlreadyKept = new Set<string>();

  for (const backup of backups) {
    const createdAt = new Date(backup.createdAt);
    const ageMs = now.getTime() - createdAt.getTime();
    const day = formatLocalDay(createdAt);

    if (ageMs <= KEEP_EVERY_BACKUP_FOR_MS) {
      keep.add(backup.id);
      daysAlreadyKept.add(day);
    } else if (ageMs <= KEEP_ONE_PER_DAY_FOR_MS && !daysAlreadyKept.has(day)) {
      keep.add(backup.id);
      daysAlreadyKept.add(day);
    }
  }
  return keep;
}
