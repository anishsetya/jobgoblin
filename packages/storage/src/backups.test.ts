import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Backup } from "@jobgoblin/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseBackupsToKeep, createBackups } from "./backups";
import type { Database } from "./database";
import { BackupNotFoundError, InvalidBackupIdError } from "./errors";
import { formatLocalMinute } from "./localTime";
import { createPersonFolder } from "./personFolder";
import { getSetting, setSetting, setSettings } from "./tables/settings";
import { createFakeScheduler, makeTempDir, openTestDatabase, removeTempDirs } from "./testSupport";

afterEach(removeTempDirs);

// Times are local, like the file names: new Date(2026, 9, 31, 14, 5) is 31 October 2026, 14:05 on this computer.
const at = (day: number, hour: number, minute = 0, month = 9) => new Date(2026, month, day, hour, minute);
const OCT_31_14_05 = at(31, 14, 5);

function setUp() {
  const appDataDir = makeTempDir();
  const folder = createPersonFolder(path.join(makeTempDir(), "Jobgoblin"));
  const state: { db: Database; clock: Date } = { db: openTestDatabase(appDataDir), clock: OCT_31_14_05 };
  const reopen = (): Database => {
    state.db = openTestDatabase(appDataDir);
    return state.db;
  };
  const timers = createFakeScheduler();
  const onBackupDone = vi.fn();
  const reportError = vi.fn();
  const backups = createBackups({
    getDb: () => state.db,
    getFolder: () => folder,
    now: () => state.clock,
    scheduler: timers.scheduler,
    onBackupDone,
    reportError,
  });
  return { appDataDir, folder, state, reopen, timers, onBackupDone, reportError, backups };
}

const backupsDirectory = (folder: ReturnType<typeof createPersonFolder>) => path.join(folder.root, "Backups");

function aBackupMadeAt(date: Date): Backup {
  return {
    id: `${formatLocalMinute(date, "-")}.jobgoblin-backup`,
    createdAt: date.toISOString(),
    sizeBytes: 1,
  };
}

describe("backupNow", () => {
  it("copies the database into the Backups folder under a name made from the date and time", () => {
    const { folder, state, backups } = setUp();
    setSetting(state.db, "reapplyDays", 30);

    const backup = backups.backupNow("manual");

    expect(backup?.id).toBe("2026-10-31 14-05.jobgoblin-backup");
    expect(backup?.createdAt).toBe(OCT_31_14_05.toISOString());
    expect(backup?.sizeBytes).toBeGreaterThan(0);
    expect(fs.readdirSync(backupsDirectory(folder))).toEqual(["2026-10-31 14-05.jobgoblin-backup"]); // no temporary file left

    const copy = new DatabaseSync(path.join(backupsDirectory(folder), "2026-10-31 14-05.jobgoblin-backup"), { readOnly: true });
    expect(copy.prepare("SELECT value FROM settings WHERE key = 'reapplyDays'").get()?.value).toBe("30");
    copy.close();
  });

  it("adds -2 to the name when two backups are made in the same minute, and lists the newer one first", () => {
    const { backups } = setUp();

    backups.backupNow("manual");
    backups.backupNow("manual");

    expect(backups.list().map((backup) => backup.id)).toEqual([
      "2026-10-31 14-05-2.jobgoblin-backup",
      "2026-10-31 14-05.jobgoblin-backup",
    ]);
  });

  it("tells the caller why and when a backup was made", () => {
    const { onBackupDone, backups } = setUp();

    backups.backupNow("before-upgrade");

    expect(onBackupDone).toHaveBeenCalledWith(expect.objectContaining({ id: "2026-10-31 14-05.jobgoblin-backup" }), "before-upgrade");
  });

  it("does nothing until the person has chosen a folder", () => {
    const state = { db: openTestDatabase() };
    const backups = createBackups({ getDb: () => state.db, getFolder: () => null, now: () => OCT_31_14_05 });

    expect(backups.backupNow("manual")).toBeNull();
    expect(backups.list()).toEqual([]);
  });

  it("ignores files in the Backups folder that are not backups", () => {
    const { folder, backups } = setUp();
    backups.backupNow("manual");
    fs.writeFileSync(path.join(backupsDirectory(folder), "notes.txt"), "my notes");
    fs.writeFileSync(path.join(backupsDirectory(folder), "2026-13-45 99-99.jobgoblin-backup"), "not a real date");

    expect(backups.list()).toHaveLength(1);
  });
});

