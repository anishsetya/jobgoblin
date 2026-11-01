// Table `master_resume`: the default one-page resume, a selection from Your story made when setup finishes.
// Review compares every tailored resume against it. There is at most one row.
// Spec: ARCHITECTURE.md sections 6 (buildMasterResume, decision D7) and 7.
import { ResumeBody } from "@jobgoblin/schemas";
import type { Database } from "../database";
import { jsonColumn, toJson } from "../rows";

export type MasterResume = { body: ResumeBody; updatedAt: string };

export function getMasterResume(db: Database): MasterResume | null {
  const row = db.sqlite.prepare("SELECT body, updated_at FROM master_resume WHERE id = 1").get();
  if (row === undefined) return null;
  return { body: ResumeBody.parse(jsonColumn(row, "body")), updatedAt: String(row.updated_at) };
}

export function saveMasterResume(db: Database, body: ResumeBody, updatedAt: string): void {
  const validBody = ResumeBody.parse(body);
  db.sqlite
    .prepare(
      `INSERT INTO master_resume (id, body, updated_at) VALUES (1, ?, ?)
       ON CONFLICT (id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
    )
    .run(toJson(validBody), updatedAt);
}
