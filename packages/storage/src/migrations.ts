// Schema migrations: numbered .sql files, applied in order, tracked with PRAGMA user_version.
// A database that is already at the newest version is left alone; one from a newer app is refused.
// Spec: ARCHITECTURE.md section 7 ("Migrations: migrations/0001_initial.sql onwards").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./database";
import { DatabaseTooNewError } from "./errors";

type MigrationFile = { version: number; fileName: string; sql: string };

// Where the migrations are in development and in tests. Anything that runs from a bundle (Electron)
// cannot use this: it passes migrationsDir to openDatabase instead (decision D2).
export function defaultMigrationsDir(): string {
  const thisFolder = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisFolder, "..", "migrations");
}

export function readSchemaVersion(db: Database): number {
  const row = db.sqlite.prepare("PRAGMA user_version").get();
  const version = row?.user_version;
  if (typeof version !== "number") throw new Error("SQLite did not report a schema version.");
  return version;
}

// Brings the database up to the newest migration. backupBeforeMigrate runs first, but only when there
// is existing data to protect: a brand-new database has nothing to lose.
export function migrateDatabase(
  db: Database,
  migrationsDir: string,
  backupBeforeMigrate: (db: Database) => void,
): void {
  const migrations = readMigrationFiles(migrationsDir);
  const newestVersion = migrations.at(-1)?.version ?? 0;
  const currentVersion = readSchemaVersion(db);

  if (currentVersion > newestVersion) throw new DatabaseTooNewError();
  if (currentVersion === newestVersion) return;

  const hasExistingData = currentVersion > 0;
  if (hasExistingData) backupBeforeMigrate(db);

  for (const migration of migrations) {
    if (migration.version > currentVersion) applyMigration(db, migration);
  }
}

// The SQL and the new version number go in one transaction, so a migration that fails halfway
// leaves the database exactly as it was.
function applyMigration(db: Database, migration: MigrationFile): void {
  db.transaction(() => {
    db.sqlite.exec(migration.sql);
    // The version is a number we parsed from a file name, never user input.
    db.sqlite.exec(`PRAGMA user_version = ${migration.version}`);
  });
}

const MIGRATION_FILE_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

function readMigrationFiles(migrationsDir: string): MigrationFile[] {
  const migrations: MigrationFile[] = [];
  for (const fileName of fs.readdirSync(migrationsDir).sort()) {
    const match = MIGRATION_FILE_NAME.exec(fileName);
    if (match === null) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, fileName), "utf8");
    migrations.push({ version: Number(match[1]), fileName, sql });
  }
  refuseGapsInNumbering(migrations);
  return migrations;
}

// 0001, 0002, 0003 ... with nothing missing: a gap means a migration was lost or not copied.
function refuseGapsInNumbering(migrations: MigrationFile[]): void {
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Migration ${migration.fileName} should be number ${String(expectedVersion).padStart(4, "0")}. ` +
          "Migrations must be numbered 0001, 0002, ... without gaps.",
      );
    }
  });
}