describe("what is kept", () => {
  // Now is 31 October 14:05. Backups listed newest first, as list() returns them.
  const now = OCT_31_14_05;
  const backups = [
    aBackupMadeAt(at(31, 13)), // today
    aBackupMadeAt(at(31, 9)), // today
    aBackupMadeAt(at(30, 20)), // yesterday
    aBackupMadeAt(at(30, 8)), // yesterday
    aBackupMadeAt(at(29, 16)), // 46 hours ago: still in the last 2 days
    aBackupMadeAt(at(29, 10)), // 52 hours ago: a second backup from a day we already keep
    aBackupMadeAt(at(28, 18)), // the newest of its day
    aBackupMadeAt(at(28, 9)), // an earlier backup of the same day
    aBackupMadeAt(at(20, 12)), // 11 days ago: the newest of its day
    aBackupMadeAt(at(20, 8)), // an earlier backup of the same day
    aBackupMadeAt(at(10, 12)), // 21 days ago
  ];

  it("keeps everything from the last 2 days, then the newest of each day for 14 days, and drops the rest", () => {
    const keep = chooseBackupsToKeep(backups, now);

    const keptNames = backups.filter((backup) => keep.has(backup.id)).map((backup) => backup.id.slice(0, 16));
    expect(keptNames).toEqual([
      "2026-10-31 13-00",
      "2026-10-31 09-00",
      "2026-10-30 20-00",
      "2026-10-30 08-00",
      "2026-10-29 16-00",
      "2026-10-28 18-00",
      "2026-10-20 12-00",
    ]);
  });

  it("deletes the backups it no longer keeps whenever it makes a new one", () => {
    const { folder, state, backups: realBackups } = setUp();
    state.clock = at(31, 14, 5);
    fs.mkdirSync(backupsDirectory(folder), { recursive: true });
    for (const old of backups) fs.writeFileSync(path.join(backupsDirectory(folder), old.id), "placeholder");

    realBackups.backupNow("after-change");

    const remaining = fs.readdirSync(backupsDirectory(folder)).map((name) => name.slice(0, 16)).sort();
    expect(remaining).toEqual([
      "2026-10-20 12-00",
      "2026-10-28 18-00",
      "2026-10-29 16-00",
      "2026-10-30 08-00",
      "2026-10-30 20-00",
      "2026-10-31 09-00",
      "2026-10-31 13-00",
      "2026-10-31 14-05",
    ]);
  });
});

describe("scheduleAfterChange", () => {
  it("makes a backup shortly after a change when none was made recently", () => {
    const { timers, backups } = setUp();

    backups.scheduleAfterChange();

    expect(timers.pendingDelays()).toEqual([2_000]);
  });

  it("waits until 5 minutes after the last backup", () => {
    const { state, timers, backups } = setUp();
    backups.backupNow("manual");
    state.clock = at(31, 14, 7); // two minutes later

    backups.scheduleAfterChange();

    expect(timers.pendingDelays()).toEqual([3 * 60 * 1000]);
  });

  it("keeps one timer for a burst of changes, and schedules again after the backup is made", () => {
    const { folder, state, timers, backups } = setUp();

    backups.scheduleAfterChange();
    backups.scheduleAfterChange();
    expect(timers.pendingDelays()).toEqual([2_000]);

    timers.runNext();
    expect(fs.readdirSync(backupsDirectory(folder))).toHaveLength(1);

    state.clock = at(31, 14, 20);
    backups.scheduleAfterChange();
    expect(timers.pendingDelays()).toEqual([2_000]);
  });

  it("reports a failed scheduled backup instead of swallowing it", () => {
    const { state, timers, reportError, backups } = setUp();
    backups.scheduleAfterChange();
    state.db.close();

    timers.runNext();

    expect(reportError).toHaveBeenCalledWith("Could not back up your data.", expect.anything());
  });
});

