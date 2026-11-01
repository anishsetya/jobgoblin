# @jobgoblin/storage

Everything Jobgoblin keeps on disk. The SQLite database (through `node:sqlite`), its migrations, one small module per group of tables, the person's folder (application folders, approved resumes), the tracker spreadsheet export, backups and restore, and the startup check that approved resume files still exist.

This is the only package that imports `node:sqlite` or writes into the person's folder (dependency rule, ARCHITECTURE.md section 3). The server calls these functions inside its services; it never writes SQL.

## Read first

1. `migrations/0001_initial.sql`: every table, its indexes, and the rules the database enforces itself (CHECK lists, the history triggers). Reading it is the quickest way to learn the data model.
2. `src/database.ts` and `src/openDatabase.ts`: the `Database` handle, `transaction()` and how a database is opened and migrated.
3. `src/tables/applications.ts`: the pattern every table module follows, and `updateApplicationStatus`, the one function that moves an application and logs it.
4. `src/personFolder.ts`: how the person's folder is laid out and why paths are checked.

Then `tracker.ts`, `backups.ts` and `verifyApprovedFiles.ts` as needed.

## The tables

Each file in `src/tables/` is plain exported functions that take `db` first and return types from `@jobgoblin/schemas`. A row-to-type function in each file turns a row into a record and checks it with the zod schema.

| File | Tables | What it holds |
| --- | --- | --- |
| `profile.ts` | `profile` | The seven profile sections, with schema defaults for sections never saved |
| `story.ts` | `story_items` | Your story: experiences, projects, achievements, skills, headlines |
| `masterResume.ts` | `master_resume` | The default one-page resume built when setup finishes (one row) |
| `uploads.ts` | `uploads` | The redacted text of the uploaded resume and LinkedIn PDF |
| `companies.ts` | `companies` | Watched companies and their status |
| `jobs.ts` | `jobs` | Every job seen; unseen and unfiltered jobs for a hunt; mark seen; same role by dedupe key |
| `feedCache.ts` | `feed_cache` | The last response of each feed URL (ETag, Last-Modified) |
| `applications.ts` | `applications` | Applications, field updates, limit-check input, counts, and `updateApplicationStatus` |
| `applicationQueries.ts` | (joins) | Pipeline list with filters and search, follow-ups due, rows for the tracker |
| `fits.ts` | `fits` | The latest fit analysis per application |
| `resumes.ts` | `resume_versions`, `application_resumes` | Resume content (shared), each application's use of it, frozen approved PDFs |
| `approvals.ts` | `approvals` | The person's approvals; live, used or voided |
| `submissions.ts` | `submissions` | Proof behind every Applied |
| `answers.ts` | `answers` | Screening answers, placeholders intact |
| `runs.ts` | `runs`, `run_tasks` | Runs, their work queue, next pending task, active run for an application |
| `questions.ts` | `questions` | What runs asked the person, and the answers |
| `historyEvents.ts` | `history_events` | The append-only change log |
| `settings.ts` | `settings` | Settings, with defaults from the `Settings` schema |

