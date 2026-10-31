// Settings: reading them with the facts the server knows (last backup, tracker state), changing the ones
// the person may change, and choosing the person's folder.
// personFolder changes only through chooseFolder and setupComplete only when setup finishes; the Claude
// command is not a setting at all (decision D21), so no request can make the server run another program.
// Spec: ARCHITECTURE.md sections 5.9 (Settings), 7 and 11 (/api/settings).
import path from "node:path";
import {
  Settings,
  type ChooseFolderResponse,
  type SettingsResponse,
} from "@jobgoblin/schemas";
import {
  createPersonFolder,
  getSettings,
  setSetting,
  setSettings,
  verifyApprovedFiles,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { invalid } from "./serviceError";

// The settings a PUT may change. The others have their own routes.
const EDITABLE_KEYS = ["concurrency", "maxOpenPerCompany", "reapplyDays", "followUpDays", "usageNoticeSeen"] as const;

export function getSettingsResponse(ctx: ServerContext): SettingsResponse {
  return {
    ...getSettings(ctx.db),
    lastBackupAt: ctx.backups.list()[0]?.createdAt ?? null,
    trackerStatus: ctx.tracker.status(),
    dataFolder: ctx.appDataDir,
  };
}

// Each value is checked against its own setting's schema. A setting that is left out is not touched
// (so a partial request never resets the others to their defaults).
export function updateSettings(ctx: ServerContext, changes: Record<string, unknown>): SettingsResponse {
  const valid: Partial<Settings> = {};
  for (const key of EDITABLE_KEYS) {
    if (!(key in changes)) continue;
    const parsed = Settings.shape[key].safeParse(changes[key]);
    if (!parsed.success) {
      throw invalid("invalid-setting", `The value for "${key}" is not allowed.`, "Choose another value.");
    }
    Object.assign(valid, { [key]: parsed.data });
  }

  setSettings(ctx.db, valid);
  // A new limit on how many runs go at once is picked up by the launcher at its next wake.
  ctx.launcher?.wake();
  ctx.bus.emit({ type: "needs-you.changed" });
  return getSettingsResponse(ctx);
}

// The person's folder holds readable files and backups, and may be synced by Drive or Dropbox. The live
// database stays in the app data folder, so a folder that is, contains or sits inside it is refused.
export function chooseFolder(ctx: ServerContext, requestedPath: string): ChooseFolderResponse {
  const root = requireUsableFolderPath(ctx, requestedPath);
  const folder = createPersonFolder(root);
  try {
    folder.ensureLayout();
  } catch (error) {
    ctx.logger.warn({ err: error }, "The chosen folder could not be prepared.");
    throw invalid("folder-unusable", "Jobgoblin can't use that folder.", "Choose another one, such as a folder in Documents.");
  }

  setSetting(ctx.db, "personFolder", folder.root);
  ctx.folder = folder;
  const report = verifyApprovedFiles(ctx.db, folder);
  ctx.logger.info({ checked: report.checked, rewritten: report.rewritten.length }, "Checked approved files in the chosen folder.");
  ctx.tracker.schedule();

  return { settings: getSettingsResponse(ctx), backupsFound: ctx.backups.list() };
}

function requireUsableFolderPath(ctx: ServerContext, requestedPath: string): string {
  const trimmed = requestedPath.trim();
  if (trimmed === "" || !path.isAbsolute(trimmed)) {
    throw invalid("folder-not-absolute", "Choose a folder by its full path.", "Use the Choose folder button, or type the whole path.");
  }
  const root = path.resolve(trimmed);
  if (isSameOrInside(ctx.appDataDir, root) || isSameOrInside(root, ctx.appDataDir)) {
    throw invalid(
      "folder-holds-app-data",
      "That folder is where Jobgoblin keeps its own working files.",
      "Choose a different folder, such as one in Documents.",
    );
  }
  return root;
}

// True when `inner` is `outer` or somewhere below it.
function isSameOrInside(inner: string, outer: string): boolean {
  const relative = path.relative(path.resolve(outer), path.resolve(inner));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
