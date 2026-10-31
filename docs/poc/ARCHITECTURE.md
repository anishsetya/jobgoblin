# Jobgoblin POC: architecture and build contract

This document turns the [tech spec](https://jobgoblin.atlassian.net/wiki/spaces/SD/pages/655361/Jobgoblin+tech+spec) (v6) and the [PRD](https://jobgoblin.atlassian.net/wiki/spaces/SD/pages/557057/Jobgoblin+PRD) (v3) into a buildable proof of concept. Where this file and the spec disagree, the decision log below says why. Read [CODE_STYLE.md](CODE_STYLE.md) before writing code.

## 1. Scope

The POC is the PRD's **stage 1, developer preview**: the desktop app run from source with dashboard, runner, P0 profile, discover, score, tailor, review and track.

| In the POC | Requirements |
| --- | --- |
| Setup wizard: detect Claude Code, show install and sign-in commands, choose folder, import resume, confirm Your story, form answers, targets | S2, S3, S4 (folder only), P1-P5 |
| Find jobs from public feeds, add a pasted job, never show a job twice | D1-D3 |
| Fit score with band, reason, matched items, gaps, flags; hard skips from targets | F1, F2 |
| One-page tailored resume from confirmed Your story only; version ids; frozen approved PDF; limits | T1, T2, T4 |
| Review one application at a time; approve, skip, request edit; frozen data sheet; answers after approval | A1-A4 |
| Open application with copy buttons; "I submitted" with proof | U1, U4 |
| Pipeline board and list; status moves; follow-ups; CSV and xlsx tracker | K1-K3 (no live Google Sheet) |
| Runs with live progress, cancel, per-application questions, usage notice, crash recovery | R1-R4 |
| Backups after changes and daily; restore | S5 |

**Out of the POC:** signed installers and auto-update (S1), the Chrome autofill extension and pairing (U2), auto-submit (U3), Word output (T3), the Google Drive switch, opt-in metrics, crash reports, bug-report zip, Export everything zip, API-key mode. The HTTP API leaves room for them (routes are named in the spec) but they are not built.

## 2. Decision log

| # | Decision | Why |
| --- | --- | --- |
| D1 | **`node:sqlite`** (built into Node 22.13+ and Electron) instead of `better-sqlite3` + `drizzle-orm`. Schema and migrations are plain numbered `.sql` files; a small typed repository layer maps rows. | The spec lists `node:sqlite` as the fallback. `better-sqlite3` is a native module built against one ABI, so Vitest (system Node) and Electron would need different builds of it. Plain SQL is also easier to read and learn from than an ORM. |
| D2 | **Packages export TypeScript source** (`"exports": {".": "./src/index.ts"}`); there is no per-package build. The server runs with `tsx` in development and is bundled with `tsup` for Electron. | One less build step; Vite, Vitest and tsx all read TypeScript directly. |
| D3 | **The fake `claude`** in `fixtures/fake-claude` is a scripted MCP client, not a byte-for-byte replay. It accepts the real launch flags, connects to `/mcp` with the run token, calls the tools a real run would, and prints `stream-json` lines. | It tests the server, tools, runner and dashboard end to end with no Claude plan. Real-model checks are the spec's nightly job, out of POC scope. |
| D4 | **The browser gets its session token from the URL fragment** (`http://127.0.0.1:<port>/#token=<t>`) when not inside Electron; inside Electron the preload exposes `window.jobgoblin.sessionToken`. The dashboard keeps it in memory and in `sessionStorage`. | Lets Playwright drive the dashboard in plain Chromium. A fragment is never sent to the server or logged. |
| D5 | **Server-sent events are read with `fetch`**, not `EventSource`. | `EventSource` cannot send the `Authorization` header. |
| D6 | **The playbook is passed to `claude -p` on stdin.** | Avoids Windows command-line quoting and length limits. |
| D7 | **The master resume is built by code** (`core.buildMasterResume`) when setup finishes. | Deterministic, costs no plan usage, and the person can still change it through Your story. |
| D8 | **Answering a run's question queues a new run of the same kind for that one application** instead of `claude --resume`. | Simpler and works the same after a restart; `--resume` can come later. |
| D9 | **Feed results go into the `jobs` table only.** An application row is created when a run calls `record_fit` (or when the person pastes a job). | Hundreds of feed jobs would otherwise flood the pipeline; every application still has a fit score (F1). |
| D10 | **Contact details are taken out of the resume text by code before the setup run sees it.** `core.redactContactDetails` pulls email, phone and links into the profile and replaces them with placeholders such as `{email}`. | The PRD promises contact details are never shown to Claude, and the resume is the first place they appear. |
| D11 | **Run status adds `cancelled`.** | Cancel needs a terminal state that is not `failed`. |
| D12 | **Review shows an HTML preview of the resume**, with reworded lines highlighted, plus a button to open the PDF. | An `<iframe>` cannot send the session token, and a PDF cannot highlight changes. |
| D13 | **Resume font: a font Typst bundles** (for example New Computer Modern or Libertinus Serif) in place of XCharter. | Keeps the PDF reproducible on every machine without installing fonts. |
| D14 | **Default port 47615**; `--port 0` picks a free port (tests). | The spec asks for a fixed default with a fallback. |

## 3. Repository layout

```
apps/desktop          Electron main + preload; starts the server in a utilityProcess
apps/dashboard        React dashboard and setup wizard (Vite); built into apps/dashboard/dist and served by the server
packages/schemas      zod schemas + types for every record, request, response, MCP tool and event
packages/core         pure rules: state machine, bands, limits, truth trace, banned terms, version ids, data sheet, master resume, diff, job filters, redaction
packages/storage      node:sqlite database, migrations, repositories, the person's folder, tracker export, backups
packages/sources      job feed clients and parsers; polite fetch; URL-to-posting for pasted links
packages/render       Typst resume template, PDF render and checks, resume text import (PDF and Word)
packages/server       Hono HTTP API, MCP endpoint and tools, services (the use cases), runner, Claude Code CLI integration
playbooks/            one prompt per run kind + subagent definitions, ported from the prototype's .claude/agents
fixtures/             fake-claude, saved feed responses, sample resume, sample profile
e2e/                  Playwright tests of every dashboard flow, plus one Electron smoke test
docs/poc/             this file and the code style guide
```

Dependency rules (checked by `pnpm lint:deps`, dependency-cruiser):

- `core` imports only `schemas` and `node:crypto`.
- Only `storage` imports `node:sqlite` or writes the person's folder.
- Only `server/src/runner` imports `node:child_process`.
- Nothing imports `@anthropic-ai/*` or `openai`.
- `dashboard` imports only `schemas` types from the workspace and reaches data only through HTTP.
- `sources` and `render` import only `schemas` from the workspace.

## 4. Vocabulary (use these words in code)

| Word | Meaning | In code |
| --- | --- | --- |
| Your story | Everything the person confirmed about themselves | `StoryItem`, table `story_items` |
| Run | One background Claude Code session started by a button | `Run`, `RunKind` |
| Application | One job being pursued | `Application` |
| Data sheet | Every form field and value that will be sent | `DataSheet` |
| Approval | The person's approval of one exact data sheet and resume file | `Approval` |
| Submission | Proof that the application was sent | `Submission` |
| Needs you | Anything waiting on the person | `NeedsYouItem` |
| Person's folder | The folder the person chose, `Documents/Jobgoblin` by default | `PersonFolder` |
| App data folder | `%APPDATA%\Jobgoblin` or `~/Library/Application Support/Jobgoblin`; tests use a temp dir | `appDataDir` |

## 5. Shared contracts (`packages/schemas`)

Every type below is a zod schema exported with an inferred type of the same name (`export const Job = z.object(...)` and `export type Job = z.infer<typeof Job>`). One file per area.

### 5.1 `status.ts`

```ts
ApplicationStatus = z.enum([
  "Found", "Scored", "Skipped (low fit)", "Long shot", "Tailored", "Awaiting approval",
  "Skipped", "Approved", "Filling", "Needs your input", "Applied", "OA", "Phone screen",
  "Onsite", "Offer", "Rejected", "Ghosted", "Withdrawn", "Accepted", "Declined",
]);                                          // exactly 20, matching the spec table
Actor = z.enum(["person", "run", "server", "extension"]);
OPEN_STATUSES                                 // statuses that count toward "3 open per company": every status except Skipped (low fit), Skipped, Rejected, Ghosted, Withdrawn, Declined, Accepted
```

### 5.2 `story.ts`

```ts
StoryItemKind = z.enum(["experience", "project", "education", "achievement", "skill", "headline"]);
StoryItemStatus = z.enum(["pending", "confirmed", "rejected"]);
StoryItemData = z.object({
  text: z.string(),                 // the bullet, headline, skill name, or a one-line summary
  title: z.string().optional(),     // job title, project name, degree
  organization: z.string().optional(), // company, school
  location: z.string().optional(),
  startDate: z.string().optional(), // "YYYY-MM" or "YYYY"
  endDate: z.string().optional(),   // "YYYY-MM", "YYYY" or "Present"
  tools: z.array(z.string()).default([]),
  numbers: z.array(z.string()).default([]),  // "40%", "$2M", "500"
});
StoryItem = z.object({ id, kind, parentId: z.string().nullable(), status, data: StoryItemData, keywords: z.array(z.string()), createdAt, updatedAt });
ProposedStoryItem = StoryItem without id/status/timestamps, plus `tempId` and `parentTempId` so a run can nest achievements under an experience it proposes in the same call.
```

Achievements have `parentId` pointing at an experience or project. Skills and headlines have no parent.

### 5.3 `profile.ts`

```ts
TODO = "TODO"   // a value the person still has to fill in
ContactSection = { fullName, email, phone, location, linkedin?, github?, portfolio? }      // personal: never shown to a run
WorkAuthorizationSection = { regions: Record<"US"|"IN"|"REMOTE"|string, { authorized: boolean|"TODO", requiresSponsorship: boolean|"TODO", willingToRelocate: boolean|"TODO" }> }
EmploymentSection = { currentEmployer?, currentTitle?, noticePeriod, earliestStartDate, yearsExperience }
CompensationSection = { expectedBase }                                                    // personal
EeoSection = { gender, raceEthnicity, veteranStatus, disability }  // default "Decline to self-identify"; personal
Targets = { roles: string[], regions: string[], maxYearsRequired: number (default 4), rolesToAvoid: string[], tracks: string[] }
Rules = { bannedTerms: string[] }
ProfileSectionName = z.enum(["contact", "workAuthorization", "employment", "compensation", "eeo", "targets", "rules"])
PERSONAL_SECTIONS = ["contact", "compensation", "eeo"]
MissingValue = { section, key, label }   // every "TODO" or empty required value, for the Form answers screen
```

### 5.4 `job.ts`

```ts
Region = z.enum(["US", "IN", "REMOTE", "OTHER"]);
JobSource = z.enum(["greenhouse", "lever", "ashby", "hn", "remoteok", "wwr", "web", "pasted"]);
Job = { jobId: string /* "<source>:<slug>:<id>" */, dedupeKey: string, source, company, title, location, region, url: string|null, text: string, postedAt: string|null, foundAt: string, seenAt: string|null, questions: string[] /* screening questions when the feed exposes them */ }
Company = { id, name, ats: "greenhouse"|"lever"|"ashby", slug, status: "Watching"|"Suggested"|"Passed" }
```

### 5.5 `fit.ts`

```ts
Band = z.enum(["apply", "stretch", "long-shot", "skip"]);   // 75+, 60-74, 50-59, under 50
FitInput = { jobId, score: int 0-100, track: string, mustHaves: string[], gaps: string[], flags: string[], matchedItemIds: string[], reason: string /* one line */, hardSkip: string|null }
Fit = FitInput + { applicationId, band, rubricVersion, createdAt }
```

### 5.6 `resume.ts`

```ts
SourcedText = { src: string /* story item id */, text: string }
ResumeEntry = { src: string /* experience or project id */, bullets: SourcedText[] }
ResumeBody = { headline: SourcedText|null, sections: { experience: ResumeEntry[], projects: ResumeEntry[] }, skills: SourcedText[], education: { src: string }[] }
ResumeHeader = { fullName, email, phone, location, links: string[] }   // filled by code from the contact section; never in ResumeBody
TraceErrorCode = z.enum(["schema", "untraced", "changed-fact", "inflated-verb", "banned", "cap", "pages", "banned-in-pdf"])
ResumeCheckError = { code: TraceErrorCode, path: string /* e.g. "sections.experience[0].bullets[2]" */, message: string /* plain words a run can act on */ }
ResumeVersion = { versionId /* "r-" + 64 hex */, shortId /* "r-" + 8 hex */, applicationId, state: "draft"|"approved", body: ResumeBody, templateVersion: string, pdfPath: string|null, pdfSha256: string|null, createdAt }
ResumeDiff = { added: string[], removed: string[], reordered: boolean, reworded: { src: string, from: string, to: string }[] }   // story item ids, compared with the master resume
```

### 5.7 `application.ts`, `datasheet.ts`, `submission.ts`

```ts
SubmitMode = z.enum(["manual", "extension"]);     // POC builds "manual" only
Application = { id, jobId, company, title, status, fitScore: number|null, band: Band|null, resumeVersion: string|null, submitMode, folder: string|null, appliedAt, followUpOn, tailorAttempts: number, tailorError: string|null, createdAt, updatedAt }
DataSheetField = { key: string, label: string, value: string, personal: boolean, missing: boolean }
DataSheet = { applicationId, fields: DataSheetField[], resumeVersion: string, resumeFileName: string /* "First Last - Resume.pdf" */ }
Approval = { id, applicationId, datasheet: DataSheet, datasheetHash, resumeVersion, pdfSha256, submitMode, approvedAt, usedAt: string|null, voidedAt: string|null }
ProofType = z.enum(["confirmation-page", "pasted-text", "screenshot", "email-subject", "person-saw-it"]);
Submission = { id, applicationId, resumeVersion, attachedSha256, proofType, proof: string, submittedAt }
Answer = { question: string, answer: string }
```

### 5.8 `run.ts`

```ts
RunKind = z.enum(["setup", "hunt", "paste", "tailor", "answers", "ask"]);
RunStatus = z.enum(["queued", "running", "waiting", "done", "failed", "blocked", "interrupted", "cancelled"]);
Run = { id, kind, status, model: "haiku"|"sonnet"|"opus", applicationIds: string[], sessionId: string|null, pid: number|null, step: string|null /* plain words */, progressDone: number, progressTotal: number|null, outcomeMessage: string|null /* plain words for the card */, resultText: string|null /* ask runs */, retryOf: string|null, queuedAt, startedAt, endedAt }
Question = { id, runId, applicationId, text, answer: string|null, askedAt, answeredAt }
StartRunRequest = { kind: "hunt" } | { kind: "tailor", applicationIds: string[] } | { kind: "ask", applicationId: string, question: string } | { kind: "retry", runId: string }
```

### 5.9 `api.ts`

```ts
ApiError = { code: string, message: string, action: string }    // message and action are plain words shown as is
NeedsYouItem = { kind: "review" | "question" | "ready-to-submit" | "long-shot" | "follow-up-due" | "run-attention", id: string, applicationId: string|null, runId: string|null, title: string, detail: string, createdAt }
RunCard = Run
TodayResponse = { needsYou: NeedsYouItem[], running: RunCard[], doneToday: { found: number, tailored: number, approved: number, applied: number }, setupComplete: boolean }
PipelineQuery = { status?: ApplicationStatus[], search?: string, band?: Band[], overdueOnly?: boolean }
PipelineRow = Application + { overdue: boolean, location: string, region: Region }
ApplicationDetail = { application, job, fit: Fit|null, resume: ResumeVersion|null, versions: ResumeVersion[], diff: ResumeDiff|null, storyItems: StoryItem[] /* items the resume cites */, datasheet: DataSheet|null, datasheetHash: string|null, approval: Approval|null, answers: Answer[], submission: Submission|null, questions: Question[], history: Event[], askResults: { question: string, answer: string, at: string }[] }
ApproveRequest = { datasheetHash: string, submitMode: "manual" }
SubmittedRequest = { proofType: ProofType, proof: string, attachedSha256: string|null, confirmDifferentFile?: boolean }
StatusChangeRequest = { to: ApplicationStatus, followUpOn?: string|null, note?: string }
AddJobRequest = { url?: string, text?: string }  // at least one
AddJobResponse = { applicationId: string|null, needsText: boolean, message: string }   // needsText when the link needs a login or could not be read
ClaudeStatus = { state: "connected" | "not-installed" | "update-needed" | "signed-out", version: string|null, minimumVersion: string, installCommand: string, signInCommand: string, plan: string|null }
Settings = { personFolder: string|null, concurrency: 1|2, maxOpenPerCompany: number /* 3 */, reapplyDays: number /* 90 */, followUpDays: number /* 7 */, usageNoticeSeen: boolean, setupComplete: boolean, lastBackupAt: string|null, trackerStatus: "ok"|"locked"|"off" }
Backup = { id /* file name */, createdAt, sizeBytes }
Event = { id, ts, actor, applicationId: string|null, type: string, from: string|null, to: string|null, detail: string|null }
```

### 5.10 `events.ts` (server-sent events on `/api/events`)

```ts
ServerEvent =
  | { type: "run.updated", run: Run }
  | { type: "application.updated", applicationId: string, status: ApplicationStatus }
  | { type: "needs-you.changed" }
  | { type: "profile.updated" }
  | { type: "backup.done", at: string }
```

### 5.11 `mcp.ts`

One input schema per tool (section 9) and the common reply:

```ts
ToolReply<T> = { ok: true, data: T, next: string|null } | { ok: false, errors: ResumeCheckError[] | { code: string, message: string }[], next: string|null }
```

## 6. Pure rules (`packages/core`)

No file or network access; everything takes plain values and returns plain values. Errors are returned as values where the caller must show them (trace, limits) and thrown as `CoreError(code, message)` where they are programming or permission mistakes (bad transition).

| File | Exports |
| --- | --- |
| `stateMachine.ts` | `TRANSITIONS` (the spec table, one row per from-to pair with allowed actors), `canTransition(from, to, actor)`, `assertTransition(from, to, actor)`, `statusBeforeSkip(history)` for Undo skip |
| `bands.ts` | `bandFor(score)`, `statusAfterFit(fit)` (hard skip or under 50 = Skipped (low fit); 50-59 = Long shot; 60+ = Scored and ready to tailor) |
| `limits.ts` | `checkLimits({ company, dedupeKey, openApplicationsAtCompany, previousApplications, now, maxOpenPerCompany, reapplyDays })` returns `null` or a `ResumeCheckError` with code `cap` and a plain message |
| `truthTrace.ts` | `traceResume(body, storyItems)` returns `ResumeCheckError[]` (rules in section 8.2); `STRONG_VERBS`; `extractFacts(text)` |
| `bannedTerms.ts` | `findBannedTerms(texts: { path, text }[], bannedTerms)` returns `ResumeCheckError[]` with code `banned` naming the word |
| `versionId.ts` | `canonicalJson(value)`, `sha256Hex(stringOrBytes)`, `resumeVersionId(body, templateVersion)`, `shortVersionId(id)` |
| `datasheet.ts` | `buildDataSheet({ profile, job, resumeVersion })`, `hashDataSheet(sheet)` |
| `masterResume.ts` | `buildMasterResume(storyItems)`: confirmed items only; experiences newest first with up to 4 achievements each, up to 2 projects with up to 2 achievements, first confirmed headline, up to 12 skills, all education |
| `resumeDiff.ts` | `diffAgainstMaster(tailored, master)` returns `ResumeDiff` |
| `jobFilters.ts` | `dedupeKey(company, title, location)`, `passesCodeFilter(job, targets)` (roles to avoid, years required above the limit, region outside targets) with a reason, `classifyRegion(location)` |
| `redaction.ts` | `redactContactDetails(text)` returns `{ redacted, found: Partial<ContactSection> }`; `fillPlaceholders(text, contact)` for answers |
| `stepText.ts` | `stepForTool(toolName)`: the plain-language step shown on run cards ("Checking every bullet against your profile") |

## 7. Storage (`packages/storage`)

- `openDatabase(appDataDir)` opens `jobgoblin.db` with `PRAGMA journal_mode = WAL; foreign_keys = ON;`, runs migrations from `migrations/*.sql` in order (after a backup when the version changes), and refuses a database whose `user_version` is newer than the app ("Update Jobgoblin to open your data").
- `db.transaction(fn)` wraps `BEGIN IMMEDIATE ... COMMIT` and rolls back on any throw.
- Tables exactly as the spec's table list, plus: `jobs.seen_at`, `jobs.questions` (JSON), `applications.tailor_attempts`, `applications.tailor_error`, `runs.model`, `runs.application_ids` (JSON), `runs.step`, `runs.progress_done`, `runs.progress_total`, `runs.outcome_message`, `runs.result_text`, `runs.retry_of`, `answers` table (application_id, question, answer, saved_at).
- `CHECK (status IN (...))` on `applications.status` and `runs.status`, generated from the schema enums.
- Triggers `events_no_update` and `events_no_delete` raise an error.
- One repository module per table group (`profileRepo`, `storyRepo`, `jobsRepo`, `applicationsRepo`, `fitsRepo`, `resumesRepo`, `approvalsRepo`, `submissionsRepo`, `runsRepo`, `questionsRepo`, `answersRepo`, `eventsRepo`, `settingsRepo`, `companiesRepo`). Repositories take the database handle and return schema types; JSON columns are parsed with the zod schemas.
- `PersonFolder`: `ensureLayout(root)`, `applicationFolderName(date, company, title)` ("2026-10-30 Stripe - Backend Engineer", file-system safe), `writeJobDescription`, `writeAnswers`, `writeApprovedResume(bytes, versionId, folder, fileName)` (writes `Resumes/<shortId>.pdf` once and copies it into the application folder; refuses to overwrite an existing approved file), `fileSha256(path)`, `verifyApprovedFiles()` for startup.
- `TrackerExporter`: `schedule()` debounces 2 s (60 s when the folder path contains Google Drive, OneDrive, Dropbox or iCloud); writes `Tracker.csv` (header first) and `Tracker.xlsx` (Applications sheet + Read me sheet) through a temp file and rename; on `EBUSY`/`EPERM` sets status `locked` and retries in 30 s. Columns: Company, Role, Status, Fit, Band, Resume version, Applied on, Follow up on, Posting, Folder, Updated.
- `Backups`: `backupNow(reason)` uses `VACUUM INTO` a temp file in `Backups/` then renames to `YYYY-MM-DD HH-mm.jobgoblin-backup`; `scheduleAfterChange()` (at most every 5 minutes); `daily()`; retention (everything from the last 2 days, one per day for 14 days); `list()`; `restore(id)` (backs up the current database first, closes, copies, reopens).

## 8. Resume pipeline (`packages/render` + `core` + `server`)

### 8.1 Render (`packages/render`)

- `TEMPLATE_VERSION = "t1"`; template at `templates/t1/resume.typ`, a port of the prototype's `resume/design.yaml` (Jake's resume layout: one column, US letter, 0.5 in top and bottom margins, 0.6 in sides, small-caps section titles with a full rule, company and location on row one, title and dates on row two, bullets).
- `renderResumePdf({ header, body, storyItems, templateVersion, versionId })` returns `Uint8Array`; the PDF's metadata title and subject carry the version id.
- `checkPdf(bytes, bannedTerms)` returns `{ pages, text, errors }` using `pdfjs-dist` (errors `pages`, `banned-in-pdf`).
- `extractResumeText(bytes, fileName)` returns plain text from PDF (`pdfjs-dist`) or Word (`mammoth`).
- Typst input is generated as data (JSON passed to the template through `sys.inputs` or a generated `data.json` in the compiler's virtual file system), never by string-concatenating untrusted text into Typst markup.

### 8.2 Truth trace rules (`core/truthTrace.ts`)

For every part of `ResumeBody`:

1. `src` exists in Your story and has status `confirmed`, else `untraced`.
2. The kind fits the slot: experience entries cite `experience`, project entries cite `project`, bullets cite an `achievement` whose `parentId` is that entry's `src`, the headline cites a `headline`, skills cite a `skill` (text equal to the item's text, ignoring case and spacing), education cites `education`. Mismatch is `untraced`.
3. Facts in the part's text must appear in the cited item (its text, title, organization, tools, numbers, dates): numbers and percentages (`40%`, `3x`, `$2M`, `500`), years and month-year dates, and named tools (any word or phrase that is a tool or skill anywhere in Your story, or in a built-in list of common technologies). A fact not in the item is `changed-fact`.
4. A strong verb (`led, owned, built, designed, launched, managed, architected, founded, created, spearheaded, directed, headed, drove, established, pioneered, mentored, scaled, shipped`) in the part's text must also appear (any tense) in the cited item, else `inflated-verb`.
5. Messages are short and tell the run what to fix: `Bullet 3 of Acme uses "led", but your story says "contributed to". Use the story's verb.`

