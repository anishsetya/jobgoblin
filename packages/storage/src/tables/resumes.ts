// Tables `resume_versions` and `application_resumes`: the content of each resume (shared) and each
// application's use of it (decision D18). An approved use also keeps the exact PDF bytes (decision D19),
// so the approved file can always be written again, byte for byte.
// Spec: ARCHITECTURE.md sections 5.6 and 7.
import { ApplicationResume, ResumeVersion } from "@jobgoblin/schemas";
import { atomically, type Database } from "../database";
import { ApprovedFileConflictError, RecordNotFoundError, StorageError } from "../errors";
import { sha256OfBytes } from "../hash";
import { bytesColumn, flagColumn, jsonColumn, textColumn, textOrNullColumn, toJson, type Row } from "../rows";

// ---------------------------------------------------------------------------------------------
// Versions: the content of a resume
// ---------------------------------------------------------------------------------------------

function toResumeVersion(row: Row): ResumeVersion {
  return ResumeVersion.parse({
    versionId: row.version_id,
    shortId: row.short_id,
    body: jsonColumn(row, "body"),
    headerHash: row.header_hash,
    templateVersion: row.template_version,
    createdAt: row.created_at,
  });
}

// Stores the version unless that exact version id exists already (the id is a hash of the content, so
// the same id means the same resume). Returns true when it was new.
// A different version with the same short id is refused by the database: pick a longer short id.
export function insertResumeVersionIfNew(db: Database, version: ResumeVersion): boolean {
  const valid = ResumeVersion.parse(version);
  const result = db.sqlite
    .prepare(
      `INSERT INTO resume_versions (version_id, short_id, body, header_hash, template_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (version_id) DO NOTHING`,
    )
    .run(valid.versionId, valid.shortId, toJson(valid.body), valid.headerHash, valid.templateVersion, valid.createdAt);
  return result.changes === 1;
}

export function getResumeVersion(db: Database, versionId: string): ResumeVersion | null {
  const row = db.sqlite.prepare("SELECT * FROM resume_versions WHERE version_id = ?").get(versionId);
  return row === undefined ? null : toResumeVersion(row);
}

// Used to check whether a short id is already taken before choosing one for a new version.
export function getResumeVersionByShortId(db: Database, shortId: string): ResumeVersion | null {
  const row = db.sqlite.prepare("SELECT * FROM resume_versions WHERE short_id = ?").get(shortId);
  return row === undefined ? null : toResumeVersion(row);
}

// ---------------------------------------------------------------------------------------------
// Application resumes: one application's use of one version
// ---------------------------------------------------------------------------------------------

const APPLICATION_RESUME_SELECT = `
  SELECT ar.application_id, ar.version_id, rv.short_id, ar.state, ar.pdf_sha256, ar.created_at
  FROM application_resumes ar JOIN resume_versions rv ON rv.version_id = ar.version_id`;

function toApplicationResume(row: Row): ApplicationResume {
  return ApplicationResume.parse({
    applicationId: row.application_id,
    versionId: row.version_id,
    shortId: row.short_id,
    state: row.state,
    pdfSha256: row.pdf_sha256,
    createdAt: row.created_at,
  });
}

// Records that the application uses this version, as a draft. Does nothing if it already does, so
// submitting the same draft twice keeps the first row (and never turns an approved resume back into a draft).
export function insertApplicationResumeIfNew(
  db: Database,
  input: { applicationId: string; versionId: string; createdAt: string },
): void {
  db.sqlite
    .prepare(
      `INSERT INTO application_resumes (application_id, version_id, state, created_at)
       VALUES (?, ?, 'draft', ?)
       ON CONFLICT (application_id, version_id) DO NOTHING`,
    )
    .run(input.applicationId, input.versionId, input.createdAt);
}

export function getApplicationResume(db: Database, applicationId: string, versionId: string): ApplicationResume | null {
  const row = db.sqlite
    .prepare(`${APPLICATION_RESUME_SELECT} WHERE ar.application_id = ? AND ar.version_id = ?`)
    .get(applicationId, versionId);
  return row === undefined ? null : toApplicationResume(row);
}

// Every resume the application has used, oldest first.
export function listApplicationResumes(db: Database, applicationId: string): ApplicationResume[] {
  const rows = db.sqlite
    .prepare(`${APPLICATION_RESUME_SELECT} WHERE ar.application_id = ? ORDER BY ar.created_at, ar.rowid`)
    .all(applicationId);
  return rows.map(toApplicationResume);
}

// ---------------------------------------------------------------------------------------------
// Approved PDFs
// ---------------------------------------------------------------------------------------------

