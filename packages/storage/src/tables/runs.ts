// Tables `runs` and `run_tasks`: background Claude Code sessions and the applications each one works through.
// A run has one task per application; a task is pending, done, failed, or waiting on the person's answer.
// Spec: ARCHITECTURE.md sections 5.8 and 10.
import { Run, RunTask, RunTaskState, type RunKind, type RunStatus } from "@jobgoblin/schemas";
import { atomically, type Database } from "../database";
import { buildSetClause, jsonColumn, placeholders, toJson, type Row } from "../rows";

// ---------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------

function toRun(row: Row): Run {
  return Run.parse({
    id: row.id,
    kind: row.kind,
    status: row.status,
    model: row.model,
    input: jsonColumn(row, "input"),
    sessionId: row.session_id,
    pid: row.pid,
    step: row.step,
    progressDone: row.progress_done,
    progressTotal: row.progress_total,
    outcomeMessage: row.outcome_message,
    resultText: row.result_text,
    retryOf: row.retry_of,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    dismissedAt: row.dismissed_at,
  });
}

// Adds a run and one pending task per application, together. A setup or hunt run has no tasks.
export function insertRun(db: Database, run: Run, applicationIds: readonly string[]): void {
  const valid = Run.parse(run);
  atomically(db, () => {
    db.sqlite
      .prepare(
        `INSERT INTO runs (id, kind, status, model, input, session_id, pid, step, progress_done, progress_total,
                           outcome_message, result_text, retry_of, queued_at, started_at, ended_at, dismissed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        valid.id, valid.kind, valid.status, valid.model, toJson(valid.input), valid.sessionId, valid.pid,
        valid.step, valid.progressDone, valid.progressTotal, valid.outcomeMessage, valid.resultText,
        valid.retryOf, valid.queuedAt, valid.startedAt, valid.endedAt, valid.dismissedAt,
      );
    for (const applicationId of applicationIds) {
      addRunTask(db, valid.id, applicationId);
    }
  });
}

export function getRun(db: Database, id: string): Run | null {
  const row = db.sqlite.prepare("SELECT * FROM runs WHERE id = ?").get(id);
  return row === undefined ? null : toRun(row);
}

// Runs in any of the given statuses, in the order they were queued: the order the queue serves them.
export function listRunsByStatus(db: Database, statuses: readonly RunStatus[]): Run[] {
  if (statuses.length === 0) return [];
  const rows = db.sqlite
    .prepare(`SELECT * FROM runs WHERE status IN (${placeholders(statuses)}) ORDER BY queued_at, rowid`)
    .all(...statuses);
  return rows.map(toRun);
}

// The most recently queued runs, newest first, for Today's cards.
export function listRecentRuns(db: Database, limit: number): Run[] {
  const rows = db.sqlite.prepare("SELECT * FROM runs ORDER BY queued_at DESC, rowid DESC LIMIT ?").all(limit);
  return rows.map(toRun);
}

// The oldest run of this kind that has not started. Answering a question joins it instead of queueing another (D8).
export function findOldestQueuedRun(db: Database, kind: RunKind): Run | null {
  const row = db.sqlite
    .prepare("SELECT * FROM runs WHERE kind = ? AND status = 'queued' ORDER BY queued_at, rowid LIMIT 1")
    .get(kind);
  return row === undefined ? null : toRun(row);
}

// The only fields of a run that change after it is queued. The column names are a closed list written
// here, so no caller-supplied key ever becomes part of the SQL (see buildSetClause).
const COLUMN_FOR_RUN_FIELD = {
  status: "status",
  model: "model",
  sessionId: "session_id",
  pid: "pid",
  step: "step",
  progressDone: "progress_done",
  progressTotal: "progress_total",
  outcomeMessage: "outcome_message",
  resultText: "result_text",
  startedAt: "started_at",
  endedAt: "ended_at",
  dismissedAt: "dismissed_at",
} as const;

const RunChanges = Run.pick({
  status: true,
  model: true,
  sessionId: true,
  pid: true,
  step: true,
  progressDone: true,
  progressTotal: true,
  outcomeMessage: true,
  resultText: true,
  startedAt: true,
  endedAt: true,
  dismissedAt: true,
}).partial();
export type RunChanges = ReturnType<typeof RunChanges.parse>;

// Sets the given fields (leave a field out to keep it; pass null to clear it).
// Returns the updated run, or null when there is no such run.
export function updateRun(db: Database, runId: string, changes: RunChanges): Run | null {
  const validChanges = RunChanges.parse(changes);
  const { sql, params } = buildSetClause(COLUMN_FOR_RUN_FIELD, validChanges);
  if (sql !== "") {
    db.sqlite.prepare(`UPDATE runs SET ${sql} WHERE id = ?`).run(...params, runId);
  }
  return getRun(db, runId);
}

// ---------------------------------------------------------------------------------------------
// Run tasks
// ---------------------------------------------------------------------------------------------

function toRunTask(row: Row): RunTask {
  return RunTask.parse({ runId: row.run_id, applicationId: row.application_id, state: row.state, note: row.note });
}

// Adds one pending task. Does nothing if the run already has a task for that application.
export function addRunTask(db: Database, runId: string, applicationId: string): void {
  db.sqlite
    .prepare("INSERT INTO run_tasks (run_id, application_id, state) VALUES (?, ?, 'pending') ON CONFLICT DO NOTHING")
    .run(runId, applicationId);
}

// A run's tasks in the order they were added.
export function listRunTasks(db: Database, runId: string): RunTask[] {
  const rows = db.sqlite.prepare("SELECT * FROM run_tasks WHERE run_id = ? ORDER BY rowid").all(runId);
  return rows.map(toRunTask);
}

export function listRunTasksByState(db: Database, runId: string, state: RunTaskState): RunTask[] {
  const rows = db.sqlite
    .prepare("SELECT * FROM run_tasks WHERE run_id = ? AND state = ? ORDER BY rowid")
    .all(runId, state);
  return rows.map(toRunTask);
}

// The task the run should work on next: the first pending one whose application has no unanswered question
// (decision D17: an open question makes the run skip that application). Null when nothing is left to do.
export function getNextPendingRunTask(db: Database, runId: string): RunTask | null {
  const row = db.sqlite
    .prepare(
      `SELECT * FROM run_tasks
       WHERE run_id = ? AND state = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM questions
           WHERE questions.application_id = run_tasks.application_id AND questions.answer IS NULL)
       ORDER BY rowid LIMIT 1`,
    )
    .get(runId);
  return row === undefined ? null : toRunTask(row);
}

export type RunTaskUpdate = { runId: string; applicationId: string; state: RunTaskState; note?: string | null };

// Records how a task ended. Returns false when the run has no task for that application.
export function setRunTaskState(db: Database, update: RunTaskUpdate): boolean {
  const result = db.sqlite
    .prepare("UPDATE run_tasks SET state = ?, note = ? WHERE run_id = ? AND application_id = ?")
    .run(RunTaskState.parse(update.state), update.note ?? null, update.runId, update.applicationId);
  return result.changes === 1;
}

// How many tasks are in each state, with a zero for states nothing is in.
export function countRunTasksByState(db: Database, runId: string): Record<RunTaskState, number> {
  const counts: Record<RunTaskState, number> = { pending: 0, done: 0, failed: 0, waiting: 0 };
  const rows = db.sqlite
    .prepare("SELECT state, COUNT(*) AS total FROM run_tasks WHERE run_id = ? GROUP BY state")
    .all(runId);
  for (const row of rows) {
    counts[RunTaskState.parse(row.state)] = Number(row.total);
  }
  return counts;
}

// The active run (queued, running or waiting) that still has work to do for this application, if any.
// A task that is done or failed no longer holds the application, so it can be queued again at once.
// An application may sit in only one active run at a time (ARCHITECTURE.md section 8.3).
export function findActiveRunForApplication(db: Database, applicationId: string): Run | null {
  const row = db.sqlite
    .prepare(
      `SELECT runs.* FROM runs JOIN run_tasks ON run_tasks.run_id = runs.id
       WHERE run_tasks.application_id = ?
         AND run_tasks.state IN ('pending', 'waiting')
         AND runs.status IN ('queued', 'running', 'waiting')
       ORDER BY runs.queued_at, runs.rowid LIMIT 1`,
    )
    .get(applicationId);
  return row === undefined ? null : toRun(row);
}
