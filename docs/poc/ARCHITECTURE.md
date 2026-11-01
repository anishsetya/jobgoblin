# Jobgoblin POC: architecture and build contract (v2)

This document turns the [tech spec](https://jobgoblin.atlassian.net/wiki/spaces/SD/pages/655361/Jobgoblin+tech+spec) (v6) and the [PRD](https://jobgoblin.atlassian.net/wiki/spaces/SD/pages/557057/Jobgoblin+PRD) (v3) into a buildable proof of concept. v2 folds in an architecture review; where this file and the spec disagree, the decision log says why. Read [CODE_STYLE.md](CODE_STYLE.md) before writing code.

## 1. Scope

The POC is the PRD's **stage 1, developer preview**: the desktop app run from source with dashboard, runner, P0 profile, discover, score, tailor, review and track.

| In the POC | Requirements |
| --- | --- |
| Setup wizard: detect Claude Code, one-click install (winget / macOS script) and sign-in (`claude auth login`), choose folder (and offer Restore when backups are found), import a resume and an optional LinkedIn PDF, confirm Your story, form answers, targets | S2, S3, S4 (folder only), P1-P5 |
| Find jobs from public feeds (Greenhouse, Lever, Ashby, HN, YC, RemoteOK, We Work Remotely), add a pasted job, never show a job twice | D1-D3 |
| Fit score with band, reason, matched items, gaps, flags; hard skips and flags from the person's targets | F1, F2 |
| One-page tailored resume from confirmed Your story only; version ids; frozen approved PDF; limits | T1, T2, T4 |
| Review one application at a time; approve, skip, request edit; frozen data sheet; answers after approval | A1-A4 |
| Open application with copy buttons; "I submitted" with proof | U1, U4 |
| Pipeline board and list; status moves; follow-ups; CSV and xlsx tracker | K1-K3 (no live Google Sheet) |
| Runs with live progress, cancel, per-application questions, usage notice, crash recovery | R1-R4 |
| Backups after changes and daily; restore | S5 |

**Out of the POC:** signed installers and auto-update (S1), the Chrome autofill extension and pairing (U2), auto-submit (U3), Word output (T3), the Google Drive switch, opt-in metrics, crash reports, bug-report zip, Export everything zip, API-key mode, nightly model checks. Real Claude Code is not installed on the build machine, so automated tests use the fake `claude` (D3); [REAL_CLAUDE_CHECKLIST.md](REAL_CLAUDE_CHECKLIST.md) is the manual check to run once on a machine with Claude Code.

## 2. Decision log

| # | Decision | Why |
| --- | --- | --- |
| D1 | **`node:sqlite`** instead of `better-sqlite3` + `drizzle-orm`. Plain numbered `.sql` migrations; small typed table modules map rows. Verified: Electron 45.2.1 embeds Node 24.22.1 with `node:sqlite`. | The spec's own fallback. `better-sqlite3` is built against one ABI, so Vitest (system Node) and Electron would need different builds. Plain SQL is easier to learn from than an ORM. |
| D2 | **Packages export TypeScript source** (`"exports": {".": "./src/index.ts"}`); no per-package build. The server runs with `tsx` in development and is bundled with `tsup` for Electron. Non-code resources (migrations, Typst templates, playbooks) are found through `resourcesDir`, never by a path relative to a source file. | One less build step, and bundling cannot break resource lookups. |
| D3 | **The fake `claude`** (`fixtures/fake-claude`) is a scripted MCP client built with `tsup` to `dist/cli.mjs`. It accepts the real launch flags, connects to `/mcp` with the run token, calls the tools a real run would, and prints `stream-json`. | Tests the server, tools, runner and dashboard end to end with no Claude plan. Built to JS because runs start in their own directory, where `tsx` cannot be found. |
| D4 | **Browser token from the URL fragment** (`/#token=<t>`) outside Electron; the dashboard reads it, keeps it in `sessionStorage`, and strips it from the address bar with `history.replaceState`. Inside Electron the preload exposes it, only to the server's own origin. | Lets Playwright drive plain Chromium. A fragment is never sent to the server or logged. |
| D5 | **Server-sent events are read with `fetch`**, not `EventSource`. | `EventSource` cannot send the `Authorization` header. |
| D6 | **The playbook goes to `claude -p` on stdin.** Line 1 is `<!-- run-kind: <kind> -->`, line 2 is `<!-- run-input: <RunInput JSON> -->`. | Avoids Windows quoting and length limits; gives every run its input in one known place. |
| D7 | **The master resume is built by code** (`core.buildMasterResume`) when setup finishes. | Deterministic and free. |
| D8 | **Answering a question re-queues that one application**: it joins a queued run of the same kind if there is one, otherwise a new run is queued. No `claude --resume`. | Simpler and identical after a restart. |
| D9 | **Feed results go into `jobs` only.** An application is created when a run calls `record_fit`, or when the person pastes a job. | Hundreds of feed jobs would otherwise flood the pipeline. |
| D10 | **Contact details are stripped from resume text by code before the setup run sees it.** `core.redactContactDetails` removes the header block (name, email, phone, location, links), puts what it found into the contact section, and leaves placeholders such as `{email}`. | The PRD promises contact details never reach Claude, and the resume is the first place they appear. |
| D11 | **Run status adds `cancelled`.** | Cancel needs a terminal state that is not `failed`. |
| D12 | **Review shows an HTML preview of the resume** with reworded lines highlighted, plus Open PDF. | An `<iframe>` cannot send the token, and a PDF cannot highlight changes. |
| D13 | **Resume font: New Computer Modern** (bundled with Typst) in place of XCharter. Verified on Windows. | Reproducible PDFs without installing fonts. |
| D14 | **Default port 47615**; on `EADDRINUSE` or `EACCES` (Hyper-V reserved ranges) try the next 20 ports; `--port 0` picks any free port (tests). | Fixed default with a fallback, as the spec asks. |
| D15 | **The per-company cap counts only `CAP_STATUSES`** (Tailored through Offer), excluding the application being checked; after a hunt, applications are admitted to tailoring in score order. | Otherwise four good roles at one company would block each other before any is tailored. |
| D16 | **Every transition names its `via`** (the action that makes it), and `assertTransition(from, to, actor, via)` checks it. | Without it, the generic status route could move an application to Applied with no approval and no proof. |
| D17 | **A question never changes an application's status.** An open question makes `next_task` skip that application and adds a Needs you item. `ask_person` exists for paste, tailor and answers runs only. | No status in the table means "waiting on the person", and adding one would touch every screen. |
| D18 | **Resume versions are split** into `resume_versions` (content, shared) and `application_resumes` (per application state). The version id hashes the body, the header and the template version. | Two applications with the same resume must not clash, and a new phone number must change the version. |
| D19 | **Approved PDF bytes are stored in the database too**, and folder paths are stored relative to the person's folder. | A failed file write or a restore on a second computer can always recreate the exact file. |
| D20 | **A 21st MCP tool, `get_application`** (read-only, ask runs). | The spec's 20 tools give an ask run no way to read the application it was asked about. |
| D21 | **The Claude command is a start option, never a setting.** | Otherwise `PUT /api/settings` would let a caller run any program. |

## 3. Repository layout

```
apps/desktop          Electron main + preload; starts the server in a utilityProcess
apps/dashboard        React dashboard and setup wizard (Vite); built into apps/dashboard/dist and served by the server
packages/schemas      zod schemas + types for every record, request, response, MCP tool and event
packages/core         pure rules: state machine, bands, limits, truth trace, banned terms, version ids, data sheet, master resume, diff, job filters, redaction, step text
packages/storage      node:sqlite database, migrations, table modules, the person's folder, tracker export, backups
packages/sources      job feed clients and parsers; polite fetch with a cache; URL-to-posting for pasted links
packages/render       Typst resume template, PDF render and read-back, resume text import (PDF and Word)
packages/server       Hono HTTP API, services (the use cases), MCP endpoint and tools, runner, Claude Code CLI
playbooks/            one prompt per run kind, the fit rubric, and subagent definitions
fixtures/             fake-claude, saved and demo feeds, sample resume, sample profile (see fixtures/README.md)
e2e/                  Playwright tests of every dashboard flow, plus one Electron smoke test
docs/poc/             this file, the code style guide, the real-Claude checklist
```

Dependency rules (`pnpm lint:deps`, dependency-cruiser):

- `core` imports only `schemas` and `node:crypto`.
- Only `storage` imports `node:sqlite` or writes the person's folder.
- Only `server/src/runner` (and `apps/desktop`, `fixtures`, `e2e`) imports `node:child_process`.
- Nothing imports `@anthropic-ai/*`, `openai` or another model SDK.
- `dashboard` imports only `schemas` from the workspace and reaches data only through HTTP.
- `sources` and `render` import only `schemas` from the workspace.

`resourcesDir` (D2) is the repository root in development. Paths inside it: `packages/storage/migrations/`, `packages/render/templates/`, `playbooks/`, `apps/dashboard/dist/`. The desktop build copies these into the same relative layout.

## 4. Vocabulary (use these words in code)

| Word | Meaning | In code |
| --- | --- | --- |
| Your story | Everything the person confirmed about themselves | `StoryItem`, table `story_items` |
| Run | One background Claude Code session started by a button | `Run`, `RunKind` |
| Run task | One application inside a run's work queue | `RunTask`, table `run_tasks` |
| Application | One job being pursued | `Application` |
| Data sheet | Every form field and value that will be sent | `DataSheet` (`data_sheet` in SQL; never "datasheet") |
| Approval | The person's approval of one exact data sheet and resume file | `Approval` |
| Submission | Proof that the application was sent | `Submission` |
| Needs you | Anything waiting on the person | `NeedsYouItem` |
| History event | One row of the change log | `HistoryEvent` (not `Event`, which the browser already defines) |
| Person's folder | The folder the person chose, `Documents/Jobgoblin` by default | `PersonFolder` |
| App data folder | `%APPDATA%\Jobgoblin` or `~/Library/Application Support/Jobgoblin`; tests use a temp dir | `appDataDir` |

## 5. Shared contracts (`packages/schemas`)

Every type is a zod schema with an inferred type of the same name. Timestamps are UTC ISO-8601 strings (`z.iso.datetime()`); calendar days (follow-ups) are `YYYY-MM-DD` (`z.iso.date()`).

### 5.1 `status.ts`

- `ApplicationStatus`: exactly the spec's 20 states: Found, Scored, Skipped (low fit), Long shot, Tailored, Awaiting approval, Skipped, Approved, Filling, Needs your input, Applied, OA, Phone screen, Onsite, Offer, Rejected, Ghosted, Withdrawn, Accepted, Declined.
- `Actor`: person, run, server, extension.
- `TransitionVia`: `record_fit`, `submit_resume_draft`, `approve`, `submitted`, `skip`, `undo_skip`, `request_edit`, `withdraw`, `status`, `server`, `extension`.
- `TERMINAL_STATUSES`: Skipped (low fit), Skipped, Rejected, Ghosted, Withdrawn, Declined, Accepted.
- `CAP_STATUSES` (D15): Tailored, Awaiting approval, Approved, Filling, Needs your input, Applied, OA, Phone screen, Onsite, Offer.
- `STATUS_GROUPS`: the Pipeline board columns (To review, Ready to apply, Applied, Interviewing, Offer, Closed).

### 5.2 `story.ts`

```ts
StoryItemKind = "experience" | "project" | "education" | "achievement" | "skill" | "headline"
StoryItemStatus = "pending" | "confirmed" | "rejected"
StoryItemData = { text, title?, organization?, location?, startDate? /* YYYY-MM | YYYY */, endDate? /* or "Present" */, tools: string[], numbers: string[] }
StoryItem = { id, kind, parentId: string | null, status, data: StoryItemData, keywords: string[], createdAt, updatedAt }
ProposedStoryItem = { tempId, parentTempId: string | null, kind, data, keywords }   // a run nests achievements under an experience it proposes in the same call
```

### 5.3 `profile.ts`

```ts
TODO = "TODO"
ContactSection = { fullName, email, phone, location, linkedin, github, portfolio }                       // personal
WorkAuthorizationSection = { regions: Record<string, { authorized, requiresSponsorship, willingToRelocate }> }  // boolean | "TODO"
EmploymentSection = { currentEmployer, currentTitle, noticePeriod, earliestStartDate, yearsExperience }
CompensationSection = { expectedBase }                                                                   // personal
EeoSection = { gender, raceEthnicity, veteranStatus, disability }   // default "Decline to self-identify"; personal
TargetsSection = { roles: string[], regions: string[], tracks: string[], maxYearsRequired: number /* 4 */, rolesToAvoid: string[], hardSkips: string[], flags: string[] }
RulesSection = { bannedTerms: string[] }
ProfileSectionName = contact | workAuthorization | employment | compensation | eeo | targets | rules
PERSONAL_SECTIONS = [contact, compensation, eeo]
Profile = all seven sections (Profile.parse({}) gives a fresh profile)
MissingValue = { section, key, label }
ProfileResponse = { profile: Profile, missing: MissingValue[] }
```

`hardSkips` defaults to `["An active security clearance is required"]`; `flags` to `["Relocation required", "Graduation-year window"]`. Targets and rules are rows of the `profile` table like every other section.

### 5.4 `job.ts`

```ts
Region = "US" | "IN" | "REMOTE" | "OTHER"
JobSource = "greenhouse" | "lever" | "ashby" | "hn" | "yc" | "remoteok" | "wwr" | "web" | "pasted"
Job = { jobId /* "<source>:<slug>:<id>" */, dedupeKey, source, company, title, location, region, url: string | null, text, questions: string[], postedAt: string | null, foundAt, seenAt: string | null, filteredReason: string | null }
FeedPosting = Job without dedupeKey, region, foundAt, seenAt, filteredReason   // what packages/sources returns; the server adds the rest with core
Company = { id, name, ats: "greenhouse" | "lever" | "ashby", slug, status: "Watching" | "Suggested" | "Passed" }
```

### 5.5 `fit.ts`

```ts
Band = "apply" | "stretch" | "long-shot" | "skip"   // 75+, 60-74, 50-59, under 50
FitInput = { jobId, score: 0-100, track, mustHaves: string[], gaps: string[], flags: string[], matchedItemIds: string[], reason /* one line */, hardSkip: string | null }
Fit = FitInput + { applicationId, band, rubricVersion, createdAt }
```

### 5.6 `resume.ts`

```ts
SourcedText = { src /* story item id */, text }
ResumeEntry = { src /* experience or project id */, bullets: SourcedText[] }
ResumeBody = { headline: SourcedText | null, sections: { experience: ResumeEntry[], projects: ResumeEntry[] }, skills: SourcedText[], education: { src }[] }
ResumeHeader = { fullName, email, phone, location, links: string[] }   // filled by code from the contact section, never by a run
ResumeCheckErrorCode = "schema" | "untraced" | "changed-fact" | "inflated-verb" | "banned" | "cap" | "pages" | "banned-in-pdf"
ResumeCheckError = { code, path /* "sections.experience[0].bullets[2]" */, message /* plain words a run can act on */ }
ResumeVersion = { versionId /* "r-" + 64 hex */, shortId /* "r-" + 8 hex */, body, headerHash, templateVersion, createdAt }
ApplicationResume = { applicationId, versionId, shortId, state: "draft" | "approved", pdfSha256: string | null, createdAt }
ResumeDiff = { added: string[], removed: string[], reordered: boolean, reworded: { src, from, to }[] }
```

### 5.7 `application.ts`, `dataSheet.ts`, `submission.ts`

```ts
SubmitMode = "manual" | "extension"            // the POC builds manual only
Application = { id, jobId, company, title, status, fitScore, band, resumeVersion, submitMode, folder /* relative to the person's folder */, appliedAt, followUpOn, tailorAttempts, tailorError, createdAt, updatedAt }
DataSheetKey = fullName | firstName | lastName | email | phone | location | linkedin | github | portfolio | workAuthorized | requiresSponsorship | willingToRelocate | noticePeriod | earliestStartDate | yearsExperience | currentEmployer | currentTitle | expectedBase | gender | raceEthnicity | veteranStatus | disability | resumeFileName | resumeVersion
DataSheetField = { key: DataSheetKey, label, value, personal: boolean, required: boolean, missing: boolean }
DataSheet = { applicationId, region, fields: DataSheetField[], resumeVersion, resumeFileName /* "First Last - Resume.pdf" */ }
Approval = { id, applicationId, dataSheet, dataSheetHash, resumeVersion, pdfSha256, submitMode, approvedAt, usedAt, voidedAt }
ProofType = "confirmation-page" | "pasted-text" | "screenshot" | "email-subject" | "person-saw-it"
Submission = { id, applicationId, resumeVersion, attachedSha256, proofType, proof, submittedAt }
Answer = { question, answer }
```

Required data sheet keys: fullName, email, phone. Personal keys: the contact keys, expectedBase, and the four EEO keys. Work authorization values come from the job's region (falling back to `US`).

### 5.8 `run.ts`

```ts
RunKind = "setup" | "hunt" | "paste" | "tailor" | "answers" | "ask"
RunStatus = "queued" | "running" | "waiting" | "done" | "failed" | "blocked" | "interrupted" | "cancelled"
ModelTier = "haiku" | "sonnet" | "opus"
RunInput = { jobId?: string, applicationId?: string, question?: string, editNote?: string }
Run = { id, kind, status, model, input: RunInput, sessionId, pid, step, progressDone, progressTotal, outcomeMessage, resultText, retryOf, queuedAt, startedAt, endedAt, dismissedAt }
RunTaskState = "pending" | "done" | "failed" | "waiting"
RunTask = { runId, applicationId, state, note }
Question = { id, runId, runKind, applicationId, text, answer, askedAt, answeredAt }
StartRunRequest = { kind: "hunt" }        // other runs start from their own routes
RUN_KIND_SETTINGS: Record<RunKind, { model, maxTurns, timeoutMinutes, builtInTools: string[] }>   // the table in section 10
```

### 5.9 `api.ts`

```ts
ApiError = { code, message, action }
NeedsYouKind = "review" | "question" | "ready-to-submit" | "long-shot" | "not-tailored" | "follow-up-due" | "run-attention"
NeedsYouItem = { kind, id, applicationId, runId, title, detail, createdAt }
TodayResponse = { needsYou: NeedsYouItem[], running: Run[], doneToday: { found, tailored, approved, applied }, setupComplete: boolean, usageNoticeSeen: boolean }
PipelineRow = Application + { overdue: boolean, location, region }
ApplicationActions = { canApprove, canSkip, canUndoSkip, canRequestEdit, canTailor, canWithdraw, canMarkSubmitted, canAsk }   // booleans computed by the server with core
ApplicationDetail = { application, job, fit, resume: ResumeVersion | null, resumeHeader: ResumeHeader | null, versions: ApplicationResume[], diff: ResumeDiff | null, storyItems: StoryItem[] /* items the resume cites plus items the fit matched */, dataSheet: DataSheet | null, dataSheetHash: string | null, approval: Approval | null, answers: Answer[], submission: Submission | null, questions: Question[], history: HistoryEvent[], askResults: { question, answer, at }[], allowedStatusMoves: ApplicationStatus[], actions: ApplicationActions }
ApproveRequest = { dataSheetHash, submitMode: "manual" }
SubmittedRequest = { proofType, proof, attachedSha256: string | null, confirmDifferentFile?: boolean }
StatusChangeRequest = { to, followUpOn?: string | null, note?: string }
AddJobRequest = { url?, text?, company?, title?, location? }   // url or text; company and title required with text
AddJobResponse = { applicationId: string | null, runId: string | null, needsText: boolean, message }
ClaudeStatus = { state: "connected" | "not-installed" | "update-needed" | "signed-out", version, minimumVersion, installCommand, signInCommand, plan }
Settings = { personFolder, concurrency: 1 | 2, maxOpenPerCompany /* 3 */, reapplyDays /* 90 */, followUpDays /* 7 */, usageNoticeSeen, setupComplete }
SettingsResponse = Settings + { lastBackupAt, trackerStatus: "ok" | "locked" | "off", dataFolder /* app data folder, shown read-only */ }
ChooseFolderResponse = { settings: SettingsResponse, backupsFound: Backup[] }
Backup = { id /* file name */, createdAt, sizeBytes }
HistoryEvent = { id, ts, actor, applicationId, type, from, to, detail }
```

History event types: `status-changed`, `tailor-requested`, `resume-drafted`, `approved`, `re-approved`, `approval-voided`, `question-asked`, `question-answered`, `answers-saved`, `submitted`, `note`.

### 5.10 `events.ts`

```ts
ServerEvent =
  | { type: "run.updated", run: Run }
  | { type: "application.updated", applicationId, status }
  | { type: "needs-you.changed" }
  | { type: "profile.updated" }
  | { type: "backup.done", at }
```

Wire format: `data: <json>\n\n` per event, and a `: ping` comment every 15 seconds.

### 5.11 `mcp.ts`

`mcp.ts` only re-exports; the schemas are in `mcp/<area>.ts`, one file per area of `packages/server/src/mcp/tools/*Tools.ts`.

`MCP_TOOL_NAMES` (21, D20), one input schema and one **output schema** per tool (section 9), `RUN_KIND_TOOLS`, and:

```ts
ToolError = { code, message, path?: string }        // ResumeCheckError fits this shape
ToolReply<T> = { ok: true, data: T, next: string | null } | { ok: false, errors: ToolError[], next: string | null }
```

## 6. Pure rules (`packages/core`)

No file or network access. Rule failures the caller must show are returned as values; programming or permission mistakes throw `CoreError(code, message)`.

| File | Exports |
| --- | --- |
| `stateMachine.ts` | `TRANSITIONS: { from, to, actors, via }[]` (section 6.1); `canTransition(from, to, actor, via)`; `assertTransition(from, to, actor, via)`; `allowedMoves(from, actor, via)`; `statusBeforeSkip(history: HistoryEvent[])` |
| `bands.ts` | `bandFor(score)`; `statusAfterFit(fit)`: hard skip or under 50 → Skipped (low fit); 50-59 → Long shot; 60+ → Scored |
| `limits.ts` | `checkLimits({ applicationId, company, dedupeKey, others: { id, company, dedupeKey, status, appliedAt }[], now, maxOpenPerCompany, reapplyDays })` → `ResumeCheckError | null` (code `cap`); counts only `CAP_STATUSES` and never the application itself; reapply rule: the same dedupe key reached Applied or later within `reapplyDays`. `admitInScoreOrder(candidates, existing, limits)` → `{ admitted, refused: { applicationId, message }[] }` |
| `truthTrace.ts` | `traceResume(body, storyItems)` → `ResumeCheckError[]` (section 8.2); `STRONG_VERBS`; `extractFacts(text, vocabulary)` |
| `bannedTerms.ts` | `findBannedTerms(texts: { path, text }[], bannedTerms)` → `ResumeCheckError[]` (code `banned`, or the code passed in, so the PDF check reports `banned-in-pdf`) |
| `versionId.ts` | `canonicalJson(value)`, `sha256Hex(stringOrBytes)`, `resumeVersionId(body, headerHash, templateVersion)`, `shortVersionId(id)`, `headerHash(header)` |
| `dataSheet.ts` | `buildDataSheet({ applicationId, profile, region, resumeVersion })`, `hashDataSheet(sheet)`, `requiredMissing(sheet)`, `placeholderDataSheet(sheet)` (personal values replaced by `{key}`), `fillPlaceholders(text, sheet)` |
| `masterResume.ts` | `buildMasterResume(storyItems)`: confirmed items only; experiences newest first with up to 4 achievements each; up to 2 projects with up to 2 achievements; the first confirmed headline; up to 12 skills; all education |
| `resumeDiff.ts` | `diffAgainstMaster(tailored, master)` → `ResumeDiff` |
| `jobFilters.ts` | `dedupeKey(company, title, location)`, `classifyRegion(location)`, `codeFilter(posting, targets)` → `{ passes: true } | { passes: false, reason }` (roles to avoid by title, years required above the limit, region outside targets) |
| `redaction.ts` | `redactContactDetails(text)` → `{ redacted, found: Partial<ContactSection> }` (D10) |
| `stepText.ts` | `stepForTool(toolName)` and `STEP_CHECKING_JOB_BOARDS`: plain words for run cards |

### 6.1 Transition table

| From | To | Actors | Via |
| --- | --- | --- | --- |
| (new) | Found | run, server | record_fit, server |
| Found | Scored | run | record_fit |
| Scored | Skipped (low fit), Long shot | server | record_fit |
| Scored, Long shot | Tailored | run | submit_resume_draft |
| Tailored | Awaiting approval | server | submit_resume_draft |
| Awaiting approval | Tailored | person | request_edit |
| Awaiting approval | Skipped | person | skip |
| Awaiting approval | Approved | person | approve |
| Approved | Filling | extension | extension |
| Filling | Needs your input | extension | extension |
| Needs your input | Filling | person | extension |
| Approved, Filling | Applied | person, extension | submitted |
| Applied | OA, Phone screen, Onsite | person, run | status |
| OA | Phone screen, Onsite | person | status |
| Phone screen | Onsite | person | status |
| Onsite | Offer | person | status |
| Applied, OA, Phone screen, Onsite | Rejected, Ghosted | person (server may only suggest Ghosted) | status |
| Found through Needs your input, Applied, OA, Phone screen, Onsite, Offer | Withdrawn | person | withdraw |
| Offer | Accepted, Declined | person | status |
| Skipped, Skipped (low fit) | the status before the skip | person | undo_skip |

Scored also moves to Skipped by the person (via `skip`) so a scored job can be dismissed before tailoring. `(new) → Found` is represented as `from: null`.

## 7. Storage (`packages/storage`)

```ts
interface Database { sqlite: DatabaseSync; transaction<T>(fn: () => T): T; close(): void }
openDatabase({ appDataDir, migrationsDir, backupBeforeMigrate: (db) => void }): Database
```

- WAL mode and foreign keys on; `BEGIN IMMEDIATE … COMMIT`, rollback on throw. Transactions are synchronous: do async work (rendering, fetching) before or after, never inside.
- Migrations: `migrations/0001_initial.sql` onwards, tracked with `PRAGMA user_version`; a backup runs before migrating an existing database; a database newer than the app refuses to open with "Update Jobgoblin to open your data."
- `CHECK (status IN (...))` lists are written literally in SQL; a test compares them with `ApplicationStatus.options` and `RunStatus.options`.
- Triggers block `UPDATE` and `DELETE` on `history_events`.

Tables:

| Table | Columns |
| --- | --- |
| `profile` | section PK, data JSON, updated_at (all seven sections, including targets and rules) |
| `story_items` | id PK, kind, parent_id, status, data JSON, keywords JSON, created_at, updated_at |
| `master_resume` | id = 1, body JSON, updated_at |
| `uploads` | id, kind (resume, linkedin), file_name, redacted_text, uploaded_at |
| `companies` | id, name, ats, slug, status |
| `jobs` | job_id PK, dedupe_key (indexed), source, company, title, location, region, url, text, questions JSON, posted_at, found_at, seen_at, filtered_reason |
| `feed_cache` | url PK, etag, last_modified, body, fetched_at |
| `applications` | id PK, job_id FK, company, title, status CHECK, fit_score, band, resume_version, submit_mode, folder, applied_at, follow_up_on, tailor_attempts, tailor_error, created_at, updated_at |
| `fits` | application_id PK, score, band, track, must_haves, gaps, flags, matched_item_ids, reason, hard_skip, rubric_version, created_at |
| `resume_versions` | version_id PK, body JSON, header_hash, template_version, created_at |
| `application_resumes` | application_id, version_id, state, pdf_sha256, pdf_bytes BLOB (approved only), created_at; PK (application_id, version_id) |
| `approvals` | id, application_id, data_sheet JSON, data_sheet_hash, resume_version, pdf_sha256, submit_mode, approved_at, used_at, voided_at |
| `submissions` | id, application_id, resume_version, attached_sha256, proof_type, proof, submitted_at |
| `answers` | application_id, question, answer, saved_at |
| `runs` | id, kind, status CHECK, model, input JSON, session_id, pid, step, progress_done, progress_total, outcome_message, result_text, retry_of, queued_at, started_at, ended_at, dismissed_at |
| `run_tasks` | run_id, application_id, state, note; PK (run_id, application_id) |
| `questions` | id, run_id, run_kind, application_id, text, answer, asked_at, answered_at |
| `history_events` | id, ts, actor, application_id, type, from_status, to_status, detail |
| `settings` | key PK, value JSON |

Table modules: one file per table group under `src/tables/`, exporting plain functions that take `db` first and return schema types (`insertApplication(db, …)`, `getApplication(db, id)`, `listApplications(db, query)`). Status changes go through one function:

```ts
updateApplicationStatus(db, { applicationId, from, to, actor, type, detail }): void
// UPDATE … WHERE id = ? AND status = from (throws StaleStatusError when no row changed), then inserts the history event.
// It does not decide whether the move is allowed: the caller has already called core.assertTransition.
```

Person's folder (`src/personFolder.ts`):

```ts
createPersonFolder(root): PersonFolder
PersonFolder = { root, ensureLayout(), applicationFolderName(date, company, title) /* ≤ 80 chars, file-system safe, " (2)" on collision */, writeJobDescription(folder, markdown), writeAnswers(folder, markdown), writeApprovedResume({ bytes, shortId, folder, fileName }) /* writes Resumes/<shortId>.pdf once (reuses an identical existing file, refuses a different one) and copies it into the folder */, absolutePath(relative), isInside(path), isCloudSynced() /* Google Drive, My Drive, OneDrive, Dropbox, iCloud, CloudStorage */ }
fileSha256(path): string
```

Tracker (`src/tracker.ts`): `createTrackerExporter({ db, folder, now })` → `{ schedule(), flushNow(), status() }`. Debounce 2 s (60 s when the folder is cloud-synced). Writes `Tracker.csv` (header first) and `Tracker.xlsx` (Applications sheet + Read me sheet) through a temp file and rename; on `EBUSY`/`EPERM` status becomes `locked` and it retries in 30 s. Columns: Company, Role, Status, Fit, Band, Resume version, Applied on, Follow up on, Posting, Folder, Updated.

Backups (`src/backups.ts`; file names and retention are in `src/backupFiles.ts`): `createBackups({ getDb, folder, now })` → `{ backupNow(reason), scheduleAfterChange() /* at most every 5 minutes */, runDailyIfDue(), list(), restore(id, reopen) }`. `VACUUM INTO` a temp file in `Backups/`, then rename to `YYYY-MM-DD HH-mm.jobgoblin-backup` (add `-2` on collision). Retention: everything from the last 2 days, one per day for 14 days. `restore` checks the id against the file-name pattern, backs up the current database first, closes it, copies the backup over it, reopens it, and keeps the current `personFolder` setting.

`verifyApprovedFiles(db, folder)` at startup rewrites any missing approved file from `application_resumes.pdf_bytes` (D19).

## 8. Resume pipeline

### 8.1 Render (`packages/render`)

```ts
TEMPLATE_VERSION = "t1"
createResumeRenderer({ templatesDir }): { renderResumePdf(input: { header, body, storyItems, versionId }): Promise<Uint8Array> }
readPdf(bytes): Promise<{ pages: number, text: string }>
extractResumeText(bytes, fileName): Promise<string>        // PDF (pdfjs-dist) or Word (mammoth)
```

The template (`templates/t1/resume.typ`) ports the prototype's `resume/design.yaml`: Jake's resume layout, one column, US letter, 0.5 in top and bottom and 0.6 in side margins, New Computer Modern, small-caps section titles with a full rule, company and location on row one, title and dates on row two. Data goes in as JSON through `sys.inputs`; untrusted text is never concatenated into Typst markup. The PDF's metadata carries the version id.

### 8.2 Truth trace rules (`core/truthTrace.ts`)

For every part of `ResumeBody`:

1. `src` exists in Your story with status `confirmed`, else `untraced`.
2. The kind fits the slot: experience entries cite `experience`; project entries cite `project`; bullets cite an `achievement` whose `parentId` is that entry's `src`; the headline cites a `headline`; skills cite a `skill` with the same text ignoring case and spacing; education cites `education`. Otherwise `untraced`.
3. Facts in the text must appear in the cited item (text, title, organization, tools, numbers, dates) or, for a bullet, its parent entry: numbers and percentages (`40%`, `3x`, `$2M`, `500`), years and month-year dates, named tools (anything that is a tool or skill anywhere in Your story, plus a built-in list of common technologies), job titles and organization names (any title or organization that appears in Your story). Otherwise `changed-fact`.
4. A strong verb (`led, owned, built, designed, launched, managed, architected, founded, created, spearheaded, directed, headed, drove, established, pioneered, mentored, scaled, shipped`, in any tense) must also appear in the cited item, else `inflated-verb`.
5. Messages are short and say what to fix: `Bullet 3 of Northwind Logistics says "led", but your story says "contributed to". Use the story's verb.`

### 8.3 Starting tailoring

- After a hunt or paste run ends, `admitInScoreOrder` picks Scored applications with band apply or stretch; admitted ones get one tailor run, refused ones get `tailor_error` with the plain cap message (Needs you kind `not-tailored`).
- `POST /api/apps/:id/tailor` (person) accepts Scored or Long shot, runs `checkLimits` first (ApiError `cap`), logs a `tailor-requested` event, and queues a tailor run.
- `POST /api/apps/:id/request-edit { note }` moves Awaiting approval → Tailored (person, via request_edit) and queues a tailor run with `input.editNote`.
- An application may sit in only one active (queued, running or waiting) run at a time.

### 8.4 Submit a draft (`server/services/resumes.ts`)

`submitResumeDraft(ctx, { applicationId, body })`:

1. Parse with the schema (`schema`); refuse a Long shot that has no `tailor-requested` event.
2. `traceResume`, then `findBannedTerms` over every text, then `checkLimits` as a backstop.
3. Build the header from the contact section; `versionId = resumeVersionId(body, headerHash(header), TEMPLATE_VERSION)`.
4. Render the preview PDF and `readPdf` it: exactly one page (`pages`), and `findBannedTerms` over its text (`banned-in-pdf`).
5. One transaction: insert `resume_versions` if new; insert or keep `application_resumes` (draft); set `applications.resume_version`; move Scored or Long shot → Tailored (run) → Awaiting approval (server), or Tailored → Awaiting approval for a request edit; history event `resume-drafted`.
6. Return `{ versionId, shortId, status }`, or `ok: false` with every error at once so the run can fix them in one go.

Draft previews live in `<appData>/previews/<versionId>.pdf`, rebuilt freely and never sent anywhere but the dashboard.

### 8.5 Approve (`server/services/approvals.ts`)

`approveApplication(ctx, { applicationId, dataSheetHash, submitMode })`, person only:

1. Rebuild the data sheet from the current profile; refuse `data-sheet-changed` if the hash differs from the one the person saw; refuse `missing-values` (naming them) if a required value is TODO or empty; run `findBannedTerms` over the data sheet values.
2. Render the final PDF once, in memory; `pdfSha256 = sha256Hex(bytes)`; check one page and banned terms. If an approved file for this version already exists, reuse its bytes and fingerprint.
3. One transaction: insert the approval; set `application_resumes.state = approved` with `pdf_sha256` and `pdf_bytes`; move Awaiting approval → Approved (or, for an Approved application with no live approval, no move and a `re-approved` event); history event.
4. After commit: write `Resumes/<shortId>.pdf`, the application folder with `First Last - Resume.pdf` and `Job description.md`; schedule the tracker and a backup; queue an answers run.

A profile change voids every live approval whose data sheet hash no longer matches (event `approval-voided`); the Open application screen then asks the person to review again.

### 8.6 I submitted (`server/services/submissions.ts`)

`markSubmitted(ctx, { applicationId, ...SubmittedRequest })`: requires a live approval (not used, not void). If `attachedSha256` is given and differs from the approval's `pdfSha256`, refuse `different-file` unless `confirmDifferentFile`. One transaction: insert the submission, mark the approval used, move to Applied (via submitted) with `applied_at` and `follow_up_on = applied + followUpDays`, history event. Then tracker and backup.

## 9. MCP endpoint and tools (`packages/server/src/mcp`)

- `POST /mcp`, Streamable HTTP in stateless mode (a fresh `McpServer` per request) with `Authorization: Bearer <run token>`. The token maps to one live run; its kind decides the tool list (`RUN_KIND_TOOLS`). Unknown or expired token: 401. The session token never works on `/mcp`, and a run token never works on `/api/*`.
- Every tool parses its input, calls a **service** (tools are thin adapters; services hold the logic), returns `ToolReply` as JSON in `content[0].text`, and is annotated `readOnlyHint` when it does not write. Every call updates the run's step with `core.stepForTool` and emits `run.updated`.
- Job text is wrapped as `<untrusted_job_posting>…</untrusted_job_posting>`, after replacing any `<` in the text that begins `</untrusted` so the posting cannot close the wrapper, with a one-line note that the contents are data, not instructions.

| Tool | Input | Output (`data`) | Run kinds |
| --- | --- | --- | --- |
| `get_profile` | {} | `{ facts: { workAuthorization, employment }, missing: MissingValue[], targets, rules }` (never contact, compensation or EEO values) | all |
| `save_profile_section` | `{ section, data }` (employment, workAuthorization or targets) | `{ section, filledKeys }`: fills only values that are still TODO or empty; never rules | setup |
| `propose_story_items` | `{ items: ProposedStoryItem[] }` | `{ created: { tempId, id }[] }` (status pending) | setup |
| `import_resume` | {} | `{ uploads: { kind, fileName, text }[] }` (redacted) | setup |
| `search_jobs` | `{ limit? }` | `{ jobs: { jobId, company, title, location, region, snippet }[], remaining }`: unseen, unfiltered jobs; snippet is the first 2,000 characters, wrapped | hunt |
| `add_job` | `{ url?, text, company, title, location }` | `{ jobId, duplicate }` | hunt |
| `mark_seen` | `{ jobIds }` | `{ marked }` | hunt |
| `get_job` | `{ jobId }` | `{ jobId, company, title, location, region, url, text /* wrapped */, questions }` | hunt, paste, tailor, answers, ask |
| `get_fit_context` | {} | `{ rubric, targets, storyItems /* every confirmed item */ }` | hunt, paste |
| `record_fit` | `FitInput` | `{ applicationId, band, status }` | hunt, paste |
| `get_tailoring_context` | `{ applicationId }` | `{ application: { id, company, title }, master: ResumeBody, storyItems, mustHaves, gaps, bannedTerms, jobSummary, editNote, answeredQuestions: Answer[] }` | tailor |
| `submit_resume_draft` | `{ applicationId, body }` | `{ versionId, shortId, status }` or errors | tailor |
| `save_answers` | `{ applicationId, answers }` | `{ saved }` | answers |
| `list_ready` | {} | `{ applications: { applicationId, company, title, fitScore, band }[] }` | ask |
| `get_approved` | `{ applicationId }` | `{ application, jobSummary, questions, dataSheet /* personal values as "{key}" */, answeredQuestions, resume /* the approved ResumeBody, no contact details */ }` | answers |
| `update_status` | `{ applicationId, to }` | `{ status }` (via status, actor run) | none in the POC |
| `get_pipeline` | {} | `{ counts: Record<status, number>, rows: { applicationId, company, title, status, fitScore }[] }` | ask |
| `get_application` | `{ applicationId }` | `{ application, job: { company, title, location, url }, fit, resume: ResumeBody \| null, answers, history }` | ask |
| `ask_person` | `{ applicationId, question }` | `{ questionId }`; `next` says to call `complete_task` with outcome `waiting` and move on | paste, tailor, answers |
| `next_task` | {} | `{ applicationId: string \| null }`: the next pending task whose application has no open question | tailor, answers |
| `complete_task` | `{ applicationId, outcome, note? }` | `{ done, total }` | tailor, answers |

`record_fit` is one transaction: create the application in Found (server) if absent, move Found → Scored (run), then Scored → Skipped (low fit) or Long shot (server) when the band says so; refuse `already-scored` if the application is past Scored; mark the job seen. A hard skip records score 0.

`save_answers` checks banned terms, stores the answers with placeholders intact, and writes `Answers.md` with `fillPlaceholders` applied, so the run never sees the real values.

## 10. Runner (`packages/server/src/runner`)

| Kind | Started by | Model | Built-in tools | Max turns | Timeout |
| --- | --- | --- | --- | --- | --- |
| setup | `POST /api/import-resume` | sonnet | none | 40 | 10 min |
| hunt | Find jobs | sonnet; screener subagent haiku | `WebSearch`, `WebFetch`, `Agent` | 120 | 30 min |
| paste | `POST /api/jobs` | haiku | none | 15 | 5 min |
| tailor | after hunt or paste, Tailor, Request edit | haiku; one retry on sonnet | none | 80 | 20 min |
| answers | Approve | sonnet | none | 30 | 10 min |
| ask | Ask about this application | sonnet | none | 20 | 5 min |

Interfaces shared with the services:

```ts
type ServerContext = { db: Database; folder: PersonFolder | null; bus: EventBus; now: () => Date; appDataDir: string; resourcesDir: string; tracker: TrackerExporter; backups: Backups; logger: Logger; options: StartOptions }
type EventBus = { emit(event: ServerEvent): void; subscribe(listener: (event: ServerEvent) => void): () => void }
type QueueRunRequest = { kind: RunKind; applicationIds: string[]; input: RunInput; model?: ModelTier; retryOf?: string }
type StartOptions = { appDataDir; resourcesDir; port; claudeCommand: string[] | null; claudeInstallCommand: string[] | null; feedFixturesDir: string | null; devOrigin: string | null }
```

`queueRun(ctx, request)` (`services/runs.ts`) is the only way a run enters the queue. It inserts the run and its `run_tasks`, joins an already queued run of the same kind when the request is a single re-queued application, refuses an application already in an active run, emits `run.updated`, and wakes the launcher (`ctx.launcher?.wake()`, which does nothing until a launcher exists). Cancel, retry and dismiss are in `services/runLifecycle.ts`.

Launch (`launchRun.ts`), each step a named function:

1. `fetchJobBoards(ctx, run)`: hunt runs first call `services/feeds.refreshFeeds(ctx)` (step "Checking job boards"), which fetches feeds through `packages/sources`, applies `core.codeFilter` and `core.dedupeKey`, and inserts new jobs. `search_jobs` only reads the database.
2. `whyClaudeIsBlocked(claudeCli)`: the Claude Code status; anything but connected (not installed, needs an update, signed out) → blocked.
3. `createRunDirectory(run)`: `<appData>/runs/<runId>/` with `PLAYBOOK.md`, `.claude/agents/*.md` (hunt: the screener, listing only `mcp__jobgoblin__*` tools), `.claude/settings.json` (hunt: `WebFetch` permission rules limited to job-board domains), and `mcp.json`: `{"mcpServers":{"jobgoblin":{"type":"http","url":"http://127.0.0.1:<port>/mcp","headers":{"Authorization":"Bearer ${JOBGOBLIN_RUN_TOKEN}"}}}}`.
4. `buildClaudeArgs(run)`: `-p`, `--output-format stream-json`, `--verbose`, `--model <tier>`, `--mcp-config mcp.json`, `--strict-mcp-config`, `--tools <list or "">`, `--allowedTools <mcp__jobgoblin__… + built-ins + domain-limited WebFetch>`, `--setting-sources project`, `--permission-mode dontAsk`, `--max-turns <n>`.
5. `buildRunEnvironment(processEnv, runToken)`: copy, delete every `ANTHROPIC_*` and `CLAUDE_CODE_USE_*` key, add `JOBGOBLIN_RUN_TOKEN`.
6. Spawn `claudeCommand` (an array of absolute paths; relative paths are refused), `cwd` = run directory, playbook on stdin (D6), save `pid`, start the timeout.
7. `parseStreamLine(line)`: `system/init` gives `session_id`; `checkInitEvent(init, allowedTools)` stops and fails the run ("This run was stopped for safety") when `tools` lists anything outside the kind's list or the `jobgoblin` MCP server is not connected; `result` gives the outcome; everything goes to `<appData>/runs/<runId>/transcript.jsonl` (kept 14 days).

Outcome (`outcome.ts`):

```ts
classifyRunEnd({ exitCode, result, timedOut, cancelled, tasks }): { status: RunStatus; outcomeMessage: string; resetsAt?: string }
// cancelled → cancelled; timeout or subtype error_max_turns → failed ("This run stopped before finishing");
// is_error and /usage limit/i → blocked ("Your Claude plan limit is reached", reset time from a "|<epoch>" suffix);
// is_error and /log ?in|auth/i → blocked ("Sign in with Claude again"); no result event → failed;
// success with every remaining task waiting → waiting; otherwise → done. Pending tasks at the end count as failed.
```

Queue: one run at a time by default (`concurrency`, max 2). A blocked run pauses the queue until Retry or a successful sign-in check.

Recovery (`recovery.ts`) at start: every run in `running` or `waiting` with a pid → if that process is alive and its image is the configured Claude command (checked with `tasklist` on Windows, `ps` elsewhere), kill its tree; mark the run `interrupted` ("This run was interrupted"). Queued runs stay queued.

Cancel: `taskkill /PID <pid> /T` (Windows) or `SIGTERM`, then after 5 s `taskkill /PID <pid> /T /F` or `SIGKILL`; status `cancelled`.

After a run (`afterRun.ts`): hunt or paste → admit to tailoring (section 8.3); tailor → applications whose drafts never passed get one retry run on sonnet (`tailor_attempts`), then `tailor_error` = "Couldn't tailor this one: <reason>"; answers → nothing extra.

Claude Code CLI (`claudeCli.ts`; finding the program is `findClaudeProgram.ts`): `detect()` checks `claudeCommand` from start options, then `claude.exe` on PATH and in `%USERPROFILE%\.local\bin` (never `claude.cmd`, which Node cannot start without a shell), then `~/.local/bin/claude`; `version()`; `authStatus()` (`claude auth status`, JSON, `authMethod` must be `claude.ai`); `install()` runs `claudeInstallCommand` (default `winget install Anthropic.ClaudeCode` or the macOS script); `signIn()` runs `claude auth login`. `MINIMUM_CLAUDE_VERSION = "2.1.0"`.

## 11. HTTP API (`packages/server/src/http`)

Middleware: `hostCheck` (Host must be `127.0.0.1:<port>` or `localhost:<port>`) → `originCheck` (Origin absent, the server's own origin, or `devOrigin`) → `auth` (session token on `/api/*`; run token on `/mcp`) → route (zod validation) → `errorHandler` (always `ApiError`, never a stack trace). Static files: `apps/dashboard/dist` at `/` with an SPA fallback to `index.html`. Logs redact the `Authorization` header and profile values.

| Method and path | Body → response |
| --- | --- |
| `GET /api/today` | → `TodayResponse` |
| `POST /api/jobs` | `AddJobRequest` → `AddJobResponse` (code dedupes, creates the application in Found, queues a paste run) |
| `GET /api/pipeline?status=&band=&search=&overdueOnly=1` | → `PipelineRow[]` |
| `GET /api/apps/:id` | → `ApplicationDetail` |
| `GET /api/apps/:id/resume.pdf?version=<id>` | → PDF (draft preview or approved file) |
| `POST /api/apps/:id/approve` | `ApproveRequest` → `Application` |
| `POST /api/apps/:id/skip`, `/undo-skip` | `{}` → `Application` |
| `POST /api/apps/:id/withdraw` | `{ note? }` → `Application` |
| `POST /api/apps/:id/request-edit` | `{ note }` → `Run` |
| `POST /api/apps/:id/tailor` | `{}` → `Run` |
| `POST /api/apps/:id/ask` | `{ question }` → `Run` |
| `POST /api/apps/:id/status` | `StatusChangeRequest` → `Application` (via status only) |
| `POST /api/apps/:id/submitted` | `SubmittedRequest` → `Submission` |
| `POST /api/runs` | `{ kind: "hunt" }` → `Run` |
| `POST /api/runs/:id/retry`, `/dismiss`; `DELETE /api/runs/:id` | → `Run` |
| `GET /api/events` | server-sent events (section 5.10) |
| `POST /api/questions/:id/answer` | `{ answer }` → `Question` |
| `GET /api/profile`; `PUT /api/profile/:section` | → `ProfileResponse` |
| `GET /api/story`; `POST /api/story`; `PUT /api/story/:id`; `POST /api/story/:id/confirm`, `/reject` | → `StoryItem[]` / `StoryItem` |
| `POST /api/import-resume` | multipart `file` (≤ 10 MB, PDF or Word) and `kind` (resume or linkedin) → `{ runId }` (the setup run starts after the resume upload) |
| `POST /api/setup/finish` | → `SettingsResponse` (builds the master resume, marks setup complete) |
| `GET /api/claude/status`; `POST /api/claude/install`, `/sign-in` | → `ClaudeStatus` |
| `GET /api/settings`; `PUT /api/settings` | `Partial<Settings>` → `SettingsResponse` |
| `POST /api/settings/folder` | `{ path }` → `ChooseFolderResponse` |
| `GET /api/export/csv`, `/xlsx` | → file |
| `GET /api/backups`; `POST /api/backups`; `POST /api/backups/:id/restore` | → `Backup[]` / `Backup` / `SettingsResponse` |
| `POST /api/open` | `{ path }` (inside the person's folder only) → `{ opened: boolean, path }`; inside Electron the server asks main to open it; otherwise it returns `opened: false` and the dashboard shows the path |

Server entry (`main.ts`): `startServer(options: StartOptions)` → `{ port, sessionToken, url, stop() }`. As a script it reads flags and env (`JOBGOBLIN_APP_DATA`, `JOBGOBLIN_PORT`, `JOBGOBLIN_RESOURCES_DIR`, `JOBGOBLIN_CLAUDE_COMMAND` (JSON array), `JOBGOBLIN_CLAUDE_INSTALL_COMMAND`, `JOBGOBLIN_FEED_FIXTURES`, `JOBGOBLIN_DEV_ORIGIN`). Outside Electron it prints one line `JOBGOBLIN_READY {"port":…,"url":"http://127.0.0.1:…/#token=…"}`; inside a `utilityProcess` it posts `{ type: "ready", port, sessionToken }` to `process.parentPort` and prints nothing secret. It writes `server.json` (port, pid, version, startedAt; no secrets). Messages from main: `{ type: "shutdown" }` → cancel queued runs, stop running ones, flush the tracker, close the database, remove `server.json`, exit. Messages to main: `{ type: "open-path", path, personFolder }`. `JOBGOBLIN_FEED_FIXTURES` makes sources read saved responses instead of the network and seeds companies from that folder's `companies.json`; otherwise companies are seeded from the prototype's `companies/targets.yaml` list, converted to `packages/server/src/seed/companies.json`.

## 12. Dashboard (`apps/dashboard`)

React 19 + Vite + Tailwind 4 + TanStack Query + TanStack Router (code-based route tree in one `router.tsx`) + i18next (`src/i18n/en/<area>.json` holds every string, one file per area). Small shadcn-style components in `src/components/ui/` (Button, Card, Badge, Dialog, Input, Textarea, Tabs) on Radix primitives where focus handling matters. No `dangerouslySetInnerHTML` anywhere: job text and ask results render as plain text.

| Route | Screen |
| --- | --- |
| `/setup/:step` | 1 Welcome, 2 Connect Claude (status, Install, Sign in), 3 Your folder (offers Restore when backups are found), 4 Your resume (upload, optional LinkedIn PDF, then the setup run's progress), 5 Your story (confirm, edit, drop), 6 Form answers (missing values marked; values a run suggested are shown for the person to confirm), 7 Targets, then Finish |
| `/today` | Find jobs, Add a job (link or text; asks for company, title and text when a link needs a login), usage notice before the first run, Needs you, Running (cards with step, progress, Cancel), Done today |
| `/review/:id` | Role, company, fit, band, reason, flags, gaps, matched items; changes vs master; HTML resume preview with reworded lines highlighted; data sheet; Approve (the only accent button), Request edit (asks for a note), Skip; keys A, E, S, J, K |
| `/apply/:id` | Posting link (opens in the browser), a copy button for every field of the **frozen** `approval.dataSheet` and every answer, Open resume file, I submitted (proof type and proof); "Your details changed since you approved. Review it again." when the approval is void |
| `/pipeline` | Board by status group and list view, search, filters, overdue follow-ups in amber |
| `/apps/:id` | Job description, fit, resume versions, answers, history, status change (only `allowedStatusMoves`), Withdraw, Undo skip, Tailor, Ask about this application |
| `/profile/:tab` | Your story, Form answers, Targets (including hard skips and flags), Banned words |
| `/settings` | Claude connection, folder, limits, tracker status and Open tracker, backups (last backup time, Back up now, Restore), export CSV and xlsx |

- `src/api/client.ts`: `apiFetch(path, init)` adds the token and turns an `ApiError` into a thrown `ApiProblem` whose message and action the UI shows.
- `src/api/events.ts`: `subscribeToServerEvents(onEvent)` reads `/api/events` with `fetch` and a stream reader, reconnects with backoff; the root component turns events into `queryClient.invalidateQueries`.
- `src/api/token.ts`: `readSessionToken()` (preload, then `sessionStorage`, then the `#token=` fragment, which it removes from the address bar).
- `src/api/desktop.ts`: `chooseFolder()` and `openPath()` through `window.jobgoblin` when present; in a browser, a text field for the folder path.
- Theme: CSS variables for neutral grays and one accent; amber only for flags, green only for success; dark mode follows `prefers-color-scheme`; hairline borders; no shadows.
- Every interactive element has an accessible name; Playwright runs axe on every screen.

## 13. Desktop (`apps/desktop`)

`main.ts`: single-instance lock (a second launch focuses the window) → `utilityProcess.fork(<server bundle>)` with env → wait for `{ type: "ready" }` → `BrowserWindow` (context isolation, sandbox, no node integration, preload) loading `http://127.0.0.1:<port>/`; `will-navigate` and `setWindowOpenHandler` block other origins and open http(s) links with `shell.openExternal`. Tray with Open and Quit; closing the window keeps runs going. Quit sends `{ type: "shutdown" }` and kills the server after 10 s. On `{ type: "open-path" }` it opens the path with `shell.openPath` only when it is inside the person's folder. `preload.ts` exposes `window.jobgoblin = { sessionToken, chooseFolder(), openPath(path) }` through `contextBridge`, and only when `location.origin` is the server's origin.

## 14. Fake Claude (`fixtures/fake-claude`)

Built with `tsup` to `dist/cli.mjs`; tests set `JOBGOBLIN_CLAUDE_COMMAND=["<node path>","<absolute path>/fixtures/fake-claude/dist/cli.mjs"]`.

- `--version` prints `2.1.99 (Claude Code)`; `auth status` prints `{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"pro"}` (or signed out with `FAKE_CLAUDE_MODE=signed-out`); `auth login` exits 0.
- `-p`: reads the playbook from stdin, takes the run kind and input from lines 1 and 2 (D6), reads `--mcp-config`, expands `${JOBGOBLIN_RUN_TOKEN}`, connects with the MCP SDK client, prints `system/init` (`session_id`, `tools` = the `--allowedTools` it was given, `mcp_servers: [{ name: "jobgoblin", status: "connected" }]`), one `assistant` line per tool call, and a final `result` line (`subtype`, `is_error`, `result`, `num_turns`).
- Scripted behaviour per kind: setup (import_resume → propose_story_items from `data/story-items.json` → save_profile_section employment); hunt (search_jobs → get_fit_context → score from `data/scores.json`, else keyword overlap → record_fit each → mark_seen); paste (get_job → get_fit_context → record_fit); tailor (loop next_task → get_tailoring_context → reorder the master resume to put bullets matching must-haves first → submit_resume_draft → on errors drop the failing parts and resubmit once → complete_task); answers (loop next_task → get_approved → save_answers using `{fullName}`-style placeholders → complete_task); ask (get_application → result text).
- Switches through env: `FAKE_CLAUDE_MODE=signed-out | usage-limit | crash | slow | max-turns | extra-tools`; `FAKE_CLAUDE_ASK_FIRST=1` (call ask_person on the first application of a tailor run); `FAKE_CLAUDE_INVENT_BULLET=1` (submit one untraced and one inflated bullet first).

## 15. Tests

| Layer | Where | What |
| --- | --- | --- |
| core | `packages/core/src/*.test.ts` | every transition, actor and via (the status route cannot reach Applied or Approved); bands; limits and score-order admission; each trace error code; property test (fast-check) that a resume built only from story text always passes; banned terms; version ids stable and header-sensitive; data sheet hash and placeholders; diff; filters; redaction |
| storage | `packages/storage/src/*.test.ts` | migrations; CHECK lists match the enums; transactions roll back; history triggers; table round trips; stale status refused; folder names and collisions; approved file never replaced by different bytes; tracker CSV header first and locked-file retry; backup, retention and restore |
| sources | `packages/sources/src/*.test.ts` | each parser against `fixtures/feeds/recorded/`; polite fetch (one request per second per host, ETag reuse, 6-hour cache); pasted-URL recognition; demo fixtures mode |
| render | `packages/render/src/*.test.ts` | the demo resume renders one page and its text contains every bullet; an overlong resume reads back as 2 pages; resume import from the sample PDF and DOCX |
| server | `packages/server/src/**/*.test.ts` | auth on every route; Host and Origin checks; error shape; services (record fit, submit draft, approve, submitted, skip and undo, request edit, limits); each MCP tool's contract, refusals and run-kind access; personal sections never returned; launch args and env scrubbing; outcomes with the fake claude; init safety check; crash recovery |
| e2e | `e2e/tests/*.spec.ts` | setup wizard; find jobs to review; approve to applied; skip and undo; request edit; paste a job; a question pauses one application; pipeline status moves and overdue; settings backups, restore and export; cancel a run; crash recovery; axe on every screen; Electron smoke |

## 16. Build order

| Wave | Work | Parallel? |
| --- | --- | --- |
| 0 | Scaffold, dependencies, this document, code style, fixtures README | done by the lead |
| 1 | `schemas` | done; updated to v2 |
| 2 | `core`; `storage`; `sources` + feed fixtures; `render` + sample resume; `fake-claude` + profile fixture | yes, one agent each |
| 3 | `server`: context, services, HTTP API, run queue side, main; `dashboard`; `desktop` | yes |
| 4 | `server`: MCP tools, runner launcher, Claude CLI, playbooks and rubric | after wave 3's server |
| 5 | e2e tests and fixes; readability review | after wave 4 |
