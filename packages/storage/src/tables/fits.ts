// Table `fits`: the latest fit analysis of each application (score, band, matched items, gaps, flags).
// The job id is not stored here; a Fit gets it from its application when it is read.
// Spec: ARCHITECTURE.md sections 5.5 and 7.
import { Fit } from "@jobgoblin/schemas";
import type { Database } from "../database";
import { jsonColumn, toJson } from "../rows";

// Saves the fit, replacing an earlier one for the same application (a job can be scored again).
export function saveFit(db: Database, fit: Fit): void {
  const valid = Fit.parse(fit);
  db.sqlite
    .prepare(
      `INSERT INTO fits (application_id, score, band, track, must_haves, gaps, flags, matched_item_ids,
                         reason, hard_skip, rubric_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (application_id) DO UPDATE SET
         score = excluded.score, band = excluded.band, track = excluded.track,
         must_haves = excluded.must_haves, gaps = excluded.gaps, flags = excluded.flags,
         matched_item_ids = excluded.matched_item_ids, reason = excluded.reason,
         hard_skip = excluded.hard_skip, rubric_version = excluded.rubric_version,
         created_at = excluded.created_at`,
    )
    .run(
      valid.applicationId, valid.score, valid.band, valid.track,
      toJson(valid.mustHaves), toJson(valid.gaps), toJson(valid.flags), toJson(valid.matchedItemIds),
      valid.reason, valid.hardSkip, valid.rubricVersion, valid.createdAt,
    );
}

export function getFit(db: Database, applicationId: string): Fit | null {
  const row = db.sqlite
    .prepare(
      `SELECT f.*, a.job_id FROM fits f JOIN applications a ON a.id = f.application_id
       WHERE f.application_id = ?`,
    )
    .get(applicationId);
  if (row === undefined) return null;

  return Fit.parse({
    applicationId: row.application_id,
    jobId: row.job_id,
    score: row.score,
    band: row.band,
    track: row.track,
    mustHaves: jsonColumn(row, "must_haves"),
    gaps: jsonColumn(row, "gaps"),
    flags: jsonColumn(row, "flags"),
    matchedItemIds: jsonColumn(row, "matched_item_ids"),
    reason: row.reason,
    hardSkip: row.hard_skip,
    rubricVersion: row.rubric_version,
    createdAt: row.created_at,
  });
}
