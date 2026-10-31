# @jobgoblin/schemas

The shared contracts of Jobgoblin: a [zod](https://zod.dev) schema and an inferred TypeScript type for every record, request, response, server-sent event and MCP tool input and output. The server, the dashboard and the pure rules in `core` all parse with these, so a value that crosses a boundary (HTTP body, tool input, JSON column, file) means the same thing on both sides.

This package has no logic. It holds shapes, a few constants (status lists, tool names, run settings) and defaults. Rules such as "which status moves are allowed" or "which score is which band" live in `packages/core`.

## Read first

1. `src/status.ts`: the 20 application statuses. Every other file refers to them.
2. `src/resume.ts`: a resume is data, and every part of it names the Your story item it came from.
3. `src/mcp.ts`: the 21 tools a Claude Code run can call, what each takes and returns, and which run kinds may call which.

## File map

Each file starts with a comment saying what it covers. The numbers are sections of [ARCHITECTURE.md](../../docs/poc/ARCHITECTURE.md).

| File | Holds | Section |
| --- | --- | --- |
| `status.ts` | `ApplicationStatus`, `Actor`, `TransitionVia`, `TERMINAL_STATUSES`, `CAP_STATUSES`, `STATUS_GROUPS` | 5.1 |
| `story.ts` | `StoryItem`, `StoryItemData`, `ProposedStoryItem`, `UploadKind` and the enums | 5.2 |
| `profile.ts` | `TODO`, the seven profile sections, `Profile`, `ProfileResponse`, `PERSONAL_SECTIONS`, `MissingValue` | 5.3 |
| `job.ts` | `Job`, `FeedPosting`, `Company`, `Region`, `JobSource`, `HttpUrl` | 5.4 |
| `fit.ts` | `Band`, `FitInput`, `Fit` | 5.5 |
| `resume.ts` | `ResumeBody`, `ResumeHeader`, `ResumeCheckError`, `ResumeVersion`, `ApplicationResume`, `ResumeDiff`, hash and version id formats | 5.6 |
| `application.ts` | `Application`, `SubmitMode` | 5.7 |
| `datasheet.ts` | `DataSheetKey`, `DataSheetField`, `DataSheet`, `Approval` | 5.7 |
| `submission.ts` | `Submission`, `ProofType`, `Answer` | 5.7 |
| `run.ts` | `Run`, `RunInput`, `RunTask`, `Question`, `StartRunRequest`, `RUN_KIND_SETTINGS` | 5.8, 10 |
| `api.ts` | `ApiError`, `TodayResponse`, `PipelineRow`, `ApplicationDetail`, `ApplicationActions`, the person's requests, `Settings`, `SettingsResponse`, `HistoryEvent` | 5.9 |
| `events.ts` | `ServerEvent` | 5.10 |
| `mcp.ts` | `MCP_TOOL_NAMES`, an `...Input` and `...Output` schema per tool, `RUN_KIND_TOOLS`, `ToolError`, `ToolReply` | 5.11, 9 |
| `index.ts` | Re-exports everything. Import from `@jobgoblin/schemas`, never from a file inside `src/`. | |

## How to add a schema

1. Put it in the file for its area. If it does not fit any area, that is a sign it belongs in another package.
2. Write the schema and the type with the same name, one after the other:

   ```ts
   export const Backup = z.object({
     id: z.string(),
     createdAt: z.iso.datetime(),
     sizeBytes: z.number().int().nonnegative(),
   });
   export type Backup = z.infer<typeof Backup>;
   ```

3. Add a one-line comment for any field whose meaning is not obvious from its name, and say why when a rule is there for safety or truthfulness.
4. If it is new, check that `index.ts` already re-exports its file. It does for every file listed above.
5. If it is a new MCP tool, add the name to `MCP_TOOL_NAMES`, a `...Input` and a `...Output` schema named after the tool (`get_job` has `GetJobInput` and `GetJobOutput`), and the run kinds that may call it to `RUN_KIND_TOOLS`. The tests tell you if you forget any of these.
6. If you change a status, `ApplicationStatus` also drives the database `CHECK` constraint, so the change needs a migration.

## Conventions

- **Timestamps** are ISO-8601 strings in UTC, checked by `z.iso.datetime()`, for example `2026-10-31T14:05:00.000Z` (what `new Date().toISOString()` returns). Offsets such as `+05:30` are refused, so two timestamps can be compared and sorted as plain text. A calendar day with no time of day (a follow-up date) is `z.iso.date()`, for example `2026-11-07`.
- **Ids** are plain strings. Only hashes and resume version ids have a stricter format (`Sha256Hex`, `ResumeVersionId`).
- **Defaults** use `.default(...)`, so a missing value in a stored row or a run's input becomes the default instead of an error. `Profile.parse({})` and `Settings.parse({})` are a fresh install.
- **`null` means "no value yet"** and the key is still present. Optional (`?`) is used only where the spec says so.
- **Spelling:** `dataSheet` in code and `data_sheet` in SQL, never `datasheet`. `HistoryEvent`, not `Event`, which browsers already define.

## Tests

`src/schemas.test.ts`, run with `pnpm exec vitest run packages/schemas`. It checks the lists that must stay in step (20 statuses, 21 tools each with an input and an output schema, 24 data sheet keys, every status in a Pipeline column, no run kind with a tool that does not exist) and the rules that protect truthfulness and private data (a resume part must name its source, a run cannot write a personal profile section or the banned terms, only three run kinds may ask the person a question). Type checking is `pnpm --filter @jobgoblin/schemas typecheck`.

## Decisions

Places where ARCHITECTURE.md (v2) was ambiguous or silent, and what this package does.

1. **Timestamps and days.** UTC-only `z.iso.datetime()` for moments, `z.iso.date()` for days (see Conventions). `Application.appliedAt` is a moment; `Application.followUpOn` and the follow-up date in `StatusChangeRequest` are days.
2. **Section 5.7 is split across three files** as its heading says: `application.ts` has `SubmitMode` and `Application`; `datasheet.ts` has `DataSheetKey`, `DataSheetField`, `DataSheet` and `Approval`; `submission.ts` has `ProofType`, `Submission` and `Answer`.
3. **Profile values are strings.** Every form-answer value, including `yearsExperience`, is text, because it is typed into a form as text. A value the person still has to fill in is `"TODO"`, which is why fields default to it. Yes/no values in `workAuthorization` are `boolean | "TODO"`.
4. **A run can save only three profile sections:** `employment`, `workAuthorization` and `targets` (`RunWritableSection`). Never the personal ones, and never `rules`, whose banned terms are the person's own guard. `data` is a plain object in the input; the tool checks it against `Profile.shape[section]`.
5. **`ProposedStoryItem` has no `parentId`.** A run can only nest under an item it proposes in the same call (`parentTempId`). It is lenient about `keywords` and `parentTempId` (both default to empty), because a model writes it.
6. **Formats are stricter than the spec's `string` where a mistake would be costly:** hashes are 64 lowercase hex characters, resume version ids are `r-` plus 64 hex, `shortId` is `r-` plus 8 to 64 hex (it grows only if two ever clash), story dates are `YYYY-MM`, `YYYY` or `Present`, and posting links must be `http` or `https` (`HttpUrl`). `AddJobRequest.url` stays a plain string: it is what the person pasted, and the server decides whether it can read it.
7. **`HistoryEvent.type` is a closed list** (`HISTORY_EVENT_TYPES`, 11 entries), so a history row with an unlisted type fails to parse instead of reaching a screen that has no words for it.
8. **`DataSheetField.key` is a closed list** of 24 keys (`DataSheetKey`), for the same reason: a value nobody planned for cannot get onto a form.
9. **Every `...Output` schema is the `data` of a successful reply,** exactly as the section 9 table lists it. Where the table says only `application`, `get_tailoring_context` and `get_approved` use a short `{ id, company, title }` reference, and `get_application` returns the full `Application`, because an ask run needs its status and dates. `get_pipeline` `counts` has an entry for every status (zero included), as `Record<status, number>` says.
10. **`AddJobRequest` reports each problem at its own field** (`company`, `title`), so the form can mark the right box. `location` is optional.
11. **`RUN_KIND_SETTINGS` lists one model per kind.** The hunt screener subagent (haiku) and the tailor retry run (sonnet) are described in comments, not as fields. Built-in tools are typed as `WebSearch | WebFetch | Agent`.
12. **`PipelineQuery` is kept** although v2 section 5.9 no longer lists it. It is the parsed filter, not a query string: the route turns `?status=Applied&overdueOnly=1` into this shape.
13. **`STATUS_GROUPS` has six columns:** To review, Ready to apply, Applied, Interviewing, Offer, Closed. "Closed" is exactly `TERMINAL_STATUSES`. `Accepted` and `Declined` close the application, so they sit there and not under Offer. `CAP_STATUSES` is a separate list (Tailored through Offer), not "everything not closed".
14. **`UploadKind`** (`resume` or `linkedin`) is added to `story.ts`: two tools and the import route share it, and section 5 gives it no home.
15. **`mcp.ts` is about 400 lines,** longer than the 250-line guide. It stays one file because the spec lists one `mcp.ts`, and because the tools are easier to check against the spec's table when each tool's input and output sit side by side in table order.
16. **Imports inside `src/` have no file extension** (`./status`), which the repo's `moduleResolution: Bundler` setting resolves for Vite, Vitest, tsx and tsup.
