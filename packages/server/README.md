# @jobgoblin/server

The local server of Jobgoblin: an HTTP API on `127.0.0.1` for the dashboard, the **services** (the use cases) behind it, the queue of Claude Code runs, and the runner that starts them. The dashboard talks to it over HTTP; a Claude Code run talks to it over MCP (`/mcp`), and every MCP tool is a thin adapter over one of the services described here.

Spec: [ARCHITECTURE.md](../../docs/poc/ARCHITECTURE.md) sections 7 to 11, and [CODE_STYLE.md](../../docs/poc/CODE_STYLE.md). This README covers the context, the services and the HTTP API. The runner has its own [README](src/runner/README.md). `src/mcp/` (the door a run calls back through) and `runner/launcher.ts` (what starts the runs) are described in "The MCP endpoint" and "The launcher" below.

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

Everything under `/api` needs the session token. The dashboard's own files (`apps/dashboard/dist`, with a fallback to `index.html` for the router's pages) need none: they hold no personal data. `/mcp` needs the token of a run that is `running` (any other token, including the session token, gets 401).

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
| Queue a run; the tasks inside a run | `runs.ts`, `runTasks.ts` | many (see below), the tool adapters |
| Find Jobs, cancel, retry, dismiss a run | `runLifecycle.ts` | `/api/runs` |
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

A run is a row in `runs` (status `queued`) plus one `run_tasks` row per application it works through. `queueRun(ctx, request)` (`services/runs.ts`) is the only way in: the person-facing services and the runner's `afterRun.ts` all call that one function. (There is no `ctx.runs`.)

| Who queues | Kind | Tasks | Input |
| --- | --- | --- | --- |
| `POST /api/runs` (`startHunt`; setup must be finished) | hunt | none | `{}` |
| `POST /api/import-resume` after a resume (`importResume`) | setup | none | `{}` |
| `POST /api/jobs` (`addPastedJob`) | paste | none | `{ jobId, applicationId }` |
| `admitAfterHuntOrPaste`, `requestTailor`, `requestEdit` | tailor | one per application | `{}` or `{ editNote }` |
| `approveApplication` | answers | the application | `{}` |
| `POST .../ask` (`startAsk`) | ask | none | `{ applicationId, question }` |
| `answerQuestion` | the kind that asked | that one application | the asking run's input, model and kind |
| `retryRun` (`runLifecycle.ts`) | the failed run's kind | its pending and failed tasks | its input, model, `retryOf` |
| `afterRun` (`runner/afterRun.ts`), when a tailor run left drafts that never passed | tailor | those applications, once, on sonnet | the run's input, `retryOf` |

The queue enforces three rules (tested in `runs.test.ts`; the lifecycle functions are tested in `runLifecycle.test.ts`):

- **An application sits in only one active run** (`queued`, `running` or `waiting` with work left). A tailor or answers run holds an application through its tasks; a paste run holds the application of its job, an ask run the one it was asked about. A second request is refused with "This application already has a run in progress."
- **One hunt and one setup at a time.** Uploading the resume twice reuses the setup run that is already waiting.
- **A single re-queued application joins** the oldest queued run of the same kind, model and input (D8), so three answers make one run, not three. A retry never joins.

`insertQueuedRun` is the database half, for a service that must queue inside its own transaction; it announces nothing, so the caller calls `announceQueuedRun(ctx, run)` after the commit. That function emits `run.updated` and calls `ctx.launcher?.wake()`. **The queue never starts a process.** Until a launcher is set, a queued run simply waits.

Inside a tailor or answers run, `nextTask` hands out the next pending task whose application has no open question (D17), and `completeTask` records `done`, `failed` or `waiting` and updates `progress_done` and `progress_total`. `waiting` is accepted only for an application that really has an open question.

`cancelRun` (`runLifecycle.ts`) asks the launcher to stop a `running` run, and finishes the job in the database itself if the launcher could not (a `queued` or `waiting` run has no process). `cancelRunsForShutdown` does the same for every run when Jobgoblin quits, except `waiting` runs, which have no process and keep their open question.

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

## The MCP endpoint

`POST /mcp` (`src/mcp/endpoint.ts`) is the only door a Claude Code run has into Jobgoblin. It speaks Streamable HTTP in stateless mode with plain JSON replies: every request gets a fresh `McpServer` and transport (`runServer.ts`) that are thrown away when the answer is sent. GET and DELETE answer 405.

How one tool call flows:

```
Claude Code run  --POST /mcp, Bearer <run token>-->  auth middleware      token -> runId (session token: 401)
  -> endpoint.ts       loads the run; not `running` -> 401
  -> runServer.ts      registers ONLY RUN_KIND_TOOLS[run.kind]  (anything else: "Tool x not found")
  -> the SDK           checks the input against the tool's zod schema
  -> defineTool.ts     sets the run's step (core.stepForTool) and emits run.updated
  -> the tool file     src/mcp/tools/<area>Tools.ts: one service call, and the `next` hint
  -> defineTool.ts     removes keys the output schema does not list; ServiceError / unexpected error -> ok:false
  <- content[0].text   a ToolReply as JSON
```

