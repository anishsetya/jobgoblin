// What a backup file is called, and which backups are kept: the pure rules behind backups.ts. A name holds the
// local time it was made ("2026-10-31 14-05.jobgoblin-backup"), and the same name is the only thing restore()
// accepts as a backup id. Retention keeps everything from the last 2 days, then one backup per day for 14 days.
// Spec: ARCHITECTURE.md section 7 ("Backups"); tech spec "Rules" (Backups).
import fs from "node:fs";
import path from "node:path";
import type { Backup } from "@jobgoblin/schemas";
import { formatLocalDay, formatLocalMinute } from "./localTime";

export const BACKUP_FILE_EXTENSION = ".jobgoblin-backup";

// "2026-10-31 14-05.jobgoblin-backup", or "2026-10-31 14-05-2.jobgoblin-backup" for a second one in the same minute.
// This pattern is also the only thing restore() accepts as a backup id (see InvalidBackupIdError).
const BACKUP_FILE_NAME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})(?:-(\d+))?\.jobgoblin-backup$/;

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_EVERY_BACKUP_FOR_MS = 2 * DAY_MS; // every backup from the last 2 days...
const KEEP_ONE_PER_DAY_FOR_MS = 14 * DAY_MS; // ...then one per day for 14 days

export type BackupFile = { backup: Backup; sequence: number };

// Two backups made in the same minute differ only by the "-2" in their name, so that decides which is newer.
export function newestFirst(a: BackupFile, b: BackupFile): number {
  if (a.backup.createdAt !== b.backup.createdAt) return b.backup.createdAt.localeCompare(a.backup.createdAt);
  return b.sequence - a.sequence;
}

// Null when the text is not a backup file name (a temporary file, a note the person added, a path in disguise).
export function parseBackupFileName(fileName: string): { createdAt: Date; sequence: number } | null {
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

export function chooseUnusedBackupName(directory: string, now: Date): string {
  const base = formatLocalMinute(now, "-");
  for (let sequence = 1; ; sequence += 1) {
    const suffix = sequence === 1 ? "" : `-${sequence}`;
    const name = `${base}${suffix}${BACKUP_FILE_EXTENSION}`;
    if (!fs.existsSync(path.join(directory, name))) return name;
  }
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
