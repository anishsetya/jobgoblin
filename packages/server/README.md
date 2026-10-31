# @jobgoblin/server

The local server of Jobgoblin: an HTTP API on `127.0.0.1` for the dashboard, the **services** (the use cases) behind it, the queue of Claude Code runs, and the runner that starts them. The dashboard talks to it over HTTP; a Claude Code run talks to it over MCP (`/mcp`), and every MCP tool is a thin adapter over one of the services described here.

Spec: [ARCHITECTURE.md](../../docs/poc/ARCHITECTURE.md) sections 7 to 11, and [CODE_STYLE.md](../../docs/poc/CODE_STYLE.md). This README covers the context, the services and the HTTP API. The runner has its own [README](src/runner/README.md); `src/mcp/` and `runner/launcher.ts` are written separately and plug into the hooks listed at the end.

## Read first

1. `src/context.ts`: `ServerContext`, the one object every service gets as its first argument.
2. `src/services/approvals.ts`, then `submissions.ts`: the two decisions that matter most (approve, "I submitted"). Each reads as a list of named steps.
3. `src/services/runs.ts`: how a run is queued.
4. `src/http/app.ts`: the order of the middleware, then any file in `src/http/routes/` (each is a few lines per route).
5. `src/startServer.ts`: what happens at start-up and at quit.

## The path of a request

```
browser / dashboard
  -> hostCheck      Host must be 127.0.0.1:<port> or localhost:<port>        (stops DNS rebinding)
  -> originCheck    Origin absent, the server's own, or JOBGOBLIN_DEV_ORIGIN (stops other websites)
  -> auth           /api/*: session token. /mcp: a live run's token. Never each other's.
  -> bodyLimit      11 MB (a resume upload is at most 10 MB)
  -> route          src/http/routes/<area>.ts: parse the body with its zod schema, call one service
  -> service        src/services/<use case>.ts: rules, database, files, events
  -> errorHandler   always { code, message, action } in plain words, never a stack trace
```

A service throws a `ServiceError` for a refusal the person must be told about (`not-found` 404, `conflict` 409, `invalid` 400, `unavailable` 409); the error handler turns it into the `ApiError`. A rule failure that a **run** can fix (a resume that fails the truth trace, a banned word in an answer) is returned as a value, `Outcome<T> = { ok: true, value } | { ok: false, errors }`, so the run gets every problem at once. Zod errors become `invalid-request`, `CoreError` and `StorageError` have fixed mappings, and anything else is logged to `server.log` and shown as "Something went wrong inside Jobgoblin."

Everything under `/api` needs the session token. The dashboard's own files (`apps/dashboard/dist`, with a fallback to `index.html` for the router's pages) need none: they hold no personal data. `/mcp` is not mounted yet; a valid run token reaches a `404 not-available`.

## Where each use case lives

`src/services/`, one idea per file. Every function takes `ctx` first.

