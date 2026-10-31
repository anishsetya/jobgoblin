// Table `uploads`: the resume and LinkedIn PDF the person gave in setup, kept as text with the contact
// details already removed by code (decision D10). The original file is never stored.
// Spec: ARCHITECTURE.md section 7.
import { UploadKind } from "@jobgoblin/schemas";
import type { Database } from "../database";
import { textColumn, type Row } from "../rows";

export type Upload = {
  id: string;
  kind: UploadKind;
  fileName: string;
  redactedText: string;
  uploadedAt: string;
};

function toUpload(row: Row): Upload {
  return {
    id: textColumn(row, "id"),
    kind: UploadKind.parse(row.kind),
    fileName: textColumn(row, "file_name"),
    redactedText: textColumn(row, "redacted_text"),
    uploadedAt: textColumn(row, "uploaded_at"),
  };
}

export function insertUpload(db: Database, upload: Upload): void {
  db.sqlite
    .prepare("INSERT INTO uploads (id, kind, file_name, redacted_text, uploaded_at) VALUES (?, ?, ?, ?, ?)")
    .run(upload.id, upload.kind, upload.fileName, upload.redactedText, upload.uploadedAt);
}

// Every upload, oldest first.
export function listUploads(db: Database): Upload[] {
  const rows = db.sqlite.prepare("SELECT * FROM uploads ORDER BY uploaded_at, rowid").all();
  return rows.map(toUpload);
}

// The newest upload of each kind: what the setup run reads, so a second upload replaces the first.
export function listLatestUploads(db: Database): Upload[] {
  const newestOfEachKind = new Map<UploadKind, Upload>();
  for (const upload of listUploads(db)) {
    // The list is oldest first, so a later upload overwrites an earlier one of the same kind.
    newestOfEachKind.set(upload.kind, upload);
  }
  return [...newestOfEachKind.values()];
}
