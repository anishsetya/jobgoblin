// The tracker export: Tracker.csv and Tracker.xlsx in the person's folder, rewritten shortly after every
// change so the person can open their applications in Excel, Numbers or Google Sheets.
// Files are written to a temporary file and renamed into place, so a reader never sees half a file. If
// Excel has the file open the rename fails; the export then reports "locked" and tries again later.
// Spec: ARCHITECTURE.md section 7 ("Tracker"); tech spec "Rules" (Tracker export).
import fs from "node:fs";
import path from "node:path";
import type { TrackerStatus } from "@jobgoblin/schemas";
import { stringify } from "csv-stringify/sync";
import ExcelJS from "exceljs";
import type { Database } from "./database";
import { formatLocalDay, formatLocalMinute } from "./localTime";
import type { PersonFolder } from "./personFolder";
import { realScheduler, reportErrorToConsole, type ReportError, type ScheduledTimer, type Scheduler } from "./scheduler";
import { listTrackerRows, type TrackerRow } from "./tables/applicationQueries";

export const TRACKER_CSV_FILE_NAME = "Tracker.csv";
export const TRACKER_XLSX_FILE_NAME = "Tracker.xlsx";

// Wait for a burst of changes to finish before writing. A folder that Google Drive, OneDrive, Dropbox or
// iCloud watches waits longer, so the sync tool is not uploading the tracker all the time.
const TRACKER_DEBOUNCE_MS = 2_000;
const TRACKER_DEBOUNCE_CLOUD_SYNCED_MS = 60_000;
const TRACKER_RETRY_WHEN_LOCKED_MS = 30_000;

// The columns, in order, exactly as the person sees them.
export const TRACKER_COLUMNS = [
  "Company",
  "Role",
  "Status",
  "Fit",
  "Band",
  "Resume version",
  "Applied on",
  "Follow up on",
  "Posting",
  "Folder",
  "Updated",
] as const;
type TrackerColumn = (typeof TRACKER_COLUMNS)[number];
type TrackerCells = Record<TrackerColumn, string | number>;

const XLSX_COLUMN_WIDTHS: Record<TrackerColumn, number> = {
  Company: 24,
  Role: 36,
  Status: 18,
  Fit: 6,
  Band: 11,
  "Resume version": 16,
  "Applied on": 12,
  "Follow up on": 13,
  Posting: 48,
  Folder: 48,
  Updated: 17,
};

export interface TrackerExporter {
  // Something changed: write the files soon (after a short pause that lets a burst of changes finish).
  schedule(): void;
  // Write the files now and wait until they are written. Used on quit and by the Export buttons.
  flushNow(): Promise<void>;
  // "off": no folder chosen yet. "locked": the last write was blocked, probably by Excel. Otherwise "ok".
  status(): TrackerStatus;
}

export type TrackerExporterOptions = {
  // Getters rather than values, because restoring a backup replaces the database and choosing another
  // folder replaces the folder while the exporter lives on.
  getDb: () => Database;
  getFolder: () => PersonFolder | null;
  now: () => Date;
  scheduler?: Scheduler;
  // Tests replace this to make a rename fail the way it does when Excel holds the file.
  renameFile?: (fromPath: string, toPath: string) => Promise<void>;
  reportError?: ReportError;
};

