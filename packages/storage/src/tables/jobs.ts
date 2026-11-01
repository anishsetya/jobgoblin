// Table `jobs`: every job a feed returned or the person pasted. A job becomes an application only once
// a run records a fit for it (decision D9), so this table can hold thousands of rows without cluttering Pipeline.
// Spec: ARCHITECTURE.md sections 5.4 and 7; "never show a job twice" (PRD D3).
import { Job } from "@jobgoblin/schemas";
import { atomically, type Database } from "../database";
import { jsonColumn, toJson, type Row } from "../rows";

function toJob(row: Row): Job {
  return Job.parse({
    jobId: row.job_id,
    dedupeKey: row.dedupe_key,
    source: row.source,
    company: row.company,
    title: row.title,
    location: row.location,
    region: row.region,
    url: row.url,
    text: row.text,
    questions: jsonColumn(row, "questions"),
    postedAt: row.posted_at,
    foundAt: row.found_at,
    seenAt: row.seen_at,
    filteredReason: row.filtered_reason,
  });
}

// Adds the job unless that job id is already stored. Returns true when it was new, so a feed refresh can
// count what it found. An existing job is left exactly as it was, including when it was first seen.
export function insertJobIfNew(db: Database, job: Job): boolean {
  const valid = Job.parse(job);
  const result = db.sqlite
    .prepare(
      // ON CONFLICT DO NOTHING skips only a duplicate job id. (INSERT OR IGNORE would also hide a failed CHECK.)
      `INSERT INTO jobs (job_id, dedupe_key, source, company, title, location, region, url, text,
                         questions, posted_at, found_at, seen_at, filtered_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(
      valid.jobId, valid.dedupeKey, valid.source, valid.company, valid.title, valid.location, valid.region,
      valid.url, valid.text, toJson(valid.questions), valid.postedAt, valid.foundAt, valid.seenAt, valid.filteredReason,
    );
  return result.changes === 1;
}

export function getJob(db: Database, jobId: string): Job | null {
  const row = db.sqlite.prepare("SELECT * FROM jobs WHERE job_id = ?").get(jobId);
  return row === undefined ? null : toJob(row);
}

// Jobs with the same dedupe key are the same role (reposted, or listed on another site).
export function listJobsByDedupeKey(db: Database, dedupeKey: string): Job[] {
  const rows = db.sqlite.prepare("SELECT * FROM jobs WHERE dedupe_key = ? ORDER BY found_at, job_id").all(dedupeKey);
  return rows.map(toJob);
}

// The jobs a hunt run may be shown: not seen yet, and not dropped by the code filter. Oldest first.
export function listUnseenJobs(db: Database, limit: number): Job[] {
  const rows = db.sqlite
    .prepare(
      `SELECT * FROM jobs WHERE seen_at IS NULL AND filtered_reason IS NULL
       ORDER BY found_at, job_id LIMIT ?`,
    )
    .all(limit);
  return rows.map(toJob);
}

export function countUnseenJobs(db: Database): number {
  const row = db.sqlite
    .prepare("SELECT COUNT(*) AS total FROM jobs WHERE seen_at IS NULL AND filtered_reason IS NULL")
    .get();
  return Number(row?.total ?? 0);
}

// Marks jobs as shown, once. A job that was already seen keeps its first seen time.
// Returns how many jobs were newly marked; unknown ids are ignored.
export function markJobsSeen(db: Database, jobIds: readonly string[], seenAt: string): number {
  return atomically(db, () => {
    const markOne = db.sqlite.prepare("UPDATE jobs SET seen_at = ? WHERE job_id = ? AND seen_at IS NULL");
    let marked = 0;
    for (const jobId of jobIds) {
      marked += Number(markOne.run(seenAt, jobId).changes);
    }
    return marked;
  });
}
