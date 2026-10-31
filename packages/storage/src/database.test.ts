import { afterEach, describe, expect, it } from "vitest";
import { atomically } from "./database";
import { NestedTransactionError } from "./errors";
import { openTestDatabase, removeTempDirs } from "./testSupport";

afterEach(removeTempDirs);

function countSettings(db: ReturnType<typeof openTestDatabase>): number {
  const row = db.sqlite.prepare("SELECT COUNT(*) AS total FROM settings").get();
  return Number(row?.total);
}

function insertSetting(db: ReturnType<typeof openTestDatabase>, key: string): void {
  db.sqlite.prepare("INSERT INTO settings (key, value) VALUES (?, '1')").run(key);
}

describe("openDatabase", () => {
  it("turns on write-ahead logging and foreign keys", () => {
    const db = openTestDatabase();

    const journalMode = db.sqlite.prepare("PRAGMA journal_mode").get();
    const foreignKeys = db.sqlite.prepare("PRAGMA foreign_keys").get();

    expect(journalMode?.journal_mode).toBe("wal");
    expect(foreignKeys?.foreign_keys).toBe(1);
    db.close();
  });

  it("refuses a row that points at a record that does not exist", () => {
    const db = openTestDatabase();

    const insertOrphan = () =>
      db.sqlite
        .prepare("INSERT INTO answers (application_id, question, answer, saved_at) VALUES ('nobody', 'q', 'a', 't')")
        .run();

    expect(insertOrphan).toThrow(/FOREIGN KEY/);
    db.close();
  });
});

describe("transaction", () => {
  it("keeps every change when the function returns", () => {
    const db = openTestDatabase();

    const result = db.transaction(() => {
      insertSetting(db, "one");
      insertSetting(db, "two");
      return "done";
    });

    expect(result).toBe("done");
    expect(countSettings(db)).toBe(2);
    db.close();
  });

  it("undoes every change when the function throws", () => {
    const db = openTestDatabase();
    insertSetting(db, "before");

    const failingTransaction = () =>
      db.transaction(() => {
        insertSetting(db, "one");
        insertSetting(db, "two");
        throw new Error("something went wrong halfway");
      });

    expect(failingTransaction).toThrow("something went wrong halfway");
    expect(countSettings(db)).toBe(1);
    expect(db.sqlite.isTransaction).toBe(false);
    db.close();
  });

  it("undoes the earlier statements when a later one fails", () => {
    const db = openTestDatabase();

    const insertSameKeyTwice = () =>
      db.transaction(() => {
        insertSetting(db, "same");
        insertSetting(db, "same");
      });

    expect(insertSameKeyTwice).toThrow(/UNIQUE|PRIMARY KEY/);
    expect(countSettings(db)).toBe(0);
    db.close();
  });

  it("throws a clear error when a transaction is opened inside another", () => {
    const db = openTestDatabase();

    const nested = () => db.transaction(() => db.transaction(() => insertSetting(db, "one")));

    expect(nested).toThrow(NestedTransactionError);
    expect(countSettings(db)).toBe(0);
    db.close();
  });

  it("refuses an async function, because COMMIT would run before the function finished", () => {
    const db = openTestDatabase();

    const asyncTransaction = () =>
      db.transaction(async () => {
        insertSetting(db, "one");
      });

    expect(asyncTransaction).toThrow(/synchronous/);
    expect(countSettings(db)).toBe(0);
    db.close();
  });
});

describe("atomically", () => {
  it("starts a transaction when none is open, so a failure undoes everything", () => {
    const db = openTestDatabase();

    const failing = () =>
      atomically(db, () => {
        insertSetting(db, "one");
        throw new Error("stop");
      });

    expect(failing).toThrow("stop");
    expect(countSettings(db)).toBe(0);
    db.close();
  });

  it("joins the caller's transaction when one is open, so the caller decides whether it is kept", () => {
    const db = openTestDatabase();

    const callerFails = () =>
      db.transaction(() => {
        atomically(db, () => insertSetting(db, "inner"));
        throw new Error("the caller gave up");
      });

    expect(callerFails).toThrow("the caller gave up");
    expect(countSettings(db)).toBe(0);
    db.close();
  });
});