| Use case | File | Called by |
| --- | --- | --- |
| Today (Needs you, run cards, done today) | `today.ts` | `GET /api/today` |
| Pipeline list | `pipeline.ts` | `GET /api/pipeline` |
| One application for Review, Open application, Application | `applicationDetail.ts` (+ `applicationActions.ts`, `currentResume.ts`, `dataSheets.ts`) | `GET /api/apps/:id` |
| Add a job (link or text), then a paste run | `jobs.ts` | `POST /api/jobs` |
| Jobs for a hunt run: list unseen, mark seen, add from the web, read one | `jobsForRuns.ts`, `untrustedText.ts` | `search_jobs`, `mark_seen`, `add_job`, `get_job` |
| Fetch feeds before a hunt, seed the company list | `feeds.ts`, `../feedCache.ts` | the launcher, start-up |
| Score a job | `fits.ts`, `fitRubric.ts`, `applicationCreation.ts` | `record_fit`, `get_fit_context` |
| Start tailoring (after a hunt or paste; Tailor; Request edit) | `tailoring.ts`, `tailoringContext.ts` | the launcher, `POST .../tailor`, `.../request-edit`, `get_tailoring_context` |
| Check, render and save a resume draft | `resumes.ts`, `resumeChecks.ts`, `resumeVersions.ts` | `submit_resume_draft` |
| Resume PDFs for the dashboard (draft previews, approved bytes) | `resumePdf.ts` | `GET /api/apps/:id/resume.pdf` |
| Approve (also approve again), void approvals when details change | `approvals.ts`, `approvalFiles.ts`, `approvalVoiding.ts` | `POST .../approve`, every profile write |
| Screening answers | `answers.ts` | `get_approved`, `save_answers` |
| "I submitted" | `submissions.ts` | `POST .../submitted` |
| Skip, undo skip, withdraw, record what happened after applying | `decisions.ts`; `statusForRuns.ts` for a run | `POST .../skip`, `.../undo-skip`, `.../withdraw`, `.../status` |
| Questions between a run and the person | `questions.ts` | `ask_person`, `POST /api/questions/:id/answer` |
| Queue, cancel, retry, dismiss; the tasks inside a run | `runs.ts`, `runTasks.ts` | many (see below), `/api/runs` |
| Ask about this application | `askRuns.ts`, `askReadModels.ts` | `POST .../ask`; `list_ready`, `get_pipeline`, `get_application` |
| Profile (the person's view; the run's view) | `profile.ts`; `profileForRuns.ts`, `missingValues.ts` | `/api/profile`; `get_profile`, `save_profile_section` |
| Your story | `story.ts`; `storyProposals.ts` for a run | `/api/story`; `propose_story_items` |
| Setup: import a resume, finish | `setup.ts` | `POST /api/import-resume`, `/api/setup/finish`; `import_resume` |
| Settings and the person's folder | `settings.ts` | `/api/settings` |
| Backups and restore | `backups.ts` | `/api/backups` |
| Tracker download | `exports.ts` | `GET /api/export/csv`, `/xlsx` |
| Open a file | `openPath.ts`, `desktopPort.ts` | `POST /api/open` |
| Start-up and quit helpers | `serverDatabase.ts`, `runRecovery.ts`, `runShutdown.ts` | `startServer.ts`, `backups.ts` |
| Shared helpers | `moves.ts` (every status change), `changes.ts` (events, tracker, backup), `history.ts`, `loaders.ts`, `dates.ts`, `jobIds.ts`, `serviceError.ts` | all |

Two habits hold everywhere. A status change always goes through `moveApplication` (`moves.ts`), which asks `core.assertTransition` first and then saves the move and its history row in the same transaction. And a service announces what changed (`changes.ts`: `application.updated`, `needs-you.changed`, `run.updated`, `profile.updated`) and schedules the tracker file and a backup only **after** its transaction has committed, so a browser that refetches on the event always sees the new data.

### The services behind the 21 MCP tools

| MCP tool | Service function |
| --- | --- |
| `get_profile` | `getProfileForRun` (`profileForRuns.ts`) |
| `save_profile_section` | `saveProfileSectionFromRun` (`profileForRuns.ts`) |
| `propose_story_items` | `proposeStoryItems` (`storyProposals.ts`) |
| `import_resume` | `getUploadsForRun` (`setup.ts`) |
| `search_jobs` | `searchUnseenJobs` (`jobsForRuns.ts`) |
| `add_job` | `addJobFromRun` (`jobsForRuns.ts`) |
| `mark_seen` | `markSeen` (`jobsForRuns.ts`) |
| `get_job` | `getJobForRun` (`jobsForRuns.ts`) |
| `get_fit_context` | `getFitContext` (`fits.ts`) |
| `record_fit` | `recordFit` (`fits.ts`) |
| `get_tailoring_context` | `getTailoringContext` (`tailoringContext.ts`) |
| `submit_resume_draft` | `submitResumeDraft` (`resumes.ts`, async) |
| `save_answers` | `saveAnswers` (`answers.ts`) |
| `list_ready` | `listReady` (`askReadModels.ts`) |
| `get_approved` | `getApprovedForRun` (`answers.ts`) |
| `update_status` | `updateStatusFromRun` (`statusForRuns.ts`) |
| `get_pipeline` | `getPipelineSummary` (`askReadModels.ts`) |
| `get_application` | `getApplicationForRun` (`askReadModels.ts`) |
| `ask_person` | `askPerson` (`questions.ts`) |
| `next_task` | `nextTask` (`runTasks.ts`) |
| `complete_task` | `completeTask` (`runTasks.ts`) |

Functions that can refuse in a way a run can fix return an `Outcome`; the adapter turns `{ ok: false, errors }` into the `ToolReply` as it is, and a thrown `ServiceError` into one error with `toToolError`. A tailor or answers run may only touch applications in its own task list: the adapter calls `assertApplicationInRun(ctx, runId, applicationId)` (`runTasks.ts`) before `get_tailoring_context`, `submit_resume_draft`, `get_approved`, `save_answers` and `ask_person`.

