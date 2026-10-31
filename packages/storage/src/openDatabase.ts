// Opens (and, on first launch, creates) the database in the app data folder and brings its schema up to date.
// This is the only place a connection is created; the server holds the one and only writer.
// Spec: ARCHITECTURE.md section 7 (openDatabase) and tech spec "Rules" ("One writer").
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDatabase, type Database } from "./database";
import { migrateDatabase } from "./migrations";

export const DATABASE_FILE_NAME = "jobgoblin.db";

// How long a statement waits for another connection's lock before failing. Only the backup's
// VACUUM INTO and tools such as a database browser can ever hold one.
const BUSY_TIMEOUT_MS = 5_000;

export type OpenDatabaseOptions = {
  // The app data folder (never a synced folder: a sync tool copying a live database can corrupt it).
  appDataDir: string;
  // Folder holding 0001_initial.sql and later migrations. Use defaultMigrationsDir() in development and tests.
  migrationsDir: string;
  // Called before migrating a database that already holds data, so the person can go back after an upgrade.
  backupBeforeMigrate: (db: Database) => void;
};

export function openDatabase(options: OpenDatabaseOptions): Database {
  fs.mkdirSync(options.appDataDir, { recursive: true });
  const databasePath = path.join(options.appDataDir, DATABASE_FILE_NAME);

  const sqlite = new DatabaseSync(databasePath, { timeout: BUSY_TIMEOUT_MS });
  const db = createDatabase(sqlite, databasePath);
  try {
    turnOnSafetyFeatures(db);
    migrateDatabase(db, options.migrationsDir, options.backupBeforeMigrate);
    return db;
  } catch (error) {
    // Do not leave the file locked when the app refuses to start (for example, a newer database).
    db.close();
    throw error;
  }
}

function turnOnSafetyFeatures(db: Database): void {
  // WAL lets a reader and the writer work at once and survives a crash mid-write.
  db.sqlite.exec("PRAGMA journal_mode = WAL");
  // SQLite ignores FOREIGN KEY constraints unless this is switched on for every connection.
  db.sqlite.exec("PRAGMA foreign_keys = ON");
}