export function createTrackerExporter(options: TrackerExporterOptions): TrackerExporter {
  const scheduler = options.scheduler ?? realScheduler;
  const renameFile = options.renameFile ?? fs.promises.rename;
  const reportError = options.reportError ?? reportErrorToConsole;

  let pendingTimer: ScheduledTimer | null = null;
  let lastWriteWasLocked = false;
  // Writes run one after another, so two never use the same temporary file.
  let writesInOrder: Promise<void> = Promise.resolve();

  function scheduleAfter(delayMs: number): void {
    pendingTimer?.cancel();
    pendingTimer = scheduler(() => {
      pendingTimer = null;
      flushNow().catch((error: unknown) => reportError("Could not update the tracker files.", error));
    }, delayMs);
  }

  function flushNow(): Promise<void> {
    pendingTimer?.cancel();
    pendingTimer = null;

    const thisWrite = writesInOrder.then(writeTrackerFiles);
    // The next write must still run if this one failed; the caller of flushNow still sees the failure.
    writesInOrder = thisWrite.catch(() => undefined);
    return thisWrite;
  }

  async function writeTrackerFiles(): Promise<void> {
    const folder = options.getFolder();
    if (folder === null) return;

    const rows = listTrackerRows(options.getDb());
    const csvLocked = await replaceFile(folder, TRACKER_CSV_FILE_NAME, (temporaryPath) =>
      fs.promises.writeFile(temporaryPath, buildCsv(rows)),
    );
    const xlsxLocked = await replaceFile(folder, TRACKER_XLSX_FILE_NAME, (temporaryPath) =>
      buildWorkbook(rows, options.now()).xlsx.writeFile(temporaryPath),
    );

    lastWriteWasLocked = csvLocked || xlsxLocked;
    if (lastWriteWasLocked) scheduleAfter(TRACKER_RETRY_WHEN_LOCKED_MS);
  }

  // Writes the temporary file, then renames it over the real one. Returns true when the real file is locked.
  async function replaceFile(
    folder: PersonFolder,
    fileName: string,
    writeTemporaryFile: (temporaryPath: string) => Promise<void>,
  ): Promise<boolean> {
    await fs.promises.mkdir(folder.root, { recursive: true });
    const targetPath = path.join(folder.root, fileName);
    const temporaryPath = `${targetPath}.tmp`;
    try {
      await writeTemporaryFile(temporaryPath);
      await renameFile(temporaryPath, targetPath);
      return false;
    } catch (error) {
      if (isFileLockedError(error)) return true;
      throw error;
    } finally {
      // After a successful rename there is nothing to remove; after a failed one, no half-written file is left behind.
      await fs.promises.rm(temporaryPath, { force: true });
    }
  }

  return {
    schedule() {
      const folder = options.getFolder();
      if (folder === null) return;
      scheduleAfter(folder.isCloudSynced() ? TRACKER_DEBOUNCE_CLOUD_SYNCED_MS : TRACKER_DEBOUNCE_MS);
    },
    flushNow,
    status() {
      if (options.getFolder() === null) return "off";
      return lastWriteWasLocked ? "locked" : "ok";
    },
  };
}

// On Windows, replacing a file that another program has open fails with EBUSY or EPERM.
function isFileLockedError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "EBUSY" || error.code === "EPERM";
}

// ---------------------------------------------------------------------------------------------
// What goes in the files
// ---------------------------------------------------------------------------------------------

function toCells(row: TrackerRow): TrackerCells {
  return {
    Company: row.company,
    Role: row.role,
    Status: row.status,
    Fit: row.fitScore ?? "",
    Band: row.band ?? "",
    "Resume version": row.resumeShortId ?? "",
    "Applied on": row.appliedAt === null ? "" : formatLocalDay(new Date(row.appliedAt)),
    "Follow up on": row.followUpOn ?? "",
    Posting: row.postingUrl ?? "",
    Folder: row.folder ?? "",
    Updated: formatLocalMinute(new Date(row.updatedAt), ":"),
  };
}

function buildCsv(rows: TrackerRow[]): string {
  const records = rows.map(toCells).map(neutralizeFormulas);
  // header: true writes the column names as the first line, so the file imports cleanly anywhere.
  return stringify(records, { header: true, columns: [...TRACKER_COLUMNS] });
}

// Security: company names and titles come from job postings, which anyone can write. A cell that starts
// with = + - or @ is run as a formula when the CSV is opened in Excel or Google Sheets, so a leading
// apostrophe makes it plain text. (The xlsx stores text as text, so it needs no such guard.)
const FORMULA_STARTS = ["=", "+", "-", "@", "\t", "\r"];

function neutralizeFormulas(cells: TrackerCells): TrackerCells {
  const safeCells = { ...cells };
  for (const column of TRACKER_COLUMNS) {
    const cell = safeCells[column];
    if (typeof cell === "string" && FORMULA_STARTS.some((start) => cell.startsWith(start))) {
      safeCells[column] = `'${cell}`;
    }
  }
  return safeCells;
}

function buildWorkbook(rows: TrackerRow[], writtenAt: Date): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Jobgoblin";
  workbook.created = writtenAt;

  const applications = workbook.addWorksheet("Applications", { views: [{ state: "frozen", ySplit: 1 }] });
  applications.columns = TRACKER_COLUMNS.map((name) => ({ header: name, key: name, width: XLSX_COLUMN_WIDTHS[name] }));
  applications.addRows(rows.map(toCells));
  applications.getRow(1).font = { bold: true };
  applications.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: TRACKER_COLUMNS.length } };

  const readMe = workbook.addWorksheet("Read me");
  readMe.getColumn(1).width = 110;
  const lines = [
    "This tracker is written by Jobgoblin. Make your changes in Jobgoblin, not here.",
    "Changes you type into this spreadsheet are not read back, and the next update replaces them.",
    "Tracker.csv, next to this file, has the same rows for Google Sheets or any other tool.",
    "Dates and times are in your local time.",
    `Last written: ${formatLocalMinute(writtenAt, ":")}`,
  ];
  for (const line of lines) readMe.addRow([line]);
  return workbook;
}
