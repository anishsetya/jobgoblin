// The Database handle: a node:sqlite connection plus the one way to run a transaction.
// Only this package imports node:sqlite (dependency rule), so every other package works through it.
// Spec: ARCHITECTURE.md section 7 ("WAL mode and foreign keys on; BEGIN IMMEDIATE ... COMMIT").
import type { DatabaseSync } from "node:sqlite";
import { NestedTransactionError } from "./errors";

export interface Database {
  // The raw connection, for the table modules. Prepare statements with db.sqlite.prepare(sql).
  sqlite: DatabaseSync;
  // Where the database file lives. Backups copy it and restore replaces it.
  path: string;
  // Runs fn as one all-or-nothing change. fn must be synchronous: do async work (rendering, fetching)
  // before or after, never inside.
  transaction<T>(fn: () => T): T;
  close(): void;
}

export function createDatabase(sqlite: DatabaseSync, path: string): Database {
  return {
    sqlite,
    path,
    transaction: (fn) => runInTransaction(sqlite, fn),
    close: () => sqlite.close(),
  };
}

function runInTransaction<T>(sqlite: DatabaseSync, fn: () => T): T {
  // sqlite.isTransaction is true whenever a BEGIN is open, including one started by raw SQL.
  if (sqlite.isTransaction) throw new NestedTransactionError();

  // IMMEDIATE takes the write lock now, so a transaction that will write never fails halfway
  // because another connection got in first.
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    refuseAsyncResult(result);
    sqlite.exec("COMMIT");
    return result;
  } catch (error) {
    // An error such as a full disk may already have rolled the transaction back, so ask first.
    if (sqlite.isTransaction) sqlite.exec("ROLLBACK");
    throw error;
  }
}

// An async function returns a promise at its first await, and COMMIT would run before the rest of it did.
// That is a silent data bug, so refuse it loudly.
function refuseAsyncResult(result: unknown): void {
  if (result instanceof Promise) {
    throw new TypeError("db.transaction() needs a synchronous function. Do async work before or after the transaction.");
  }
}

// Runs fn inside a transaction: joins the one that is already open, or starts one if none is.
// Table functions that change several rows use this, so they are all-or-nothing when called on their own
// and part of the caller's transaction when called inside one.
export function atomically<T>(db: Database, fn: () => T): T {
  if (db.sqlite.isTransaction) return fn();
  return db.transaction(fn);
}
