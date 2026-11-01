import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPersonFolder } from "./personFolder";
import { insertResumeVersionIfNew } from "./tables/resumes";
import {
  aResumeVersion,
  anApplicationInDatabase,
  createFakeScheduler,
  makeTempDir,
  openTestDatabase,
  removeTempDirs,
  TEST_NOW,
} from "./testSupport";
import { createTrackerExporter, TRACKER_COLUMNS } from "./tracker";

afterEach(removeTempDirs);

const HEADER_LINE = "Company,Role,Status,Fit,Band,Resume version,Applied on,Follow up on,Posting,Folder,Updated";

function fileError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: the file is in use`), { code });
}

// A database with one applied application, a person's folder, and an exporter that uses a fake timer.
function setUp(options: { folderRoot?: string; renameFile?: (from: string, to: string) => Promise<void> } = {}) {
  const db = openTestDatabase();
  insertResumeVersionIfNew(db, aResumeVersion());
  anApplicationInDatabase(db, {
    status: "Applied",
    fitScore: 82,
    band: "apply",
    resumeVersion: aResumeVersion().versionId,
    appliedAt: "2026-11-01T09:00:00.000Z",
    followUpOn: "2026-11-08",
    folder: "Applications/2026-11-01 Acme Cloud - Backend Engineer",
  });
  const folder = createPersonFolder(options.folderRoot ?? path.join(makeTempDir(), "Jobgoblin"));
  const timers = createFakeScheduler();
  const reportError = vi.fn();
  const exporter = createTrackerExporter({
    getDb: () => db,
    getFolder: () => folder,
    now: () => TEST_NOW,
    scheduler: timers.scheduler,
    renameFile: options.renameFile,
    reportError,
  });
  return { db, folder, timers, reportError, exporter };
}

const csvPath = (root: string) => path.join(root, "Tracker.csv");
const xlsxPath = (root: string) => path.join(root, "Tracker.xlsx");

describe("Tracker.csv", () => {
  it("starts with the header line and holds every column", async () => {
    const { folder, exporter } = setUp();

    await exporter.flushNow();

    const csv = fs.readFileSync(csvPath(folder.root), "utf8");
    expect(csv.startsWith(`${HEADER_LINE}\n`)).toBe(true);
    expect(csv.split("\n")[0]?.split(",")).toEqual([...TRACKER_COLUMNS]);
  });

  it("has a row for each application with the posting link and the short resume id", async () => {
    const { folder, exporter } = setUp();

    await exporter.flushNow();

    const rows = fs.readFileSync(csvPath(folder.root), "utf8").trim().split("\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain("Acme Cloud,Backend Engineer,Applied,82,apply,r-aaaaaaaa");
    expect(rows[1]).toContain("2026-11-08,https://boards.example.com/acmecloud/jobs/4012345");
  });

  it("is just the header when there are no applications yet", async () => {
    const { db, folder, exporter } = setUp();
    db.sqlite.exec("DELETE FROM applications");

    await exporter.flushNow();

    expect(fs.readFileSync(csvPath(folder.root), "utf8")).toBe(`${HEADER_LINE}\n`);
  });

  it("makes a job title that looks like a formula into plain text", async () => {
    const { db, folder, exporter } = setUp();
    db.sqlite.prepare("UPDATE applications SET title = ?").run('=HYPERLINK("http://evil.example","Click")');

    await exporter.flushNow();

    const csv = fs.readFileSync(csvPath(folder.root), "utf8");
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""Click"")"`);
  });
});

