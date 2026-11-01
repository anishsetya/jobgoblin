// Table `submissions`: the proof behind every "Applied". Written once, when the person says they submitted.
// Spec: ARCHITECTURE.md sections 5.7 and 8.6.
import { Submission } from "@jobgoblin/schemas";
import type { Database } from "../database";

export function insertSubmission(db: Database, submission: Submission): void {
  const valid = Submission.parse(submission);
  db.sqlite
    .prepare(
      `INSERT INTO submissions (id, application_id, resume_version, attached_sha256, proof_type, proof, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(valid.id, valid.applicationId, valid.resumeVersion, valid.attachedSha256, valid.proofType, valid.proof, valid.submittedAt);
}

// The application's submission (the newest, should there ever be two), or null if it was not submitted.
export function getSubmissionForApplication(db: Database, applicationId: string): Submission | null {
  const row = db.sqlite
    .prepare("SELECT * FROM submissions WHERE application_id = ? ORDER BY submitted_at DESC, rowid DESC LIMIT 1")
    .get(applicationId);
  if (row === undefined) return null;

  return Submission.parse({
    id: row.id,
    applicationId: row.application_id,
    resumeVersion: row.resume_version,
    attachedSha256: row.attached_sha256,
    proofType: row.proof_type,
    proof: row.proof,
    submittedAt: row.submitted_at,
  });
}
