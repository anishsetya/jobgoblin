import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Actor,
  ApplicationResumeState,
  ApplicationStatus,
  Ats,
  Band,
  CompanyStatus,
  HISTORY_EVENT_TYPES,
  JobSource,
  ModelTier,
  ProfileSectionName,
  ProofType,
  Region,
  RunKind,
  RunStatus,
  RunTaskState,
  StoryItemKind,
  StoryItemStatus,
  SubmitMode,
  UploadKind,
} from "@jobgoblin/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseTooNewError } from "./errors";
import { defaultMigrationsDir, readSchemaVersion } from "./migrations";
import { openDatabase } from "./openDatabase";
import { aHistoryEvent, anApplicationInDatabase, makeTempDir, openTestDatabase, removeTempDirs } from "./testSupport";
import { insertHistoryEvent } from "./tables/historyEvents";

afterEach(removeTempDirs);

function newestMigrationNumber(): number {
  const names = fs.readdirSync(defaultMigrationsDir()).filter((name) => /^\d{4}_.+\.sql$/.test(name));
  return names.length;
}

// A migrations folder made for one test.
function makeMigrationsDir(files: Record<string, string>): string {
  const directory = makeTempDir();
  for (const [name, sql] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, name), sql);
  }
  return directory;
}

describe("migrations", () => {
  it("creates every table on a new database and records the schema version", () => {
    const db = openTestDatabase();

    const tables = db.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);

    expect(readSchemaVersion(db)).toBe(newestMigrationNumber());
    expect(tables).toEqual([
      "answers", "application_resumes", "applications", "approvals", "companies", "feed_cache", "fits",
      "history_events", "jobs", "master_resume", "profile", "questions", "resume_versions", "run_tasks",
      "runs", "settings", "story_items", "submissions", "uploads",
    ]);
    db.close();
  });

  it("does not ask for a backup when the database is brand new", () => {
    const backupBeforeMigrate = vi.fn();

    const db = openDatabase({
      appDataDir: makeTempDir(),
      migrationsDir: defaultMigrationsDir(),
      backupBeforeMigrate,
    });

    expect(backupBeforeMigrate).not.toHaveBeenCalled();
    db.close();
  });

  it("asks for a backup before upgrading a database that already holds data, then upgrades it", () => {
    const appDataDir = makeTempDir();
    const firstMigration = "CREATE TABLE notes (id INTEGER PRIMARY KEY) STRICT;";
    const migrationsV1 = makeMigrationsDir({ "0001_start.sql": firstMigration });
    openDatabase({ appDataDir, migrationsDir: migrationsV1, backupBeforeMigrate: () => undefined }).close();
    const migrationsV2 = makeMigrationsDir({
      "0001_start.sql": firstMigration,
      "0002_more.sql": "CREATE TABLE tags (id INTEGER PRIMARY KEY) STRICT;",
    });
    const versionSeenByBackup: number[] = [];

    const db = openDatabase({
      appDataDir,
      migrationsDir: migrationsV2,
      backupBeforeMigrate: (database) => versionSeenByBackup.push(readSchemaVersion(database)),
    });

    expect(versionSeenByBackup).toEqual([1]);
    expect(readSchemaVersion(db)).toBe(2);
    db.close();
  });

  it("refuses a database written by a newer Jobgoblin, with the plain message, and lets go of the file", () => {
    const appDataDir = makeTempDir();
    openTestDatabase(appDataDir).close();
    const newer = new DatabaseSync(path.join(appDataDir, "jobgoblin.db"));
    newer.exec("PRAGMA user_version = 99");
    newer.close();

    const open = () =>
      openDatabase({ appDataDir, migrationsDir: defaultMigrationsDir(), backupBeforeMigrate: () => undefined });

    expect(open).toThrow(DatabaseTooNewError);
    expect(open).toThrow("Update Jobgoblin to open your data.");
    expect(() => fs.rmSync(path.join(appDataDir, "jobgoblin.db"))).not.toThrow();
  });

  it("leaves the database as it was when a migration fails halfway", () => {
    const appDataDir = makeTempDir();
    const goodStart = "CREATE TABLE notes (id INTEGER PRIMARY KEY) STRICT;";
    const startOnly = makeMigrationsDir({ "0001_start.sql": goodStart });
    openDatabase({ appDataDir, migrationsDir: startOnly, backupBeforeMigrate: () => undefined }).close();
    const brokenSecond = makeMigrationsDir({
      "0001_start.sql": goodStart,
      "0002_broken.sql": "CREATE TABLE half_done (id INTEGER); THIS IS NOT SQL;",
    });

    const upgrade = () =>
      openDatabase({ appDataDir, migrationsDir: brokenSecond, backupBeforeMigrate: () => undefined });
    expect(upgrade).toThrow();

    const db = openDatabase({ appDataDir, migrationsDir: startOnly, backupBeforeMigrate: () => undefined });
    const halfDoneTable = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get();
    expect(readSchemaVersion(db)).toBe(1);
    expect(halfDoneTable).toBeUndefined();
    db.close();
  });

  it("refuses migration files with a gap in their numbering", () => {
    const migrationsDir = makeMigrationsDir({
      "0001_start.sql": "CREATE TABLE a (id INTEGER) STRICT;",
      "0003_skipped_two.sql": "CREATE TABLE b (id INTEGER) STRICT;",
    });

    const open = () =>
      openDatabase({ appDataDir: makeTempDir(), migrationsDir, backupBeforeMigrate: () => undefined });

    expect(open).toThrow(/without gaps/);
  });
});