## How runs are queued

A run is a row in `runs` (status `queued`) plus one `run_tasks` row per application it works through. `ctx.runs.queueRun(request)` (`services/runs.ts`) is the only way in; the person-facing services call the same function.

| Who queues | Kind | Tasks | Input |
| --- | --- | --- | --- |
| `POST /api/runs` (`startHunt`; setup must be finished) | hunt | none | `{}` |
| `POST /api/import-resume` after a resume (`importResume`) | setup | none | `{}` |
| `POST /api/jobs` (`addPastedJob`) | paste | none | `{ jobId, applicationId }` |
| `admitAfterHuntOrPaste`, `requestTailor`, `requestEdit` | tailor | one per application | `{}` or `{ editNote }` |
| `approveApplication` | answers | the application | `{}` |
| `POST .../ask` (`startAsk`) | ask | none | `{ applicationId, question }` |
| `answerQuestion` | the kind that asked | that one application | the asking run's input, model and kind |
| `retryRun` | the failed run's kind | its pending and failed tasks | its input, model, `retryOf` |

The queue enforces three rules, all tested in `runs.test.ts`:

- **An application sits in only one active run** (`queued`, `running` or `waiting` with work left). A tailor or answers run holds an application through its tasks; a paste run holds the application of its job, an ask run the one it was asked about. A second request is refused with "This application already has a run in progress."
- **One hunt and one setup at a time.** Uploading the resume twice reuses the setup run that is already waiting.
- **A single re-queued application joins** the oldest queued run of the same kind, model and input (D8), so three answers make one run, not three. A retry never joins.

`insertQueuedRun` is the database half, for a service that must queue inside its own transaction; it announces nothing, so the caller calls `announceQueuedRun(ctx, run)` after the commit. That function emits `run.updated` and calls `wake()`, which calls `ctx.launcher?.wake()`. **The queue never starts a process.** Until a launcher is set, a queued run simply waits.

Inside a tailor or answers run, `nextTask` hands out the next pending task whose application has no open question (D17), and `completeTask` records `done`, `failed` or `waiting` and updates `progress_done` and `progress_total`. `waiting` is accepted only for an application that really has an open question.

`cancelRun` asks the launcher to stop a `running` run, and finishes the job in the database itself if the launcher could not (a `queued` or `waiting` run has no process). `cancelRunsForShutdown` does the same for every run when Jobgoblin quits, except `waiting` runs, which have no process and keep their open question.

## Starting it