### 8.3 Submit a draft (`server/services/resumes.ts`)

`submitResumeDraft(applicationId, body)`: parse with the schema (`schema`) → `traceResume` → `findBannedTerms` over every text → `checkLimits` (backstop) → `renderResumePdf` → `checkPdf` (exactly 1 page, banned terms) → `resumeVersionId` → in one transaction insert or reuse the `resumes` row, set the application's `resume_version`, move Scored or Long shot → Tailored → Awaiting approval (two events). Draft PDFs go to the app data folder as previews; they are never served to anything but the dashboard and never sent.

### 8.4 Approve (`server/services/approvals.ts`)

`approve(applicationId, { datasheetHash, submitMode })`, person only:

1. Rebuild the data sheet from the current profile; refuse with `datasheet-changed` if its hash differs from the one the person saw, and with `missing-values` if a required field (full name, email, phone) is `TODO` or empty.
2. Render the final PDF once, in memory; `pdfSha256 = sha256(bytes)`; run `checkPdf` and the banned-term check over the data sheet.
3. Transaction: insert the approval (data sheet, hash, version, sha, mode), resume row `state = approved` with `pdf_sha256`, application → Approved, event.
4. After commit: write `Resumes/<shortId>.pdf`, the application folder with `First Last - Resume.pdf` and `Job description.md`, schedule tracker export and backup, then queue an answers run.