describe("CHECK lists in 0001_initial.sql", () => {
  const sql = fs.readFileSync(path.join(defaultMigrationsDir(), "0001_initial.sql"), "utf8");

  // Reads the values out of: CHECK (column IN ('a', 'b', ...)) inside CREATE TABLE table (...) STRICT;
  function checkListFor(table: string, column: string): string[] {
    const tableStart = sql.indexOf(`CREATE TABLE ${table} (`);
    const tableEnd = sql.indexOf(") STRICT;", tableStart);
    expect(tableStart, `table ${table} is in the migration`).toBeGreaterThanOrEqual(0);
    const tableSql = sql.slice(tableStart, tableEnd);

    const list = new RegExp(`CHECK \\(\\s*${column} IN \\(((?:\\s*'[^']*'\\s*,?)+)\\s*\\)\\s*\\)`).exec(tableSql);
    expect(list, `${table}.${column} has a CHECK list`).not.toBeNull();
    return [...(list?.[1] ?? "").matchAll(/'([^']*)'/g)].map((match) => match[1] ?? "");
  }

  const checkedColumns: [table: string, column: string, allowed: readonly string[]][] = [
    ["applications", "status", ApplicationStatus.options],
    ["runs", "status", RunStatus.options],
    ["profile", "section", ProfileSectionName.options],
    ["story_items", "kind", StoryItemKind.options],
    ["story_items", "status", StoryItemStatus.options],
    ["uploads", "kind", UploadKind.options],
    ["companies", "ats", Ats.options],
    ["companies", "status", CompanyStatus.options],
    ["jobs", "source", JobSource.options],
    ["jobs", "region", Region.options],
    ["applications", "band", Band.options],
    ["applications", "submit_mode", SubmitMode.options],
    ["fits", "band", Band.options],
    ["application_resumes", "state", ApplicationResumeState.options],
    ["approvals", "submit_mode", SubmitMode.options],
    ["submissions", "proof_type", ProofType.options],
    ["runs", "kind", RunKind.options],
    ["runs", "model", ModelTier.options],
    ["run_tasks", "state", RunTaskState.options],
    ["questions", "run_kind", RunKind.options],
    ["history_events", "actor", Actor.options],
    ["history_events", "type", HISTORY_EVENT_TYPES],
  ];

  it.each(checkedColumns)("lists exactly the values of its enum for %s.%s", (table, column, allowed) => {
    const listedInSql = checkListFor(table, column);

    expect([...listedInSql].sort()).toEqual([...allowed].sort());
  });

  it("lists all 20 application statuses and all 8 run statuses", () => {
    expect(checkListFor("applications", "status")).toHaveLength(20);
    expect(checkListFor("runs", "status")).toHaveLength(8);
  });
});

describe("history_events", () => {
  it("refuses to change a row", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db);
    insertHistoryEvent(db, aHistoryEvent());

    const change = () => db.sqlite.prepare("UPDATE history_events SET detail = 'rewritten'").run();

    expect(change).toThrow(/append-only/);
    db.close();
  });

  it("refuses to delete a row", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db);
    insertHistoryEvent(db, aHistoryEvent());

    const remove = () => db.sqlite.prepare("DELETE FROM history_events").run();

    expect(remove).toThrow(/append-only/);
    db.close();
  });
});