export type ApprovedPdf = { pdfSha256: string; pdfBytes: Uint8Array };

function toApprovedPdf(row: Row): ApprovedPdf {
  return { pdfSha256: textColumn(row, "pdf_sha256"), pdfBytes: bytesColumn(row, "pdf_bytes") };
}

export type ApprovedResumeInput = {
  applicationId: string;
  versionId: string;
  pdfSha256: string;
  pdfBytes: Uint8Array;
};

// Freezes a draft: stores the PDF and its fingerprint and marks the use "approved".
// Truthfulness control: the fingerprint must describe these exact bytes, and a frozen file is never replaced.
// Approving again with the same fingerprint changes nothing; with a different one it is refused.
export function markResumeApproved(db: Database, input: ApprovedResumeInput): void {
  if (sha256OfBytes(input.pdfBytes) !== input.pdfSha256) {
    throw new StorageError("fingerprint-mismatch", "The resume fingerprint does not match the PDF it was given.");
  }

  atomically(db, () => {
    const existing = getApplicationResume(db, input.applicationId, input.versionId);
    if (existing === null) throw new RecordNotFoundError("resume for this application", input.applicationId);

    if (existing.state === "approved") {
      if (existing.pdfSha256 === input.pdfSha256) return;
      throw new ApprovedFileConflictError(existing.shortId);
    }

    db.sqlite
      .prepare(
        `UPDATE application_resumes SET state = 'approved', pdf_sha256 = ?, pdf_bytes = ?
         WHERE application_id = ? AND version_id = ? AND state = 'draft'`,
      )
      .run(input.pdfSha256, input.pdfBytes, input.applicationId, input.versionId);
  });
}

// The frozen PDF this application approved for this version, or null if it is still a draft.
export function getApprovedPdf(db: Database, applicationId: string, versionId: string): ApprovedPdf | null {
  const row = db.sqlite
    .prepare(
      `SELECT pdf_sha256, pdf_bytes FROM application_resumes
       WHERE application_id = ? AND version_id = ? AND state = 'approved'`,
    )
    .get(applicationId, versionId);
  return row === undefined ? null : toApprovedPdf(row);
}

// A frozen PDF for this version from any application. A version is shared, so approving it a second
// time reuses these bytes instead of rendering again (ARCHITECTURE.md section 8.5, step 2).
export function findApprovedPdfForVersion(db: Database, versionId: string): ApprovedPdf | null {
  const row = db.sqlite
    .prepare(
      `SELECT pdf_sha256, pdf_bytes FROM application_resumes
       WHERE version_id = ? AND state = 'approved' ORDER BY created_at, rowid LIMIT 1`,
    )
    .get(versionId);
  return row === undefined ? null : toApprovedPdf(row);
}

// ---------------------------------------------------------------------------------------------
// For verifyApprovedFiles: which files should exist on disk
// ---------------------------------------------------------------------------------------------

// One approved resume and where its files belong. The PDF bytes are not loaded here (there can be hundreds);
// ask getApprovedPdf for them only when a file turns out to be missing.
export type ApprovedResumeFile = {
  applicationId: string;
  versionId: string;
  shortId: string;
  pdfSha256: string;
  applicationFolder: string | null; // relative to the person's folder, null until the folder exists
  isCurrentResume: boolean; // true when the application still uses this version
  fileName: string | null; // "First Last - Resume.pdf", from the approval's data sheet
};

export function listApprovedResumeFiles(db: Database): ApprovedResumeFile[] {
  const rows = db.sqlite
    .prepare(
      `SELECT ar.application_id, ar.version_id, rv.short_id, ar.pdf_sha256, a.folder,
              (a.resume_version IS ar.version_id) AS is_current,
              (SELECT json_extract(ap.data_sheet, '$.resumeFileName') FROM approvals ap
               WHERE ap.application_id = ar.application_id AND ap.resume_version = ar.version_id
               ORDER BY ap.approved_at DESC LIMIT 1) AS file_name
       FROM application_resumes ar
       JOIN resume_versions rv ON rv.version_id = ar.version_id
       JOIN applications a ON a.id = ar.application_id
       WHERE ar.state = 'approved'
       ORDER BY ar.created_at, ar.rowid`,
    )
    .all();
  return rows.map((row) => ({
    applicationId: textColumn(row, "application_id"),
    versionId: textColumn(row, "version_id"),
    shortId: textColumn(row, "short_id"),
    pdfSha256: textColumn(row, "pdf_sha256"),
    applicationFolder: textOrNullColumn(row, "folder"),
    isCurrentResume: flagColumn(row, "is_current"),
    fileName: textOrNullColumn(row, "file_name"),
  }));
}
