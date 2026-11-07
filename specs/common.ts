// Small helpers shared by the audit journeys: copying evidence out of a person's folder before the temp folders
// go away, and reading a folder as a tree.
import fs from "node:fs";
import path from "node:path";
import { auditPath } from "./paths";

export function listTree(root: string, depth = 6): string[] {
  const lines: string[] = [];
  function walk(folder: string, prefix: string, level: number): void {
    if (level > depth || !fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      const size = entry.isFile() ? ` (${fs.statSync(full).size} bytes)` : "";
      lines.push(`${prefix}${entry.name}${entry.isDirectory() ? "/" : size}`);
      if (entry.isDirectory()) walk(full, `${prefix}  `, level + 1);
    }
  }
  walk(root, "", 0);
  return lines;
}

// Copies a file (not a folder) into AUDIT_DIR/<relative>, returns the new path, or null when it does not exist.
export function copyEvidence(source: string, relative: string): string | null {
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return null;
  const target = auditPath(relative);
  fs.copyFileSync(source, target);
  return target;
}

export function writeEvidence(relative: string, body: string | object): string {
  const target = auditPath(relative);
  fs.writeFileSync(target, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  return target;
}

export function findFiles(root: string, predicate: (file: string) => boolean): string[] {
  const found: string[] = [];
  function walk(folder: string): void {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (predicate(full)) found.push(full);
    }
  }
  walk(root);
  return found;
}

// Yesterday's, today's or tomorrow's local calendar day as YYYY-MM-DD, like the server's own days.
export function localDayPlus(days: number): string {
  const day = new Date();
  day.setDate(day.getDate() + days);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}
