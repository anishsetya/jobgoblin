// Table `history_events`: the change log. Rows are only ever added; two triggers in the migration
// make the database itself refuse any UPDATE or DELETE.
// Spec: ARCHITECTURE.md sections 5.9 and 7; tech spec "Rules" ("History cannot be rewritten").
import { HistoryEvent, type ApplicationStatus } from "@jobgoblin/schemas";
import type { Database } from "../database";
import type { Row } from "../rows";

function toHistoryEvent(row: Row): HistoryEvent {
  return HistoryEvent.parse({
    id: row.id,
    ts: row.ts,
    actor: row.actor,
    applicationId: row.application_id,
    type: row.type,
    from: row.from_status,
    to: row.to_status,
    detail: row.detail,
  });
}

export function insertHistoryEvent(db: Database, event: HistoryEvent): void {
  const valid = HistoryEvent.parse(event);
  db.sqlite
    .prepare(
      `INSERT INTO history_events (id, ts, actor, application_id, type, from_status, to_status, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(valid.id, valid.ts, valid.actor, valid.applicationId, valid.type, valid.from, valid.to, valid.detail);
}

// One application's history, oldest first (the order a person reads it in).
export function listHistoryEvents(db: Database, applicationId: string): HistoryEvent[] {
  const rows = db.sqlite
    .prepare("SELECT * FROM history_events WHERE application_id = ? ORDER BY ts, rowid")
    .all(applicationId);
  return rows.map(toHistoryEvent);
}

// How many moves into `status` happened since `since` (an ISO timestamp). Today's "done today" counts
// come from here: the log is the one place that remembers every move, even when the application moved on since.
// Any event type counts, because a move made by Approve is logged as "approved", not "status-changed".
export function countStatusChangesSince(db: Database, status: ApplicationStatus, since: string): number {
  const row = db.sqlite
    .prepare("SELECT COUNT(*) AS total FROM history_events WHERE to_status = ? AND ts >= ?")
    .get(status, since);
  return Number(row?.total ?? 0);
}
