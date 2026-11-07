// Where the audit keeps its evidence. Everything the audit writes goes under AUDIT_DIR, never into the repository.
import fs from "node:fs";
import path from "node:path";

export const AUDIT_DIR =
  process.env.AUDIT_DIR ??
  "<home>\\AppData\\Local\\Temp\\claude\\<project>\\859c954c-890e-44a8-9a2c-82528f47ac4a\\scratchpad\\audit";

// Which repetition of the audit this is. A finding counts as reproduced when two different runs record it.
export const AUDIT_RUN = process.env.AUDIT_RUN ?? "1";

export function auditPath(...parts: string[]): string {
  const full = path.join(AUDIT_DIR, ...parts);
  fs.mkdirSync(path.extname(full) === "" ? full : path.dirname(full), { recursive: true });
  return full;
}
