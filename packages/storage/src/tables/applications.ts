// Table `applications`: one row per job being pursued, and the one function that changes its status.
// The status CHECK in the migration lists the 20 states; packages/core decides which moves are allowed.
// Lists for screens (Pipeline, follow-ups, the tracker) are in applicationQueries.ts.
// Spec: ARCHITECTURE.md sections 5.7 and 7 (updateApplicationStatus).
import {
  Application,
  ApplicationStatus,
  type Actor,
  type HistoryEventType,
} from "@jobgoblin/schemas";
import { atomically, type Database } from "../database";
import { StaleStatusError } from "../errors";
import { buildSetClause, newId, placeholders, textColumn, textOrNullColumn, type Row } from "../rows";
import { insertHistoryEvent } from "./historyEvents";

// The columns of an applications row under the names of the Application schema. Also used by the
// Pipeline query, whose rows carry these columns plus a few more.
export function applicationFieldsFromRow(row: Row) {
  return {
    id: row.id,
    jobId: row.job_id,
    company: row.company,
    title: row.title,
    status: row.status,
    fitScore: row.fit_score,
    band: row.band,
    resumeVersion: row.resume_version,
    submitMode: row.submit_mode,
    folder: row.folder,
    appliedAt: row.applied_at,
    followUpOn: row.follow_up_on,
    tailorAttempts: row.tailor_attempts,
    tailorError: row.tailor_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toApplication(row: Row): Application {
  return Application.parse(applicationFieldsFromRow(row));
}

export function insertApplication(db: Database, application: Application): void {
  const valid = Application.parse(application);
  db.sqlite
    .prepare(
      `INSERT INTO applications (id, job_id, company, title, status, fit_score, band, resume_version, submit_mode,
                                 folder, applied_at, follow_up_on, tailor_attempts, tailor_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      valid.id, valid.jobId, valid.company, valid.title, valid.status, valid.fitScore, valid.band,
      valid.resumeVersion, valid.submitMode, valid.folder, valid.appliedAt, valid.followUpOn,
      valid.tailorAttempts, valid.tailorError, valid.createdAt, valid.updatedAt,
    );
}

export function getApplication(db: Database, id: string): Application | null {
  const row = db.sqlite.prepare("SELECT * FROM applications WHERE id = ?").get(id);
  return row === undefined ? null : toApplication(row);
}

// The newest application for a job. A job can have more than one only when the person applies again
// after the reapply window.
export function getApplicationByJobId(db: Database, jobId: string): Application | null {
  const row = db.sqlite
    .prepare("SELECT * FROM applications WHERE job_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(jobId);
  return row === undefined ? null : toApplication(row);
}

// Applications in any of the given statuses, oldest first (the order work is picked up in).
export function listApplicationsByStatus(db: Database, statuses: readonly ApplicationStatus[]): Application[] {
  if (statuses.length === 0) return [];
  const rows = db.sqlite
    .prepare(`SELECT * FROM applications WHERE status IN (${placeholders(statuses)}) ORDER BY created_at, rowid`)
    .all(...statuses);
  return rows.map(toApplication);
}

// Every application at a company, whatever the capitalisation ("Acme" and "ACME" are one company).
export function listApplicationsByCompany(db: Database, company: string): Application[] {
  const rows = db.sqlite
    .prepare("SELECT * FROM applications WHERE company = ? COLLATE NOCASE ORDER BY created_at, rowid")
    .all(company);
  return rows.map(toApplication);
}

// What packages/core's checkLimits needs to apply the per-company cap and the reapply rule: the other
// applications at the same company, and the other applications for the same role (same dedupe key).
export type LimitCandidate = {
  id: string;
  company: string;
  dedupeKey: string;
  status: ApplicationStatus;
  appliedAt: string | null;
};

export function listLimitCandidates(db: Database, input: { company: string; dedupeKey: string }): LimitCandidate[] {
  const rows = db.sqlite
    .prepare(
      `SELECT a.id, a.company, j.dedupe_key, a.status, a.applied_at
       FROM applications a JOIN jobs j ON j.job_id = a.job_id
       WHERE a.company = ? COLLATE NOCASE OR j.dedupe_key = ?`,
    )
    .all(input.company, input.dedupeKey);
  return rows.map((row) => ({
    id: textColumn(row, "id"),
    company: textColumn(row, "company"),
    dedupeKey: textColumn(row, "dedupe_key"),
    status: ApplicationStatus.parse(row.status),
    appliedAt: textOrNullColumn(row, "applied_at"),
  }));
}

// A count for every status, including the ones with no applications (get_pipeline reports all 20).
export function countApplicationsByStatus(db: Database): Record<ApplicationStatus, number> {
  const rows = db.sqlite.prepare("SELECT status, COUNT(*) AS total FROM applications GROUP BY status").all();
  const totalByStatus = new Map<string, number>();
  for (const row of rows) totalByStatus.set(String(row.status), Number(row.total));

  const counts = {} as Record<ApplicationStatus, number>; // every key is filled in just below
  for (const status of ApplicationStatus.options) counts[status] = totalByStatus.get(status) ?? 0;
  return counts;
}

export function countApplicationsCreatedSince(db: Database, since: string): number {
  const row = db.sqlite.prepare("SELECT COUNT(*) AS total FROM applications WHERE created_at >= ?").get(since);
  return Number(row?.total ?? 0);
}

// ---------------------------------------------------------------------------------------------
// Changing an application
// ---------------------------------------------------------------------------------------------

// The fields besides status that change over an application's life. The column names are a closed list
// written here, so no caller-supplied key ever becomes part of the SQL (see buildSetClause).
const COLUMN_FOR_FIELD = {
  fitScore: "fit_score",
  band: "band",
  resumeVersion: "resume_version",
  submitMode: "submit_mode",
  folder: "folder",
  appliedAt: "applied_at",
  followUpOn: "follow_up_on",
  tailorAttempts: "tailor_attempts",
  tailorError: "tailor_error",
} as const;

const ApplicationFieldChanges = Application.pick({
  fitScore: true,
  band: true,
  resumeVersion: true,
  submitMode: true,
  folder: true,
  appliedAt: true,
  followUpOn: true,
  tailorAttempts: true,
  tailorError: true,
}).partial();
export type ApplicationFieldChanges = ReturnType<typeof ApplicationFieldChanges.parse>;

// Sets the given fields (leave a field out to keep it; pass null to clear it) and stamps updated_at.
// This never touches status: that goes through updateApplicationStatus so every move is logged.
// Returns the updated application, or null when there is no such application.
export function updateApplicationFields(
  db: Database,
  applicationId: string,
  changes: ApplicationFieldChanges,
  updatedAt: string,
): Application | null {
  const validChanges = ApplicationFieldChanges.parse(changes);
  const { sql, params } = buildSetClause(COLUMN_FOR_FIELD, validChanges);
  const assignments = sql === "" ? "updated_at = ?" : `${sql}, updated_at = ?`;
  db.sqlite.prepare(`UPDATE applications SET ${assignments} WHERE id = ?`).run(...params, updatedAt, applicationId);
  return getApplication(db, applicationId);
}

export type StatusChange = {
  applicationId: string;
  from: ApplicationStatus; // the status the caller believes the application is in
  to: ApplicationStatus;
  actor: Actor;
  type: HistoryEventType; // what the history shows: usually "status-changed", or "approved", "submitted", ...
  detail?: string | null;
  at: string; // when it happened (ISO timestamp), used for updated_at and for the history event
};

// Moves an application from one status to another and logs it, all or nothing.
// The UPDATE only matches while the status is still `from`: if someone moved it first, nothing changes and
// StaleStatusError is thrown. This does not decide whether the move is allowed: the caller has already
// called core.assertTransition (ARCHITECTURE.md section 7).
export function updateApplicationStatus(db: Database, change: StatusChange): void {
  atomically(db, () => {
    const result = db.sqlite
      .prepare("UPDATE applications SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
      .run(change.to, change.at, change.applicationId, change.from);
    if (result.changes === 0) {
      throw new StaleStatusError(change.applicationId, change.from, readStatus(db, change.applicationId));
    }

    insertHistoryEvent(db, {
      id: newId(),
      ts: change.at,
      actor: change.actor,
      applicationId: change.applicationId,
      type: change.type,
      from: change.from,
      to: change.to,
      detail: change.detail ?? null,
    });
  });
}

function readStatus(db: Database, applicationId: string): string | null {
  const row = db.sqlite.prepare("SELECT status FROM applications WHERE id = ?").get(applicationId);
  return row === undefined ? null : textColumn(row, "status");
}
