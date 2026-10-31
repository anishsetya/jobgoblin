// The tracker as a download. The tracker files are written into the person's folder by storage (shortly
// after every change); an export writes them once more, right now, and hands back the bytes, so the file the
// person downloads is never behind. Dashboard note: the same files are at <person folder>/Tracker.csv and Tracker.xlsx.
// Spec: ARCHITECTURE.md sections 7 (tracker) and 11 (/api/export).
import fs from "node:fs";
import type { ServerContext } from "../context";
import { notFound, unavailable } from "./serviceError";

export type ExportFormat = "csv" | "xlsx";

export type ExportFile = { bytes: Uint8Array; contentType: string; fileName: string };

// Written by storage's tracker exporter; these names are not exported from the storage package.
const TRACKER_FILE_NAMES: Record<ExportFormat, string> = { csv: "Tracker.csv", xlsx: "Tracker.xlsx" };
const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function exportTracker(ctx: ServerContext, format: ExportFormat): Promise<ExportFile> {
  const folder = ctx.folder;
  if (folder === null) {
    throw unavailable("no-person-folder", "Choose your Jobgoblin folder first.", "Open Settings and choose a folder.");
  }

  // If Excel has the file open, the write is postponed and the last finished file is still served.
  await ctx.tracker.flushNow();

  const fileName = TRACKER_FILE_NAMES[format];
  const filePath = folder.absolutePath(fileName);
  if (!fs.existsSync(filePath)) throw notFound("tracker file", "Try again in a moment.");
  return { bytes: fs.readFileSync(filePath), contentType: CONTENT_TYPES[format], fileName };
}
