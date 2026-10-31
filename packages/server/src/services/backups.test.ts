import { afterEach, describe, expect, it } from "vitest";
import { getRun, getSetting, listStoryItems, updateRun } from "@jobgoblin/storage";
import { backupNow, listBackups, restoreBackup } from "./backups";
import { startHunt } from "./runs";
import { addStoryItem } from "./story";
import { closeTestContexts, createTestContext } from "./testSupport";

afterEach(closeTestContexts);

const SKILL = { kind: "skill" as const, parentId: null, data: { text: "Elixir", tools: [], numbers: [] }, keywords: [] };

describe("backups", () => {
  it("makes a backup in the person's folder and lists it", () => {
    const ctx = createTestContext();

    const backup = backupNow(ctx);

    expect(listBackups(ctx).map((candidate) => candidate.id)).toEqual([backup.id]);
    expect(backup.sizeBytes).toBeGreaterThan(0);
  });

  it("needs the person's folder", () => {
    const ctx = createTestContext({ withFolder: false });

    expect(() => backupNow(ctx)).toThrowError(expect.objectContaining({ code: "no-person-folder" }));
  });

  it("emits backup.done when a backup is made", () => {
    const ctx = createTestContext();
    const types: string[] = [];
    ctx.bus.subscribe((event) => types.push(event.type));

    backupNow(ctx);

    expect(types).toContain("backup.done");
  });
});

describe("restoreBackup", () => {
  it("swaps the server's database for the backup and keeps this computer's folder", () => {
    const ctx = createTestContext();
    const backup = backupNow(ctx);
    const databaseBefore = ctx.db;
    const folderBefore = ctx.folder;
    addStoryItem(ctx, SKILL);
    expect(listStoryItems(ctx.db).some((item) => item.data.text === "Elixir")).toBe(true);

    const settings = restoreBackup(ctx, backup.id);

    expect(ctx.db).not.toBe(databaseBefore);
    expect(ctx.db.sqlite.isOpen).toBe(true);
    expect(listStoryItems(ctx.db).some((item) => item.data.text === "Elixir")).toBe(false);
    expect(ctx.folder).toBe(folderBefore);
    expect(settings.personFolder).toBe(folderBefore?.root);
    expect(getSetting(ctx.db, "personFolder")).toBe(folderBefore?.root);
  });

  it("makes a safety backup of the current data first", () => {
    const ctx = createTestContext();
    const backup = backupNow(ctx);
    addStoryItem(ctx, SKILL);

    restoreBackup(ctx, backup.id);

    expect(listBackups(ctx).length).toBe(2);
  });

  it("refuses a name that is not a backup", () => {
    const ctx = createTestContext();

    expect(() => restoreBackup(ctx, "..\\..\\evil.db")).toThrowError(expect.objectContaining({ code: "invalid-backup-id" }));
    expect(ctx.db.sqlite.isOpen).toBe(true);
  });

  it("marks a run the backup remembers as running as interrupted, because no process is behind it", () => {
    const ctx = createTestContext();
    const run = startHunt(ctx);
    updateRun(ctx.db, run.id, { status: "running" });
    const backup = backupNow(ctx);
    updateRun(ctx.db, run.id, { status: "done" });

    restoreBackup(ctx, backup.id);

    expect(getRun(ctx.db, run.id)).toMatchObject({ status: "interrupted", pid: null });
  });

  it("waits while a run is working with the data", () => {
    const ctx = createTestContext();
    const backup = backupNow(ctx);
    const run = startHunt(ctx);
    updateRun(ctx.db, run.id, { status: "running" });

    expect(() => restoreBackup(ctx, backup.id)).toThrowError(expect.objectContaining({ code: "runs-active" }));
  });
});