Outside the tables: `personFolder.ts`, `tracker.ts` (Tracker.csv and Tracker.xlsx), `backups.ts`, `verifyApprovedFiles.ts`. Supporting files: `backupFiles.ts` (backup file names and which backups are kept), `errors.ts` (typed errors with a `code`), `rows.ts` (row helpers), `localTime.ts`, `scheduler.ts` (a replaceable timer), `hash.ts` (a small sha256 that repeats core's, because storage does not depend on core).

## How it is tested

`pnpm exec vitest run packages/storage` and `pnpm --filter @jobgoblin/storage typecheck`. Every test uses a temporary folder and database made by `src/testSupport.ts` (builders such as `aJob()` and `anApplication()`, a fake timer, and cleanup that closes databases before deleting folders, which Windows requires). No test touches the network or a real folder.

- `migrations.test.ts` applies the migration, sets and checks `user_version`, refuses a newer database, rolls back a failing migration, reads every `CHECK (... IN (...))` list out of the SQL and compares it with the matching zod enum (including `ApplicationStatus` and `RunStatus`), and checks the history triggers.
- `database.test.ts` covers transactions: commit, rollback, nesting refused, async refused.
- Each table module has a round trip test next to it. The small tables share `smallTables.test.ts`, and a few related ones share a file (`approvalsAndProof.test.ts`, `questionsAndHistory.test.ts`).
- `personFolder.test.ts`, `tracker.test.ts`, `backups.test.ts` and `verifyApprovedFiles.test.ts` test the file-side behaviour. Times come from an injected `now`, timers from an injected scheduler, and a locked tracker file is simulated by an injected `renameFile` that throws `EBUSY`.

## Using it from the server

- Ids and timestamps come from the caller: every `insertX` takes the whole record. `newId()` makes a UUID. The only id storage makes is the one for the history event inside `updateApplicationStatus`.
- A table function that changes more than one row (`updateApplicationStatus`, `replaceAnswers`, `insertRun`, `markJobsSeen`) runs inside `atomically`: it joins your transaction if one is open and starts its own if not. You never nest `db.transaction()`; that throws `NestedTransactionError`.
- Do async work (rendering, fetching) before or after a transaction. `db.transaction` refuses an async function.
- Restoring a backup replaces the `Database`. `createBackups` and `createTrackerExporter` take `getDb` and `getFolder` getters, so keep the current database and folder in one mutable place (the server context) and pass `() => ctx.db`.
- Run `verifyApprovedFiles(db, folder)` at startup and log its report.

## Decisions

Places where ARCHITECTURE.md (v2) was ambiguous or silent, and what this package does.

1. **Callers supply ids and times.** `insertApplication(db, application)` takes the finished record, which keeps the module free of clocks and makes tests exact. `updateApplicationStatus` takes an extra `at` (used for `updated_at` and the event's `ts`) and makes the event id itself.
2. **`Database` also has `path`,** the database file. Backups and restore need it.
3. **`createTrackerExporter` and `createBackups` take `getDb` and `getFolder` (functions),** not `db` and `folder` values as section 7 writes them. Restore replaces the database and "Choose folder" replaces the folder while both objects live on, and ServerContext holds them for the life of the server. `getFolder` may return `null` (no folder chosen yet): the tracker reports `off` and backups return `null`.
4. **Restore and `reopen`.** `restore(id, reopen)` checks the id against the file-name pattern, copies the chosen backup aside, makes a `before-restore` backup, closes the database, moves the copy into place and calls `reopen()`, which must open the database again and make it the app's current one. It then writes this computer's `personFolder` setting into the restored database and returns it. If `reopen` throws (a damaged backup, or one from a newer Jobgoblin), the previous data is put back and `reopen` is called again, so the app keeps working.
5. **Extra database rules beyond the section 7 list.** Tables are `STRICT`. JSON columns have `json_valid()`. Every enum column has a literal CHECK list, each compared with its zod enum by a test. An approved `application_resumes` row must have its PDF bytes and fingerprint, a draft must have neither. At most one live approval per application (a partial unique index): void or use the old one before inserting the next.
6. **`resume_versions.short_id`** is a stored, unique column. `ResumeVersion` has a `shortId` and it names `Resumes/<shortId>.pdf`, so it must never change; storing it lets the caller choose a longer one if two ever clash (`getResumeVersionByShortId` checks).
7. **Records are checked with the zod schemas on the way in and on the way out,** so the database cannot hold a row that cannot be read back. Records that exist only in this package (an upload, a cache entry) use small typed readers instead, because `zod` is not a dependency of this package.
8. **`markResumeApproved`** refuses a fingerprint that does not match the bytes, and refuses different bytes for an already approved resume. An approved PDF is written once, in the database and in `Resumes/`.
9. **"Overdue" and "due".** A follow-up is overdue when its day is before today and the application is not closed (not in `TERMINAL_STATUSES`). `listFollowUpsDue` also includes today. `today` is passed in as `YYYY-MM-DD`.
10. **`findActiveRunForApplication`** counts a run that is queued, running or waiting and still has a pending or waiting task for the application. A done or failed task releases the application, though the run goes on.
11. **Paths in the database use `/`** and are relative to the person's folder. `absolutePath` refuses any that leave the folder, because a restored backup could hold anything. `applicationFolderPath(name)` is an addition to `PersonFolder` that builds the stored path from the name.
12. **Folder names.** A character Windows forbids becomes a space, then spaces are collapsed ("AI/ML Engineer" becomes "AI ML Engineer"). The 80-character limit includes the " (2)" suffix. Dates in names use the person's local day.
13. **Backup names use local time** (`2026-10-31 14-05.jobgoblin-backup`, `-2` for a second one in the same minute) so they match the person's clock. `chooseBackupsToKeep` keeps every backup from the last 2 days, then the newest of each calendar day up to 14 days. `scheduleAfterChange` waits 2 seconds to let a burst finish, and until 5 minutes after the newest backup.
14. **`reason` and `onBackupDone`.** `backupNow(reason)` passes the reason to an optional `onBackupDone(backup, reason)` hook, which is how the server learns that a scheduled backup finished and emits `backup.done`.
15. **Background failures are reported, not swallowed.** A timer cannot throw to anyone, so the tracker and backups take an optional `reportError(what, error)` (default: `console.error`). `flushNow()` itself rejects on a failure other than a locked file.
16. **Tracker CSV.** The header line comes first, with no byte-order mark. A text cell that starts with `=`, `+`, `-` or `@` gets a leading apostrophe, because job titles come from the internet and a spreadsheet would run them as formulas. The xlsx stores text as text and needs no such guard. Dates and times in both files are in local time.
17. **`verifyApprovedFiles`** writes back missing files only. A file that exists with different content is left alone and listed as `mismatched` (the person may have replaced it). It checks `Resumes/<shortId>.pdf` for every approved version but the copy in the application's folder only for the application's current version. A stored path that leaves the folder is listed as `refused`.
18. **`exceljs` is imported as a default import.** It is a CommonJS package whose named exports Node cannot see from an ES module.
19. **`applications.ts` is split** into `applications.ts` (records and changes) and `applicationQueries.ts` (lists for screens) to stay under the 250-line guide.
