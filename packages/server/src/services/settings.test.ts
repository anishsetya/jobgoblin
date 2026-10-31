import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSetting } from "@jobgoblin/storage";
import { backupNow } from "./backups";
import { exportTracker } from "./exports";
import { openPath } from "./openPath";
import { chooseFolder, getSettingsResponse, updateSettings } from "./settings";
import { aScoredApplication, closeTestContexts, createTestContext } from "./testSupport";
import type { DesktopPort } from "./desktopPort";

afterEach(closeTestContexts);

describe("settings", () => {
  it("reports the settings with the folder, tracker state and app data folder", () => {
    const ctx = createTestContext();

    const settings = getSettingsResponse(ctx);

    expect(settings).toMatchObject({
      concurrency: 1,
      maxOpenPerCompany: 3,
      reapplyDays: 90,
      followUpDays: 7,
      setupComplete: true,
      trackerStatus: "ok",
      lastBackupAt: null,
      dataFolder: ctx.appDataDir,
      personFolder: ctx.folder?.root,
    });
  });

  it("changes only the settings that are sent and leaves the others alone", () => {
    const ctx = createTestContext();
    updateSettings(ctx, { maxOpenPerCompany: 5 });

    const settings = updateSettings(ctx, { concurrency: 2 });

    expect(settings).toMatchObject({ concurrency: 2, maxOpenPerCompany: 5, reapplyDays: 90 });
  });

  it("refuses a value that is not allowed", () => {
    const ctx = createTestContext();

    expect(() => updateSettings(ctx, { concurrency: 5 })).toThrowError(expect.objectContaining({ code: "invalid-setting" }));
    expect(() => updateSettings(ctx, { maxOpenPerCompany: "many" })).toThrowError(expect.objectContaining({ code: "invalid-setting" }));
  });

  it("ignores the folder and setup flag: they have their own routes", () => {
    const ctx = createTestContext();
    const folderBefore = getSetting(ctx.db, "personFolder");

    updateSettings(ctx, { personFolder: "C:\\elsewhere", setupComplete: false, usageNoticeSeen: true });

    expect(getSetting(ctx.db, "personFolder")).toBe(folderBefore);
    expect(getSetting(ctx.db, "setupComplete")).toBe(true);
    expect(getSetting(ctx.db, "usageNoticeSeen")).toBe(true);
  });
});

describe("chooseFolder", () => {
  it("creates the folder's layout and starts using it", () => {
    const ctx = createTestContext({ withFolder: false });
    const target = path.join(os.tmpdir(), `jobgoblin-choose-${Date.now()}`);

    try {
      const response = chooseFolder(ctx, target);

      expect(ctx.folder?.root).toBe(path.resolve(target));
      for (const name of ["Applications", "Resumes", "Backups", "Exports"]) {
        expect(fs.existsSync(path.join(target, name))).toBe(true);
      }
      expect(response.settings.personFolder).toBe(path.resolve(target));
      expect(response.backupsFound).toEqual([]);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("offers the backups it finds in a folder from another computer", () => {
    const oldComputer = createTestContext();
    const backup = backupNow(oldComputer);
    const newComputer = createTestContext({ withFolder: false, withAlexRivera: false });

    const response = chooseFolder(newComputer, oldComputer.folder?.root ?? "");

    expect(response.backupsFound.map((candidate) => candidate.id)).toEqual([backup.id]);
  });

  it("refuses a folder that is not a full path", () => {
    const ctx = createTestContext({ withFolder: false });

    expect(() => chooseFolder(ctx, "Documents\\Jobgoblin")).toThrowError(expect.objectContaining({ code: "folder-not-absolute" }));
  });

  it("refuses the folder where Jobgoblin keeps its own working files, or one that contains it", () => {
    const ctx = createTestContext({ withFolder: false });

    expect(() => chooseFolder(ctx, ctx.appDataDir)).toThrowError(expect.objectContaining({ code: "folder-holds-app-data" }));
    expect(() => chooseFolder(ctx, path.dirname(ctx.appDataDir))).toThrowError(expect.objectContaining({ code: "folder-holds-app-data" }));
  });
});

describe("exportTracker", () => {
  it("writes the tracker now and returns the CSV with its header first", async () => {
    const ctx = createTestContext();
    aScoredApplication(ctx);

    const file = await exportTracker(ctx, "csv");

    const text = Buffer.from(file.bytes).toString("utf8");
    expect(text.split("\n")[0]).toContain("Company,Role,Status");
    expect(text).toContain("Backend Engineer");
    expect(file.contentType).toContain("text/csv");
  });

  it("returns the spreadsheet as a workbook", async () => {
    const ctx = createTestContext();

    const file = await exportTracker(ctx, "xlsx");

    // An .xlsx file is a zip, which starts with "PK".
    expect(Buffer.from(file.bytes.slice(0, 2)).toString("latin1")).toBe("PK");
  });

  it("needs the person's folder", async () => {
    const ctx = createTestContext({ withFolder: false });

    await expect(exportTracker(ctx, "csv")).rejects.toMatchObject({ code: "no-person-folder" });
  });
});

describe("openPath", () => {
  function fakeDesktop(): DesktopPort & { messages: unknown[] } {
    const messages: unknown[] = [];
    return { messages, postMessage: (message) => messages.push(message), on: () => undefined };
  }

  it("only says where the file is when there is no desktop app", () => {
    const ctx = createTestContext();

    const result = openPath(ctx, "Applications", null);

    expect(result).toEqual({ opened: false, path: path.join(ctx.folder?.root ?? "", "Applications") });
  });

  it("asks the desktop app to open it, naming the person's folder", () => {
    const ctx = createTestContext();
    const desktop = fakeDesktop();

    const result = openPath(ctx, path.join(ctx.folder?.root ?? "", "Resumes"), desktop);

    expect(result.opened).toBe(true);
    expect(desktop.messages).toEqual([{ type: "open-path", path: result.path, personFolder: ctx.folder?.root }]);
  });

  it("refuses a path outside the person's folder", () => {
    const ctx = createTestContext();
    const desktop = fakeDesktop();

    expect(() => openPath(ctx, "..\\..\\Windows", desktop)).toThrowError(expect.objectContaining({ code: "path-outside-folder" }));
    expect(() => openPath(ctx, ctx.appDataDir, desktop)).toThrowError(expect.objectContaining({ code: "path-outside-folder" }));
    expect(desktop.messages).toEqual([]);
  });

  it("says plainly when the file does not exist", () => {
    const ctx = createTestContext();

    expect(() => openPath(ctx, "Applications\\Missing.pdf", null)).toThrowError(expect.objectContaining({ code: "not-found" }));
  });
});
