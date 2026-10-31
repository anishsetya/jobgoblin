// Read-only lists of applications for screens: the Pipeline list, the follow-ups that are due,
// and the rows of the tracker spreadsheet. They join the jobs table for the posting's location, region and link.
// Spec: ARCHITECTURE.md sections 5.9 (PipelineRow) and 7 (tracker columns).
import {
  Application,
  ApplicationStatus,
  Band,
  PipelineRow,
  TERMINAL_STATUSES,
  type PipelineQuery,
} from "@jobgoblin/schemas";
import type { SQLInputValue } from "node:sqlite";
import type { Database } from "../database";
import { containsPattern, flagColumn, placeholders, textColumn, textOrNullColumn } from "../rows";
import { applicationFieldsFromRow, toApplication } from "./applications";

// A follow-up is overdue once its day has passed (strictly before today) and the application is still open.
// Binds: today, then the closed statuses.
const OVERDUE_SQL = `follow_up_on IS NOT NULL AND follow_up_on < ? AND status NOT IN (${placeholders(TERMINAL_STATUSES)})`;

// The Pipeline screen's list, newest change first. `today` is the person's calendar day, "YYYY-MM-DD".
export function listApplications(db: Database, query: PipelineQuery, today: string): PipelineRow[] {
  const filters: string[] = [];
  const filterParams: SQLInputValue[] = [];

  if (query.status !== undefined && query.status.length > 0) {
    filters.push(`status IN (${placeholders(query.status)})`);
    filterParams.push(...query.status);
  }
  if (query.band !== undefined && query.band.length > 0) {
    filters.push(`band IN (${placeholders(query.band)})`);
    filterParams.push(...query.band);
  }
  if (query.search !== undefined && query.search.trim() !== "") {
    const pattern = containsPattern(query.search.trim());
    filters.push("(company LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR location LIKE ? ESCAPE '\\')");
    filterParams.push(pattern, pattern, pattern);
  }
  if (query.overdueOnly === true) {
    filters.push("overdue = 1");
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  // The inner query adds the job's location and region and works out "overdue" once, so the filters
  // above can use all three like ordinary columns.
  const rows = db.sqlite
    .prepare(
      `SELECT * FROM (
         SELECT a.*, j.location AS location, j.region AS region, (${OVERDUE_SQL}) AS overdue
         FROM applications a JOIN jobs j ON j.job_id = a.job_id
       ) AS pipeline
       ${whereClause}
       ORDER BY updated_at DESC, id`,
    )
    .all(today, ...TERMINAL_STATUSES, ...filterParams);

  return rows.map((row) =>
    PipelineRow.parse({
      ...applicationFieldsFromRow(row),
      overdue: flagColumn(row, "overdue"),
      location: row.location,
      region: row.region,
    }),
  );
}

// Open applications whose follow-up day is today or earlier: the "follow-up due" items on Today.
export function listFollowUpsDue(db: Database, today: string): Application[] {
  const rows = db.sqlite
    .prepare(
      `SELECT * FROM applications
       WHERE follow_up_on IS NOT NULL AND follow_up_on <= ? AND status NOT IN (${placeholders(TERMINAL_STATUSES)})
       ORDER BY follow_up_on, id`,
    )
    .all(today, ...TERMINAL_STATUSES);
  return rows.map(toApplication);
}

// One line of Tracker.csv and Tracker.xlsx, before any formatting.
export type TrackerRow = {
  company: string;
  role: string;
  status: ApplicationStatus;
  fitScore: number | null;
  band: Band | null;
  resumeShortId: string | null;
  appliedAt: string | null;
  followUpOn: string | null;
  postingUrl: string | null;
  folder: string | null;
  updatedAt: string;
};

// Every application, newest change first.
export function listTrackerRows(db: Database): TrackerRow[] {
  const rows = db.sqlite
    .prepare(
      `SELECT a.company, a.title, a.status, a.fit_score, a.band, rv.short_id, a.applied_at, a.follow_up_on,
              j.url, a.folder, a.updated_at
       FROM applications a
       JOIN jobs j ON j.job_id = a.job_id
       LEFT JOIN resume_versions rv ON rv.version_id = a.resume_version
       ORDER BY a.updated_at DESC, a.id`,
    )
    .all();
  return rows.map((row) => ({
    company: textColumn(row, "company"),
    role: textColumn(row, "title"),
    status: ApplicationStatus.parse(row.status),
    fitScore: typeof row.fit_score === "number" ? row.fit_score : null,
    band: row.band === null ? null : Band.parse(row.band),
    resumeShortId: textOrNullColumn(row, "short_id"),
    appliedAt: textOrNullColumn(row, "applied_at"),
    followUpOn: textOrNullColumn(row, "follow_up_on"),
    postingUrl: textOrNullColumn(row, "url"),
    folder: textOrNullColumn(row, "folder"),
    updatedAt: textColumn(row, "updated_at"),
  }));
}
