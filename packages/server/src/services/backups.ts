// Backups the person can see and use: list them, make one now, restore one. A restore replaces the
// database, so the server's database handle is swapped (ctx.db) and the person's folder setting of this
// computer is kept. Storage makes a safety backup of the current data first and puts it back if the chosen
// backup cannot be opened.
// Spec: ARCHITECTURE.md section 7 (Backups) and 11 (/api/backups); PRD S5.
import type { Backup, SettingsResponse } from "@jobgoblin/schemas";
import { listRunsByStatus, verifyApprovedFiles, type Database } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { announceProfileChange } from "./changes";
import { recoverInterruptedRuns } from "./runRecovery";
import { openServerDatabase } from "./serverDatabase";
import { conflict, unavailable } from "./serviceError";
import { getSettingsResponse } from "./settings";

export function listBackups(ctx: ServerContext): Backup[] {
  return ctx.backups.list();
}

export function backupNow(ctx: ServerContext): Backup {
  const backup = ctx.backups.backupNow("manual");
  if (backup === null) {
    throw unavailable("no-person-folder", "Choose your Jobgoblin folder first.", "Open Settings and choose a folder.");
  }
  return backup;
}

export function restoreBackup(ctx: ServerContext, backupId: string): SettingsResponse {
  const running = listRunsByStatus(ctx.db, ["running"]);
  if (running.length > 0) {
    throw conflict("runs-active", "A run is working with your data right now.", "Wait for it to finish, or cancel it from Today, then restore.");
  }

  ctx.backups.restore(backupId, () => reopenDatabase(ctx));
  // A backup made while a run was going remembers it as running, but no process of this session is behind it.
  recoverInterruptedRuns(ctx);
  if (ctx.folder !== null) {
    const report = verifyApprovedFiles(ctx.db, ctx.folder);
    ctx.logger.info({ rewritten: report.rewritten.length }, "Restored a backup and checked approved files.");
  }

  // Everything on every screen may be different now.
  announceProfileChange(ctx);
  return getSettingsResponse(ctx);
}

// Opens the database file again and makes it the server's current one.
function reopenDatabase(ctx: ServerContext): Database {
  const db = openServerDatabase({
    appDataDir: ctx.appDataDir,
    resourcesDir: ctx.resourcesDir,
    now: ctx.now,
    // A backup made while migrating needs the database that is being opened, not the old, closed one.
    beforeMigrate: (opening) => {
      ctx.db = opening;
    },
  });
  ctx.db = db;
  return db;
}