| Command | What it does |
| --- | --- |
| `pnpm --filter @jobgoblin/server dev` | Runs `src/main.ts` with `tsx`. Prints one line, `JOBGOBLIN_READY {"port":...,"url":"http://127.0.0.1:...#token=..."}`. Ctrl+C stops it. |
| `pnpm --filter @jobgoblin/server build` | Bundles `dist/server.mjs` with tsup (what Electron's utilityProcess runs). |
| `pnpm --filter @jobgoblin/server start` | Runs `node dist/server.mjs`. |
| `pnpm exec vitest run packages/server` | The tests. |
| `pnpm --filter @jobgoblin/server typecheck` | Type check. |

Start options come from flags or the environment (a flag wins). `JOBGOBLIN_APP_DATA` (`--app-data`) and `JOBGOBLIN_RESOURCES_DIR` (`--resources-dir`, default: the repository root) say where the data and the resources live; `JOBGOBLIN_PORT` (`--port`; `0` picks a free one; default 47615, then the next 20); `JOBGOBLIN_CLAUDE_COMMAND` and `JOBGOBLIN_CLAUDE_INSTALL_COMMAND` (JSON arrays of absolute paths); `JOBGOBLIN_FEED_FIXTURES` (read feeds from `fixtures/feeds/demo` and never touch the network); `JOBGOBLIN_DEV_ORIGIN` (the dashboard dev server, such as `http://localhost:5173`). The dashboard must be built (`pnpm --filter @jobgoblin/dashboard build`) for `/` to show it.

Try it without Claude Code or the network:

```powershell
$env:JOBGOBLIN_APP_DATA = "$env:TEMP\jobgoblin-try"
$env:JOBGOBLIN_FEED_FIXTURES = "$PWD\fixtures\feeds\demo"
pnpm --filter @jobgoblin/server dev
```

Inside Electron's `utilityProcess` the same program posts `{ type: "ready", port, sessionToken }` to `process.parentPort` instead of printing a line, answers `{ type: "shutdown" }` by stopping and exiting with code 0, and sends `{ type: "open-path", path, personFolder }` when `POST /api/open` accepts a path (see [apps/desktop/README.md](../../apps/desktop/README.md)).

**Start-up** (`startServer.ts`): create the app data folder and the log (`logs/server.log`, rotated at 10 MB, `Authorization` headers and profile values redacted); open the database (migrations from `resourcesDir`, a backup first when it already holds data); open the person's folder if one was chosen; seed the company list on the very first start; rewrite any missing approved resume file from the database (D19); mark runs that were `running` as interrupted; bind `127.0.0.1`; write `server.json` (port, pid, version, start time, no secrets); check for a daily backup now and hourly. **Quit** (`stop()`): close the port, cancel queued runs and stop running ones, write the tracker once more, close the database, remove `server.json`.

## What the launcher plugs in

`startServer.ts` has two marked plug-in points and `http/app.ts` two marked mount points. Nothing else in this package changes when the launcher and the MCP endpoint arrive.

1. **Recovery** (start-up): replace `recoverInterruptedRuns(ctx)` with the runner's `recoverLeftoverRuns(...)` (it also stops a leftover Claude process). The default only marks `running` runs interrupted, with "This run was interrupted". `waiting` runs have no process and are never touched.
2. **The launcher** (start-up): `ctx.launcher = createLauncher(ctx)` before the server listens. It implements `Launcher = { wake(): void; cancel(runId): Promise<void> }`. `wake()` claims the oldest `queued` run; `cancel` stops the process and records `cancelled`.
3. **`/api/claude`** and **`/mcp`** mount points in `http/app.ts`. The `auth` middleware has already checked the token and set `c.get("runId")` on `/mcp`; remove the two `not-available` placeholders below them.
4. **While a run goes**, the launcher uses what is already here: `ctx.runTokens.issue(runId)` and `.revoke(runId)`; `updateRun` from storage and `announceRun` (`services/changes.ts`) for status, pid, session id and step; `refreshFeeds(ctx)` before a hunt; `listRunTasks` and `tasksLeftPending` at the end; and **after** a hunt or paste run, `admitAfterHuntOrPaste(ctx)`.
5. **After a tailor run**, the one retry on sonnet is the launcher's: queue `ctx.runs.queueRun({ kind: "tailor", applicationIds, input, model: "sonnet", retryOf })` for the applications whose drafts never passed, raise `tailorAttempts` with `updateApplicationFields`, and when the retry also fails set `tailorError` to "Couldn't tailor this one: <reason>". `admitAfterHuntOrPaste` leaves an application with `tailorAttempts > 0` alone, and `requestTailor` resets it.
6. **MCP adapters** call the services in the table above and, after each call, set the run's step with `core.stepForTool` and announce the run.

## How it is tested

Tests sit next to the code and never use the network: they run on temporary app data and person folders, with `feedFixturesDir` set to `fixtures/feeds/demo` and the demo person Alex Rivera from `fixtures/profiles/alex-rivera.json`. `src/services/testSupport.ts` makes a context (`createTestContext`), a clock the test controls (`advanceTime`) and builders (`aScoredApplication`, `anApplicationAwaitingApproval`); `src/http/testSupport.ts` makes an app and a `call(path, options)` that sends a request the way the dashboard does.

| Where | What it proves |
| --- | --- |
| `auth/auth.test.ts` | Token compare, bearer header, run tokens issue and revoke |
| `http/app.test.ts` | The session token on every `/api` route (the list is read from the app, so a new route cannot skip it); the session token refused on `/mcp`; Host and Origin checks; the error shape; security headers |
| `http/sse.test.ts`, `http/static.test.ts` | Event framing and the ping; the dashboard's files, the router fallback and path traversal |
| `http/routes.test.ts` | Every area answers in the shape the dashboard parses; a full journey from review to Applied over HTTP; a multipart upload |
| `services/*.test.ts` | One file per use case: the demo feeds (4 shown, 2 filtered, 1 repeat), `recordFit` moves, a draft's truth trace returned as values, approve and re-approve, frozen PDF bytes, "I submitted" and a different file, skip and undo, the status route never reaching Applied, the company cap with four roles at one company, questions that re-queue, the queue's refusals, importing the sample resume, restoring a backup |
| `startServer.test.ts` | A real port; `server.json`; a clean stop; runs left going are marked interrupted |

## Decisions

Places where ARCHITECTURE.md (v2) was ambiguous or silent, and what this package does.

1. **Services return values for what a run can fix and throw for what a person must be told** (`serviceError.ts`). The HTTP layer maps the second kind to status codes; the MCP adapters map both to a `ToolReply`.
2. **`ServerContext` also holds the resume renderer** (`ctx.renderer`). Section 10 does not list it, but compiling the Typst template takes a moment, so one renderer is made at start-up and shared.
3. **Events and file writes come after the commit.** Anything that is not the database (events, the tracker, backups, the approved files in the person's folder) is done once the transaction has succeeded. A file that fails to write after an approval is logged; the PDF is safe in the database and is written again at the next start (D19).
4. **A paste run has no tasks.** It scores one job. Its input is `{ jobId, applicationId }`, as the playbook says, and it holds that application against a second run only until it has asked its question: it may still be finishing its last message when the person answers, and the answer must be able to start the next paste run. Tailor and answers runs hold an application through their tasks.
5. **`get_approved` returns one more field than its schema, `resume`** (the approved resume body). An answers run needs it to describe projects and experience truthfully; the data sheet holds only form fields. The service returns `GetApprovedForRunOutput` (exported from `answers.ts`, `GetApprovedOutput` plus `resume`); the tool adapter must advertise and return that shape, because `GetApprovedOutput` alone would strip the field. The body holds no contact details: they are printed from the contact section.
6. **The rubric version is the number on the first line of `playbooks/rubric.md`** (`<!-- rubric-version: 1 -->`). A file without that line is `unversioned`.
7. **Answering a question keeps the asking run's input and model**, so an edit note still reaches the new run, and a tailor retry that had moved up to sonnet does not fall back to haiku.
8. **Every profile write checks the live approvals** (`voidChangedApprovals`): the person's edit, a value a setup run fills in, and contact details found in an uploaded resume. An approval whose data sheet hash changed is voided and the application stays Approved until the person approves again (`re-approved` in the history, no status move, no second answers run).
9. **Restoring a backup swaps `ctx.db`** (the tracker, backups and feed cache take `() => ctx.db`, so they follow). The person's folder setting of this computer is kept. A run the backup remembers as `running` is marked interrupted, because no process of this session is behind it. A restore is refused while a run is going.
10. **Feeds are stored with their reason.** A posting the code filter drops, or that repeats a role already found, is still stored with `filtered_reason`, so it is never shown and never fetched and judged again. The first posting of a role wins the dedupe key. With the demo board that is 7 postings: 4 shown, 2 filtered, 1 repeat.
11. **A draft preview is rebuilt when the contact details changed**, because the header is part of the version id (D18). Approved PDFs are served from the frozen bytes only.
12. **`PUT /api/settings` changes only `concurrency`, `maxOpenPerCompany`, `reapplyDays`, `followUpDays` and `usageNoticeSeen`.** The folder has its own route, `setupComplete` changes only when setup finishes, and the Claude command is not a setting (D21). A key that is left out is not touched.
13. **The server has no route to read one run.** The dashboard learns about runs from `run.updated` events and from the run a click returns.
14. **The event stream opens with `: connected`**, so the browser has its response headers at once, then `: ping` every 15 seconds.
15. **Three packages stay outside the bundle and are listed as dependencies of this package.** Typst's native compiler, `pdfjs-dist` and `exceljs` cannot be bundled, and Node looks for them next to `dist/`, where pnpm links only what this package declares. They use the same version ranges as `render` and `storage`, so no new package is installed. `tsup.config.ts` excludes them with a pattern (a name in `noExternal` would otherwise win over `external`) and sets `removeNodeProtocol: false`, because tsup would turn `node:sqlite` into `sqlite`, which does not exist.
16. **`src/index.ts` exports only `startServer`, `readStartOptions` and the context types**, for tests and e2e helpers that start the server from TypeScript. The program is `main.ts`.
17. **Logs never hold a request body, query or header.** The request log is method, path, status and time; pino redacts `Authorization` and profile values as a second line of defence.