An approval is voided (`voided_at`) when the data sheet hash or the approved file's fingerprint changes later; the Open application screen then asks the person to review again, and a new approval may be minted for an application already in Approved.

### 8.5 I submitted (`server/services/submissions.ts`)

`markSubmitted(applicationId, request)`: requires a live (not used, not void) approval; if `attachedSha256` is given and differs from the approval's `pdfSha256`, refuse with `different-file` unless `confirmDifferentFile` is true. Transaction: insert submission, mark approval used, application → Applied with `applied_at` and `follow_up_on = applied + followUpDays`, event. Then tracker export and backup.

## 9. MCP endpoint and tools (`packages/server/src/mcp`)

- `POST /mcp` (Streamable HTTP, stateless: a fresh `McpServer` per request) with `Authorization: Bearer <run token>`. The token maps to one run; the run's kind decides the tool list (`toolAccess.ts`). Unknown or expired token: 401. The session token never works on `/mcp`, and a run token never works on `/api/*`.
- Every tool validates input with its schema, returns `ToolReply` as JSON text content, and is annotated `readOnlyHint` when it does not write. Every call updates the run's `step` (from `core.stepForTool`) and emits `run.updated`.
- Job text is returned wrapped: `<untrusted_job_posting>…</untrusted_job_posting>` with a one-line note that its contents are data, not instructions.