describe("Tracker.xlsx", () => {
  it("has an Applications sheet with the same columns and rows, and a Read me sheet", async () => {
    const { folder, exporter } = setUp();

    await exporter.flushNow();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(xlsxPath(folder.root));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Applications", "Read me"]);

    const applications = workbook.getWorksheet("Applications");
    const header = (applications?.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual([...TRACKER_COLUMNS]);
    expect(applications?.getRow(2).getCell(1).value).toBe("Acme Cloud");
    expect(applications?.getRow(2).getCell(4).value).toBe(82);

    const readMeText = workbook.getWorksheet("Read me")?.getRow(1).getCell(1).value;
    expect(String(readMeText)).toContain("Make your changes in Jobgoblin");
  });

  it("keeps a formula-looking title as text, not a formula", async () => {
    const { db, folder, exporter } = setUp();
    db.sqlite.prepare("UPDATE applications SET title = ?").run("=1+1");

    await exporter.flushNow();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(xlsxPath(folder.root));
    expect(workbook.getWorksheet("Applications")?.getRow(2).getCell(2).value).toBe("=1+1");
  });
});

describe("writing safely", () => {
  it("leaves no temporary file behind", async () => {
    const { folder, exporter } = setUp();

    await exporter.flushNow();

    expect(fs.readdirSync(folder.root).sort()).toEqual(["Tracker.csv", "Tracker.xlsx"]);
  });

  it("reports that it is off, and writes nothing, until a folder is chosen", async () => {
    const db = openTestDatabase();
    const exporter = createTrackerExporter({ getDb: () => db, getFolder: () => null, now: () => TEST_NOW });

    await exporter.flushNow();
    exporter.schedule();

    expect(exporter.status()).toBe("off");
    db.close();
  });
});

describe("when the file is open in Excel", () => {
  it.each(["EBUSY", "EPERM"])("reports the tracker as locked on %s, retries in 30 seconds, then recovers", async (code) => {
    let excelHasTheFileOpen = true;
    const renameFile = async (from: string, to: string) => {
      if (excelHasTheFileOpen) throw fileError(code);
      await fs.promises.rename(from, to);
    };
    const { folder, timers, exporter } = setUp({ renameFile });

    await exporter.flushNow();

    expect(exporter.status()).toBe("locked");
    expect(timers.pendingDelays()).toEqual([30_000]);
    expect(fs.readdirSync(folder.root)).toEqual([]); // no half-written temporary file either

    excelHasTheFileOpen = false;
    timers.runNext(); // the retry
    await exporter.flushNow(); // waits for the retry to finish, then writes again

    expect(exporter.status()).toBe("ok");
    expect(fs.readFileSync(csvPath(folder.root), "utf8").startsWith(HEADER_LINE)).toBe(true);
    expect(fs.existsSync(xlsxPath(folder.root))).toBe(true);
  });

  it("does not hide other failures: flushNow rejects when the disk refuses", async () => {
    const renameFile = async () => {
      throw fileError("EACCES");
    };
    const { exporter } = setUp({ renameFile });

    await expect(exporter.flushNow()).rejects.toThrow("EACCES");
    expect(exporter.status()).toBe("ok");
  });
});

describe("schedule", () => {
  it("waits 2 seconds, and one timer covers a burst of changes", () => {
    const { timers, exporter } = setUp();

    exporter.schedule();
    exporter.schedule();
    exporter.schedule();

    expect(timers.pendingDelays()).toEqual([2_000]);
  });

  it("waits 60 seconds when the folder is one Google Drive, OneDrive, Dropbox or iCloud syncs", () => {
    const syncedRoot = path.join(makeTempDir(), "Google Drive", "Jobgoblin");
    const { timers, exporter } = setUp({ folderRoot: syncedRoot });

    exporter.schedule();

    expect(timers.pendingDelays()).toEqual([60_000]);
  });

  it("writes the files when the timer fires", async () => {
    const { folder, timers, exporter } = setUp();
    exporter.schedule();

    timers.runNext();
    await exporter.flushNow();

    expect(fs.existsSync(csvPath(folder.root))).toBe(true);
  });

  it("reports a failure in the background instead of swallowing it", async () => {
    const renameFile = async () => {
      throw fileError("EACCES");
    };
    const { timers, reportError, exporter } = setUp({ renameFile });
    exporter.schedule();

    timers.runNext();

    await vi.waitFor(() => expect(reportError).toHaveBeenCalledTimes(1));
    expect(reportError.mock.calls[0]?.[0]).toBe("Could not update the tracker files.");
  });
});