describe("runDailyIfDue", () => {
  it("makes a backup when none was made today, and not again the same day", () => {
    const { state, backups } = setUp();

    const first = backups.runDailyIfDue();
    state.clock = at(31, 20, 0);
    const second = backups.runDailyIfDue();
    state.clock = at(1, 8, 0, 10); // 1 November
    const nextDay = backups.runDailyIfDue();

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(nextDay).not.toBeNull();
    expect(backups.list()).toHaveLength(2);
  });
});

describe("restore", () => {
  it("brings back the old data and keeps this computer's folder setting", () => {
    const { state, reopen, backups } = setUp();
    setSettings(state.db, { reapplyDays: 30, personFolder: "D:\\Old computer\\Jobgoblin" });
    const backup = backups.backupNow("manual");
    setSettings(state.db, { reapplyDays: 45, personFolder: "C:\\Users\\alex\\Documents\\Jobgoblin" });

    const restored = backups.restore(backup?.id ?? "", reopen);

    expect(restored).toBe(state.db);
    expect(getSetting(restored, "reapplyDays")).toBe(30);
    expect(getSetting(restored, "personFolder")).toBe("C:\\Users\\alex\\Documents\\Jobgoblin");
  });

  it("makes a backup of the current data first", () => {
    const { folder, state, reopen, backups } = setUp();
    setSetting(state.db, "reapplyDays", 30);
    const backup = backups.backupNow("manual");
    setSetting(state.db, "reapplyDays", 45);

    backups.restore(backup?.id ?? "", reopen);

    const safetyBackups = backups.list().filter((candidate) => candidate.id !== backup?.id);
    expect(safetyBackups).toHaveLength(1);
    const safetyCopy = new DatabaseSync(path.join(backupsDirectory(folder), safetyBackups[0]?.id ?? ""), { readOnly: true });
    expect(safetyCopy.prepare("SELECT value FROM settings WHERE key = 'reapplyDays'").get()?.value).toBe("45");
    safetyCopy.close();
  });

  it.each(["..\\evil", "../evil", "..", "evil.db", "", "C:\\Windows\\system.ini", "2026-10-31 14-05.jobgoblin-backup\\..\\..\\evil"])(
    "refuses the id %j, which is not the name of a backup",
    (id) => {
      const { state, reopen, backups } = setUp();
      setSetting(state.db, "reapplyDays", 30);

      const restoreIt = () => backups.restore(id, reopen);

      expect(restoreIt).toThrow(InvalidBackupIdError);
      expect(getSetting(state.db, "reapplyDays")).toBe(30); // still open, still the same data
    },
  );

  it("says so when the backup is no longer in the folder", () => {
    const { reopen, backups } = setUp();

    const restoreMissing = () => backups.restore("2026-01-01 08-00.jobgoblin-backup", reopen);

    expect(restoreMissing).toThrow(BackupNotFoundError);
  });

  it("puts the current data back when the backup cannot be opened", () => {
    const { folder, state, reopen, backups } = setUp();
    setSetting(state.db, "reapplyDays", 45);
    fs.mkdirSync(backupsDirectory(folder), { recursive: true });
    fs.writeFileSync(path.join(backupsDirectory(folder), "2026-10-30 09-00.jobgoblin-backup"), "this is not a database");

    const restoreDamaged = () => backups.restore("2026-10-30 09-00.jobgoblin-backup", reopen);

    expect(restoreDamaged).toThrow();
    expect(getSetting(state.db, "reapplyDays")).toBe(45);
  });
});