Files: `tools/defineTool.ts` (the one helper every tool uses), `tools/toolHelpers.ts` (`succeededWith`, `replyFromOutcome`, `assertRunMayUseApplication`), `tools/*Tools.ts` (profile, job, fit, tailor, answer, ask, task, status), `tools/allTools.ts` (a `Record` over every tool name, so a 22nd tool does not compile until it is listed). A tool is a few lines: name, description, input and output schemas, `readOnly`, and one call to a service.

`next` is the call the run should make next, so a run stays on its playbook (`"Call complete_task for this application with outcome done."`). After a refusal in a tailor or answers run it says to report the application as failed and call `next_task`.

## The launcher

`runner/launcher.ts` is the queue's engine; it only decides which run goes when. One run's launch is `runner/launchRun.ts` (the building blocks, in the order of [runner/README.md](src/runner/README.md)); how it ended is saved by `finishRun.ts`; what follows is `afterRun.ts`.

States of a run as the launcher moves it:

```
queued --wake()--> running   (claimed at once, before anything slow)
  hunt only: step "Checking job boards" while the feeds are fetched
  Claude Code missing or signed out                       --> blocked  (the queue pauses)
  process ends: done | waiting (a task awaits an answer) | failed | blocked (plan limit, signed out) | cancelled
```

- **Queue.** `wake()` starts the oldest `queued` runs while fewer than `settings.concurrency` (default 1) are active. A run is claimed (`status: running`) before it launches, and the launcher keeps an in-memory entry per run, so a run is never launched twice.
- **Blocked.** A run that ends `blocked` pauses the queue. Retrying it (a new queued run whose `retryOf` is a blocked run) or a successful `POST /api/claude/sign-in` (`launcher.resume()`) starts it again.
- **Cancel.** `cancel(runId)` takes the run's token away, asks the process tree to stop (`taskkill /T`, SIGTERM), forces it after 5 seconds, and resolves once the run is saved as `cancelled`. A cancel that arrives before the process exists is honoured before it is spawned.
- **Safety.** The `init` line is checked with `checkInitEvent`. A run with a tool it must not have is killed at once, its token is revoked, and it ends `failed`, "This run was stopped for safety".
- **After a run.** Hunt or paste: `admitAfterHuntOrPaste`. Tailor: an application whose task failed and whose draft never passed gets ONE retry run on sonnet (`tailorAttempts` 0 to 1, `retryOf` the first run); the second failure sets `tailorError` to "Couldn't tailor this one: <reason>". A cancelled or blocked run starts nothing.
- **Usage limit.** A `Run` has no field for the time a plan limit lifts, so `finishRun` writes it into the sentence: "Your Claude plan limit is reached. It resets at 3:41 PM."
- **Start-up.** `runner/startRunner.ts` runs `recoverLeftoverRuns` (only `running` runs; it stops a leftover Claude process after checking its program name), then creates the launcher; `startServer.ts` wakes it once the port is bound, because a run's `mcp.json` names the real port. Run folders older than 14 days are removed when the launcher is created.

`/api/claude` (`http/routes/claude.ts`): `GET /status`, `POST /install`, `POST /sign-in`, all through `createClaudeCli` with the start options' commands.

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
| `mcp/endpoint.test.ts` | For every run kind the tool list equals `RUN_KIND_TOOLS`; a tool outside the kind is refused; the session token and a finished run's token are refused; GET and DELETE answer 405; `get_profile` never returns contact, pay or EEO values; `get_job` wraps text and cannot be made to close the wrapper; `submit_resume_draft` returns errors as `ok: false` and keeps a run out of another run's application |
| `runner/launcher.test.ts` | The real fake claude against a real server: a hunt then an automatic tailor run (Awaiting approval, Long shot, Skipped); an invented bullet fixed by the errors; a question that leaves one application open and a re-queue when answered; one retry on sonnet and then `tailorError`; blocked, failed and safety stops; a paused queue and a retry; cancel with the process gone; recovery at start-up |
| `http/routes/claude.test.ts` | `/api/claude/status` as connected, signed-out and not-installed; sign-in resumes the queue |

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
18. **A tool's input shape is checked by the MCP SDK, before the adapter runs.** Every tool advertises its zod input schema, so a call with the wrong shape gets the SDK's error text (`isError: true`), not a `ToolReply`. Rules a run can fix (truth trace, banned terms, limits) are always `ToolReply` values. `submit_resume_draft` therefore never reaches the service's own `ResumeBody` check from MCP.
19. **The run's step is set before the tool runs, not after.** `submit_resume_draft` takes seconds to render, and the card should already say what is happening.
20. **Every tool reply passes through its output schema**, which drops keys it does not list. A service that returned too much (a contact detail, say) could not leak it. This is also why `get_approved` must use `GetApprovedForRunOutput` (decision 5).
21. **A hunt run is claimed (`running`) before its feeds are fetched,** so Today shows "Checking job boards" and no second launch can take it. The feeds are fetched before Claude Code is checked, which is the order the task gave; a signed-out Claude therefore costs one wasted (cached, polite) fetch.
22. **`Launcher` has a third method, `resume()`,** which a successful sign-in calls. Blocked runs pause the queue; a retry of the blocked run (`retryOf`) or `resume()` ends the pause.
23. **A plan limit's reset time is written into the run's outcome message** ("It resets at 3:41 PM."), in the computer's own time zone and language, because `Run` has no field for it.
24. **Recovery at start-up touches only `running` runs.** A `waiting` run has no process; it keeps its open question and the person's answer re-queues the work.
