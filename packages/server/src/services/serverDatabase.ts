// Opens the app's database the way the server always does: migrations from the resources folder, and a
// backup of existing data first. Used at start-up and again when a backup is restored.
// Spec: ARCHITECTURE.md section 7 (openDatabase, "a backup runs before migrating an existing database").
import path from "node:path";
import { createBackups, createPersonFolder, getSetting, openDatabase, type Database } from "@jobgoblin/storage";

export type OpenServerDatabaseOptions = {
  appDataDir: string;
  resourcesDir: string;
  now: () => Date;
  // Called with the database that is about to be migrated, before the backup is made.
  beforeMigrate?: (db: Database) => void;
};

// An existing database is backed up into the person's folder when they have chosen one; before a folder
// is chosen there is nothing worth backing up yet. A new database has no data, so no backup is made.
export function openServerDatabase(options: OpenServerDatabaseOptions): Database {
  return openDatabase({
    appDataDir: options.appDataDir,
    migrationsDir: path.join(options.resourcesDir, "packages", "storage", "migrations"),
    backupBeforeMigrate: (db) => {
      options.beforeMigrate?.(db);
      const folderPath = getSetting(db, "personFolder");
      if (folderPath === null) return;
      const backups = createBackups({
        getDb: () => db,
        getFolder: () => createPersonFolder(folderPath),
        now: options.now,
      });
      backups.backupNow("before-upgrade");
    },
  });
}
