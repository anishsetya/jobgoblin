// Small helpers shared by the table modules for reading and writing rows.
// node:sqlite hands back plain objects of column values. A table module passes those values to the zod
// schema of the record it is building, which checks them. The helpers here cover the cases a schema
// cannot: JSON columns, BLOB columns, and records that exist only inside this package.
import { randomUUID } from "node:crypto";
import type { SQLInputValue, SQLOutputValue } from "node:sqlite";

// One row as node:sqlite returns it: column name to value.
export type Row = Record<string, SQLOutputValue>;

// Ids are random UUIDs. Callers make them; the table modules never invent an id of their own
// (the one exception is the history event that updateApplicationStatus writes).
export function newId(): string {
  return randomUUID();
}

// A JSON column as a value of unknown shape. The caller passes it straight to a zod schema,
// which is what makes it safe to use.
export function jsonColumn(row: Row, column: string): unknown {
  const text = row[column];
  if (typeof text !== "string") {
    throw new Error(`Column ${column} should hold JSON text.`);
  }
  return JSON.parse(text);
}

export function toJson(value: unknown): string {
  return JSON.stringify(value);
}

// The typed readers below are for records without a zod schema (an upload, a cache entry, a report row).
export function textColumn(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new Error(`Column ${column} should hold text.`);
  return value;
}

export function textOrNullColumn(row: Row, column: string): string | null {
  const value = row[column];
  if (value === null) return null;
  return textColumn(row, column);
}

export function bytesColumn(row: Row, column: string): Uint8Array {
  const value = row[column];
  if (!(value instanceof Uint8Array)) throw new Error(`Column ${column} should hold bytes.`);
  return value;
}

// SQLite has no boolean: a comparison such as (a = b) comes back as 0 or 1.
export function flagColumn(row: Row, column: string): boolean {
  const value = row[column];
  if (value !== 0 && value !== 1) throw new Error(`Column ${column} should hold 0 or 1.`);
  return value === 1;
}

// "?, ?, ?" for an IN (...) list. Only the number of placeholders is built from the input, never the values.
export function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

// A bound pattern that matches `text` anywhere, for: column LIKE ? ESCAPE '\'
// The characters LIKE treats specially (% _ and the escape character) are made literal.
export function containsPattern(text: string): string {
  const escaped = text.replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}

// Builds the "SET column = ?, ..." part of an UPDATE from a closed map of field names to column names.
// Column names come only from `columnFor`, which is written in our own code, never from the caller's data,
// so the caller cannot inject SQL through a key. A field left undefined is not touched; null clears it.
export function buildSetClause<Field extends string>(
  columnFor: Record<Field, string>,
  changes: Partial<Record<Field, SQLInputValue>>,
): { sql: string; params: SQLInputValue[] } {
  const assignments: string[] = [];
  const params: SQLInputValue[] = [];
  for (const field of Object.keys(columnFor) as Field[]) {
    const value = changes[field];
    if (value === undefined) continue;
    assignments.push(`${columnFor[field]} = ?`);
    params.push(value);
  }
  return { sql: assignments.join(", "), params };
}