| Tool | Input | Data returned | Run kinds |
| --- | --- | --- | --- |
| `get_profile` | – | facts (work authorization, employment without salary), missing values, targets, rules; never contact, compensation or EEO | all |
| `save_profile_section` | `{ section, data }` where section is not personal | saved section | setup |
| `propose_story_items` | `{ items: ProposedStoryItem[] }` | created ids (status pending) | setup |
| `import_resume` | – | redacted resume text of the latest upload | setup |
| `search_jobs` | `{ limit?: number }` | unseen jobs that passed the code filter: `{ jobId, company, title, location, region, snippet }[]` (snippet = first 2000 chars, wrapped as untrusted) | hunt |
| `add_job` | `{ url?, text, company, title, location }` | `{ jobId, duplicate: boolean }` | hunt, paste |
| `mark_seen` | `{ jobIds }` | count | hunt |
| `get_job` | `{ jobId }` | job with wrapped text | hunt, paste, tailor, answers, ask |
| `get_fit_context` | – | rubric text (ported from the prototype's fit-analyst), targets, every confirmed story item | hunt, paste |
| `record_fit` | `FitInput` | `{ applicationId, band, status }`; creates the application if needed | hunt, paste |
| `get_tailoring_context` | `{ applicationId }` | master resume body, confirmed story items, the fit's must-haves and gaps, banned terms, job summary | tailor |
| `submit_resume_draft` | `{ applicationId, body }` | `{ versionId, shortId }` or `ok: false` with `ResumeCheckError[]` | tailor |
| `save_answers` | `{ applicationId, answers: Answer[] }` | saved; banned-term checked; `{phone}`-style placeholders filled by code before writing `Answers.md` | answers |
| `list_ready` | – | applications awaiting approval | ask |
| `get_approved` | `{ applicationId }` | the approved application's job summary, screening questions, data sheet with personal values replaced by placeholders such as `{phone}` | answers |
| `update_status` | `{ applicationId, to }` | only moves the run's actor may make; no run kind uses it in the POC | none |
| `get_pipeline` | – | counts by status and rows | ask |
| `ask_person` | `{ applicationId, question }` | `{ questionId }`; the application moves to Needs you; `next` says to call `complete_task` with outcome `waiting` and move on | all |
| `next_task` | – | `{ applicationId }` or `null` when the queue is empty | tailor, answers |
| `complete_task` | `{ applicationId, outcome: "done" | "failed" | "waiting", note? }` | progress | tailor, answers |

## 10. Runner (`packages/server/src/runner`)

| Kind | Started by | Model | Built-in tools (`--tools`) | Max turns | Timeout |
| --- | --- | --- | --- | --- | --- |
| setup | `POST /api/import-resume` | sonnet | none | 40 | 10 min |
| hunt | Find jobs | sonnet (screener subagent haiku) | `WebSearch`, `WebFetch` | 120 | 30 min |
| paste | Add a job | haiku | none | 15 | 5 min |
| tailor | after hunt or paste (automatic for apply and stretch), Tailor button (long shot), Request edit | haiku; one retry run on sonnet for applications that failed every check | none | 80 | 20 min |
| answers | Approve | sonnet | none | 30 | 10 min |
| ask | Ask about this application | sonnet | none | 20 | 5 min |

Launch (`launch.ts`), each step a named function:

1. `createRunDirectory(run)`: `<appData>/runs/<runId>/` with `PLAYBOOK.md`, `.claude/agents/*.md` (subagents), `.claude/settings.json` (hunt: `WebFetch` permission rules limited to job-board domains), and `mcp.json`: `{"mcpServers":{"jobgoblin":{"type":"http","url":"http://127.0.0.1:<port>/mcp","headers":{"Authorization":"Bearer ${JOBGOBLIN_RUN_TOKEN}"}}}}`.
2. `buildClaudeArgs(run)`: `-p`, `--output-format stream-json`, `--verbose`, `--model <tier>`, `--mcp-config mcp.json`, `--strict-mcp-config`, `--tools <list or "">`, `--allowedTools <mcp__jobgoblin__… list + domain-limited WebFetch>`, `--setting-sources project`, `--permission-mode dontAsk`, `--max-turns <n>`.
3. `buildRunEnvironment(processEnv, runToken)`: copy, delete every `ANTHROPIC_*` and `CLAUDE_CODE_USE_*` key, add `JOBGOBLIN_RUN_TOKEN`.
4. Spawn the configured Claude command (`settings.claudeCommand`, default the detected `claude` path; tests set `JOBGOBLIN_CLAUDE_COMMAND` to a JSON array such as `["node", "fixtures/fake-claude/src/cli.ts"]`), `cwd` = run directory, playbook on stdin, save `pid`.
5. `parseStreamJson(line)`: `system/init` gives `session_id`; `result` gives the outcome; `assistant` messages are kept in the transcript file only.

Queue: one run at a time by default (setting `concurrency`, max 2). Outcomes per the spec table: success → done; `error_max_turns` or timeout → failed ("This run stopped before finishing"); not signed in → blocked; usage limit → blocked with reset time; missing claude → blocked; crash (non-zero exit without result) → failed. A run whose every remaining work item waits on the person ends `waiting`.

Recovery (`recovery.ts`) at start: every run in `running` or `waiting` with a pid → if the process is alive and its image name is `claude` (or the configured command), kill its tree; mark the run `interrupted` with `outcomeMessage` "This run was interrupted". Queued runs stay queued.

Cancel: `SIGTERM` (Windows: `taskkill /PID <pid> /T`), then after 5 s `taskkill /PID <pid> /T /F` or `SIGKILL`; status `cancelled`.

After a run ends (`afterRun.ts`): hunt or paste → queue a tailor run for new Scored applications with band apply or stretch that pass limits (applications refused by limits get `tailor_error` with the plain message); tailor → queue one sonnet retry for applications whose drafts never passed, once (`tailor_attempts`); after that, `tailor_error` = "Couldn't tailor this one: <reason>".

Claude Code CLI (`claudeCli.ts`): `detect()` (configured command, PATH, `%USERPROFILE%\.local\bin\claude.exe`, `~/.local/bin/claude`), `version()` (`claude --version`), `authStatus()` (`claude auth status`, JSON, `authMethod` must be `claude.ai`), `installCommand()` (`winget install Anthropic.ClaudeCode` or the macOS script), `signIn()` (`claude auth login`). `MINIMUM_CLAUDE_VERSION` constant.

## 11. HTTP API (`packages/server/src/http`)

Middleware order: `hostCheck` (Host must be `127.0.0.1:<port>` or `localhost:<port>`) → `originCheck` (Origin absent, or the server's own origin, or `JOBGOBLIN_DEV_ORIGIN`) → `auth` (session token on `/api/*`; run token on `/mcp`) → zod validation → route → `errorHandler` (always `ApiError`, never a stack trace). Static files: the built dashboard from `apps/dashboard/dist` at `/` with an SPA fallback to `index.html` (no token needed for static files; the data is behind the token).

Routes: every route in the spec's API table that serves an in-scope requirement, plus:

| Added route | Why |
| --- | --- |
| `GET /api/apps/:id/resume.pdf` | Draft preview or approved PDF for the dashboard (session token) |
| `POST /api/setup/finish` | Builds the master resume and marks setup complete |
| `POST /api/backups` | Back up now |
| `POST /api/story` and `PUT /api/story/:id` | Add or edit a Your story item (edits keep it pending until confirmed) |
| `POST /api/settings/folder` | Choose the person's folder and create its layout |
| `POST /api/apps/:id/tailor` | Tailor a long shot (person) |
| `POST /api/apps/:id/ask` | Ask about this application (starts an ask run) |

Server entry (`main.ts`): `startServer({ appDataDir, port, dashboardDir, claudeCommand, feedFixturesDir? })` returns `{ port, sessionToken, stop() }`. As a script it reads flags and env (`JOBGOBLIN_APP_DATA`, `JOBGOBLIN_PORT`, `JOBGOBLIN_CLAUDE_COMMAND`, `JOBGOBLIN_FEED_FIXTURES`, `JOBGOBLIN_DEV_ORIGIN`), prints one line `JOBGOBLIN_READY {"port":…,"url":"http://127.0.0.1:…/#token=…"}` on stdout, writes `server.json` (port, pid, version, startedAt; no secrets), and when running in an Electron `utilityProcess` posts `{ type: "ready", port, sessionToken }` to `process.parentPort`.

`JOBGOBLIN_FEED_FIXTURES` makes `packages/sources` read saved responses from that folder instead of the network (tests and demos).

## 12. Dashboard (`apps/dashboard`)

React 19 + Vite + Tailwind 4 + TanStack Query + TanStack Router (code-based route tree in one `router.tsx`, so every route is visible in one file) + i18next (`src/i18n/en.json` holds every string). Small shadcn-style components written in `src/components/ui/` (Button, Card, Badge, Dialog, Input, Textarea, Tabs) on Radix primitives where focus handling matters.

| Route | Screen |
| --- | --- |
| `/setup/:step` | Wizard: 1 Welcome, 2 Connect Claude, 3 Your folder, 4 Your resume, 5 Your story, 6 Form answers, 7 Targets, then Finish |
| `/today` | Find jobs, Add a job (link or text), Needs you, Running (cards with step, progress and Cancel), Done today |
| `/review/:id` | One application: role, company, fit, band, reason, flags, gaps, matched items; changes vs master; HTML resume preview with reworded lines highlighted; data sheet; Approve (only accent button), Request edit, Skip; keys A, E, S, J, K |
| `/apply/:id` | Posting link, copy button per data sheet field and answer, open resume file, I submitted (proof type + proof) |
| `/pipeline` | Board by status and list view, search, filters, overdue follow-ups in amber |
| `/apps/:id` | Job description, fit, resume versions, answers, status history, status change, Ask about this application |
| `/profile/:tab` | Your story (pending and confirmed, confirm / edit / drop), Form answers (missing marked), Targets, Banned words |
| `/settings` | Claude connection, folder, limits, tracker status and Open tracker, backups (last backup time, Back up now, Restore), export CSV / xlsx, usage notice |

- `src/api/client.ts`: `apiFetch(path, init)` adds the token, parses `ApiError` into a thrown `ApiProblem` whose message and action the UI shows.
- `src/api/events.ts`: `subscribeToServerEvents(onEvent)` reads `/api/events` with `fetch` and a stream reader, reconnects with backoff, and the root component turns events into `queryClient.invalidateQueries`.
- Theme: CSS variables for neutral grays and one accent; amber only for flags, green only for success; `prefers-color-scheme` for dark mode; hairline borders; no shadows.
- Every interactive element has an accessible name; Playwright runs axe on every screen.

## 13. Desktop (`apps/desktop`)

`main.ts`: single-instance lock (second launch focuses the window) → `utilityProcess.fork(<server bundle>)` with env → wait for the `ready` message → `BrowserWindow` (context isolation on, sandbox on, node integration off, preload) loading `http://127.0.0.1:<port>/` → tray with Open and Quit; closing the window keeps runs going in the tray; Quit stops the server (which cancels runs and closes the database). `preload.ts` exposes `window.jobgoblin = { sessionToken, chooseFolder() }` through `contextBridge`; `chooseFolder` uses `dialog.showOpenDialog` through IPC. Links to job postings open in the default browser (`shell.openExternal`, http and https only).

## 14. Fake Claude (`fixtures/fake-claude`)

`src/cli.ts`, run as `node --import tsx fixtures/fake-claude/src/cli.ts …` or through the command array:

- `--version` prints `2.1.99 (Claude Code)`; `auth status` prints `{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"pro"}`; `auth login` exits 0.
- `-p`: reads the playbook from stdin, detects the run kind from the playbook's first line (`<!-- run-kind: hunt -->`), reads `--mcp-config`, expands `${JOBGOBLIN_RUN_TOKEN}`, connects with the MCP SDK client, then runs the scripted behaviour for that kind, printing `system/init`, one `assistant` line per tool call, and a final `result` line.
- Scripted behaviour: setup (import_resume → propose_story_items from `fixtures/fake-claude/data/story-items.json` → save_profile_section employment), hunt (search_jobs → get_fit_context → keyword-overlap score per job → record_fit for each → mark_seen), paste (get_job → get_fit_context → record_fit), tailor (loop next_task → get_tailoring_context → reorder the master resume to put bullets matching must-haves first → submit_resume_draft → on errors drop the failing parts and resubmit once → complete_task), answers (loop next_task → get_approved → save_answers with short answers using `{fullName}`-style placeholders → complete_task), ask (get_pipeline → result text).
- Behaviour switches through env, read from the runner's copied environment: `FAKE_CLAUDE_MODE=signed-out | usage-limit | crash | slow | max-turns`, `FAKE_CLAUDE_ASK_FIRST=1` (call `ask_person` on the first application of a tailor run), `FAKE_CLAUDE_INVENT_BULLET=1` (submit one untraced bullet first to exercise the trace errors).

## 15. Tests

| Layer | Where | What |
| --- | --- | --- |
| core | `packages/core/src/*.test.ts` | every transition and refusal, bands, limits, trace (each error code, property tests with fast-check that a resume built only from story text always passes), banned terms, version ids stable and different, data sheet hash, diff, filters, redaction |
| storage | `packages/storage/src/*.test.ts` | migrations, transactions roll back, event triggers, repositories round trip, folder layout, approved file never overwritten, tracker CSV header first, backup and restore |
| sources | `packages/sources/src/*.test.ts` | each parser against saved responses in `fixtures/feeds/`, polite fetch (one request per second per host, ETag reuse), URL recognition for pasted links |
| render | `packages/render/src/*.test.ts` | golden resume renders one page, text contains every bullet, banned term in PDF caught, overflow detected as `pages`, import from a sample PDF |
| server | `packages/server/src/**/*.test.ts` | auth on every route, Host and Origin checks, error shape, each MCP tool's contract and refusals (personal sections never returned), launch flags and env scrubbing, runner outcomes with the fake claude, crash recovery, approve and submitted services |
| e2e | `e2e/tests/*.spec.ts` | setup wizard; find jobs to review; approve to applied; skip and undo; request edit; paste a job; question pauses one application; pipeline status moves and overdue; settings backups, restore and export; cancel a run; crash recovery; axe on every screen; Electron smoke |

## 16. Build order

| Wave | Work | Parallel? |
| --- | --- | --- |
| 0 | Monorepo scaffold, dependencies, this document, code style | done by the lead |
| 1 | `schemas` | alone (everything depends on it) |
| 2 | `core`, `storage`, `sources`, `render`, `fake-claude` + saved fixtures | yes, one agent each |
| 3 | `server` services and HTTP API; `dashboard`; `desktop` | yes |
| 4 | `server` MCP tools, runner, Claude CLI, playbooks | after wave 3's server work |
| 5 | e2e tests and fixes; readability review | after wave 4 |
