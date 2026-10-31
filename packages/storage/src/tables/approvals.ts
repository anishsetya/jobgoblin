// Table `approvals`: the person's approval of one exact data sheet and one exact resume file.
// An approval is "live" until it is used (the application reached Applied) or voided (the data sheet or
// the resume changed). The database allows at most one live approval per application.
// Spec: ARCHITECTURE.md sections 5.7, 8.5 and 8.6.
import { Approval } from "@jobgoblin/schemas";
import type { Database } from "../database";
import { jsonColumn, toJson, type Row } from "../rows";

function toApproval(row: Row): Approval {
  return Approval.parse({
    id: row.id,
    applicationId: row.application_id,
    dataSheet: jsonColumn(row, "data_sheet"),
    dataSheetHash: row.data_sheet_hash,
    resumeVersion: row.resume_version,
    pdfSha256: row.pdf_sha256,
    submitMode: row.submit_mode,
    approvedAt: row.approved_at,
    usedAt: row.used_at,
    voidedAt: row.voided_at,
  });
}

// Void or use the application's earlier live approval first: a second live one is refused.
export function insertApproval(db: Database, approval: Approval): void {
  const valid = Approval.parse(approval);
  db.sqlite
    .prepare(
      `INSERT INTO approvals (id, application_id, data_sheet, data_sheet_hash, resume_version, pdf_sha256,
                              submit_mode, approved_at, used_at, voided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      valid.id, valid.applicationId, toJson(valid.dataSheet), valid.dataSheetHash, valid.resumeVersion,
      valid.pdfSha256, valid.submitMode, valid.approvedAt, valid.usedAt, valid.voidedAt,
    );
}

export function getApproval(db: Database, id: string): Approval | null {
  const row = db.sqlite.prepare("SELECT * FROM approvals WHERE id = ?").get(id);
  return row === undefined ? null : toApproval(row);
}

// The approval that still counts for this application, if any.
export function getLiveApproval(db: Database, applicationId: string): Approval | null {
  const row = db.sqlite
    .prepare("SELECT * FROM approvals WHERE application_id = ? AND used_at IS NULL AND voided_at IS NULL")
    .get(applicationId);
  return row === undefined ? null : toApproval(row);
}

// The approval the Open application screen shows: the live one if there is one, otherwise the newest
// (used or voided), so the screen can say why it no longer counts.
export function getLatestApproval(db: Database, applicationId: string): Approval | null {
  const row = db.sqlite
    .prepare("SELECT * FROM approvals WHERE application_id = ? ORDER BY approved_at DESC, rowid DESC LIMIT 1")
    .get(applicationId);
  return row === undefined ? null : toApproval(row);
}

// Every live approval. When the profile changes, the server checks each one against the new data sheet.
export function listLiveApprovals(db: Database): Approval[] {
  const rows = db.sqlite
    .prepare("SELECT * FROM approvals WHERE used_at IS NULL AND voided_at IS NULL ORDER BY approved_at, rowid")
    .all();
  return rows.map(toApproval);
}

// Marks a live approval as used up. Returns false when it was not live, so a used or voided approval
// can never be used again.
export function markApprovalUsed(db: Database, id: string, usedAt: string): boolean {
  const result = db.sqlite
    .prepare("UPDATE approvals SET used_at = ? WHERE id = ? AND used_at IS NULL AND voided_at IS NULL")
    .run(usedAt, id);
  return result.changes === 1;
}

// Marks a live approval as void. Returns false when it was not live.
export function voidApproval(db: Database, id: string, voidedAt: string): boolean {
  const result = db.sqlite
    .prepare("UPDATE approvals SET voided_at = ? WHERE id = ? AND used_at IS NULL AND voided_at IS NULL")
    .run(voidedAt, id);
  return result.changes === 1;
}
