# @jobgoblin/core

The pure rules of Jobgoblin: which status moves are allowed, which score is which band, whether a resume is true to Your story, what a data sheet holds, what a job posting's code filter drops. Every function takes plain values and returns plain values. There is no file access, no network, no clock (callers pass `now`) and no database, so each rule can be read and tested on its own.

`core` imports only `@jobgoblin/schemas` and `node:crypto`. The server calls these rules from its services; the dashboard never imports `core`.

A rule failure that a person or a run must see (a banned word, a resume that breaks a limit, a changed number) is **returned as a value**, as a `ResumeCheckError` or a reason string. A `CoreError` is **thrown** only for a caller's mistake, such as asking for a status move the table forbids.

## Read first

1. **`src/stateMachine.ts`**: the table of allowed status moves, written to look like the spec's table. Everything that changes an application's status goes through it.
2. **`src/truthTrace.ts`**, then **`src/facts.ts`** and **`src/strongVerbs.ts`**: how a resume is checked against Your story. This is the part that keeps a tailored resume honest.
3. **`src/dataSheet.ts`**: how the profile becomes the exact values an application sends, and how personal values become `{placeholders}` before a run sees them.

## File map

The numbers are sections of [ARCHITECTURE.md](../../docs/poc/ARCHITECTURE.md). Each file starts with a comment saying what it does.

| File | Holds | Section |
| --- | --- | --- |
| `stateMachine.ts` | `TRANSITIONS`, `canTransition`, `assertTransition`, `allowedMoves`, `statusBeforeSkip` | 6.1 |
| `bands.ts` | `bandFor`, `statusAfterFit` | 6 |
| `limits.ts` | `checkLimits`, `admitInScoreOrder` | 6, 8.3, D15 |
| `truthTrace.ts` | `traceResume` | 8.2 |
| `facts.ts` | `extractFacts`, `createVocabulary`, `vocabularyFromStory`, `supportedKeys`: the numbers, dates, tools and names in a line of text | 8.2 rule 3 |
| `strongVerbs.ts` | `STRONG_VERBS`, `findStrongVerbs` | 8.2 rule 4 |
| `knownTechnologies.ts`, `knownCompanies.ts` | Built-in lists the trace adds to Your story's own tools and names | 8.2 rule 3 |
| `bannedTerms.ts` | `findBannedTerms` | 6 |
| `versionId.ts` | `canonicalJson`, `sha256Hex`, `headerHash`, `resumeVersionId`, `shortVersionId` | 5.6, D18 |
| `dataSheet.ts` | `buildDataSheet`, `hashDataSheet`, `requiredMissing`, `placeholderDataSheet`, `fillPlaceholders` | 5.7, 8.5 |
| `masterResume.ts` | `buildMasterResume` | D7 |
| `resumeDiff.ts` | `diffAgainstMaster` | 5.6, D12 |
| `jobFilters.ts` | `dedupeKey`, `classifyRegion`, `codeFilter`, `yearsRequired`, `normalizeCompanyName` | 6 |
| `redaction.ts` | `redactContactDetails` | D10 |
| `stepText.ts` | `stepForTool`, `STEP_CHECKING_JOB_BOARDS` | 6, 9 |
| `textHelpers.ts` | Whole-word matching and regex escaping shared by the rules above | |
| `errors.ts` | `CoreError` | 6 |
| `index.ts` | Re-exports everything. Import from `@jobgoblin/core`, never from a file inside `src/`. | |
| `testing/alexRivera.ts` | Test data only: the demo person's story and profile. Not exported. | |

## How it is tested

Every file has a `*.test.ts` next to it. Run `pnpm exec vitest run packages/core`; type checking is `pnpm --filter @jobgoblin/core typecheck`.

- **State machine:** the spec's table is written out again, move by move, inside the test, so changing `TRANSITIONS` has to be a deliberate change to the test too. Every row is checked for every actor and via, and the status route is shown unable to reach Applied or Approved.
- **Truth trace:** each error code has an Alex Rivera example (`Led the on-call rotation` against `Contributed to` is `inflated-verb`; `50%` against `40%` is `changed-fact`; a pending item, a missing item and a bullet under the wrong entry are `untraced`). A fast-check property test builds random stories and checks that a resume which copies its story item's text word for word **always passes**.
- **Everything else:** boundary scores (49, 50, 59, 60, 74, 75), the cap counting only `CAP_STATUSES`, score-order admission with four roles at one company and a cap of three, hash stability, placeholder round trips, redaction of a realistic resume.
- Tests build their data with small named helpers (`aConfirmedAchievement`, `alexRiveraStory`) and use no files, network or clock.

## Decisions

Places where ARCHITECTURE.md (v2) was ambiguous or silent, and what this package does.

1. **`TRANSITIONS` is written as the spec's rows and exported as one row per (from, to) pair.** A spec row such as "Scored, Long shot to Tailored" stays one line in the source; `expandRows` turns it into the flat list that `canTransition` searches and the tests walk. A new application is two rows: a run or the server through `record_fit`, and the server through `server`.
2. **Withdrawn is allowed from every open status** (Found through Offer) but not from Skipped or Skipped (low fit). The spec says "any before Applied", and a skipped application is already closed: the person uses Undo skip first.
3. **Undo skip has three rows** (`Skipped (low fit)` to `Scored`; `Skipped` to `Scored` or `Awaiting approval`), because the status before a skip is a fact of the history. `statusBeforeSkip` sorts skip events by time (ties keep the given order), so the history may arrive oldest or newest first, and returns `null` when there is no skip.
4. **A blank `hardSkip` is not a hard skip.** A run that sends `""` or spaces means "none", not "skip for no reason".
5. **Limits.** The reapply rule uses `appliedAt` ("reached Applied or later" means it was applied to, which also covers Rejected, Ghosted and Withdrawn after applying). `checkLimits` returns the first problem, reapply before cap, with code `cap` and path `application`. Company names are compared after removing case, punctuation and endings such as "Inc.". `admitInScoreOrder` returns application ids, counts each admitted candidate as `Tailored` for the next one, and keeps the given order for equal scores.
6. **More files than section 6 lists.** `facts.ts` and `strongVerbs.ts` were split out of `truthTrace.ts` (it was 300 lines and two ideas), `knownCompanies.ts` sits beside `knownTechnologies.ts`, and `textHelpers.ts` holds the one definition of "whole word". `extractFacts` and `STRONG_VERBS` are therefore exported from `facts.ts` and `strongVerbs.ts`, and `index.ts` re-exports both, so callers see no difference.
7. **Truth trace vocabulary.** "Named tools" are every tool and skill anywhere in Your story (any status, so a pending item cannot be used to slip a tool in) plus `KNOWN_TECHNOLOGIES`. "Names" are every title and organization in Your story plus a short list of well-known employers (`WELL_KNOWN_COMPANIES`). The employer list goes beyond section 8.2, which names only Your story: without it, "at Google" would pass whenever Google appears nowhere in the story.
8. **How facts are compared.** The story side is read field by field (text, title, organization, each tool, each number, start and end date) and combined, so text can never run across a field boundary. A month and year (`2024-06`, `June 2024`, `06/2024`) also supports the bare year `2024`, but not the other way round. Tool names that are everyday words (`Go`, `REST`, `Spark`) and names of one or two letters count only when written exactly as listed. One error is returned per changed fact.
9. **Strong verbs** are matched by verb, not by spelling (`led`, `leading` and `lead` are one verb), against the cited item's text and title only (not its parent). For words that are also everyday nouns (`design`, `scale`, `launch`, `head`) only the verb forms are listed, and the bare word `found` is left out, to keep false alarms rare. The message quotes the first word of the story item as "your story says".
10. **Skills and education** are checked for source, kind and (for skills) matching text ignoring case and spacing. They have no sentence to hold a number or verb, so the fact checks do not apply.
11. **Banned terms match whole words and their plurals,** not substrings, so banning `test` does not block `latest`, and `QA` does not block `Qatar`. A banned phrase may be split by any spacing.
12. **`canonicalJson` accepts plain JSON only** (objects, arrays, strings, finite numbers, booleans, null). A key set to `undefined` is dropped as `JSON.stringify` does; `undefined` anywhere else, a `Date`, `NaN` or a function throws `CoreError("invalid-input")` rather than hashing something ambiguous. `shortVersionId(id, length = 8)` takes an optional longer length for the rare clash.
13. **The data sheet's `resumeFileName` is marked personal,** although section 5.7's list of personal keys does not include it. "Alex Rivera - Resume.pdf" contains the person's name, and a name must not reach a run, so `placeholderDataSheet` replaces it with `{resumeFileName}`. The `resumeVersion` field shows the short id; the sheet's `resumeVersion` holds the full one. First name is the first word of the full name and last name the last word.
14. **`fillPlaceholders` leaves a placeholder alone while its value is missing,** so an unfilled expected salary shows as `{expectedBase}` and not as the word `TODO` that looks like data. Braces that are not a data sheet key are left alone.
15. **The master resume** lists experiences, projects and education newest first (a role that is still going comes first) and keeps achievements in Your story's order; it includes an experience that has no confirmed achievements.
16. **`diffAgainstMaster`** compares parts by story item id. "Reordered" looks only at the parts both resumes have, in reading order, so adding or removing a part is not a reorder. A change of spacing is not a rewording.
17. **The code filter drops a posting for three reasons only,** as section 6 says: a role to avoid in the title, more years than the limit, a region outside the targets. The prototype's other title rules (too senior, internship, non-engineering, hardware), its track rules and its "forward-deployed engineers must be in the US" rule are not ported: the first are the run's job to flag, and tracks and region rules for one track belong to the person's targets and the fit rubric, not to code.
18. **Years required** is read from the title, and from body sentences about experience or requirements, taking the lowest figure of a range ("3-5 years" is 3) and the highest across the posting. Numbers above 15 are ignored (company history), and a sentence where the company speaks about itself ("we", "our") counts only if it also says who it wants. Spelled-out numbers ("five years") are not read. The rule is rough on purpose: wrongly hiding a job is worse than showing one the run will flag.
19. **Region changes from the prototype:** place words match as whole words (so "usa" does not match inside "Thousand Oaks"), a standalone `US` counts as a state code, and "Remote - Worldwide" is `REMOTE` (the prototype allowed one such word only). India is still checked first. An empty location is `REMOTE`.
20. **The dedupe key** is the SHA-256 of the normalized company (without "Inc." and similar), title, and location. A location is normalized by turning "United States", "U.S." and "USA" into "us" and sorting its words, so `Remote - US`, `Remote (US)` and `US Remote` agree.
21. **Redaction.** The header is everything before the first section heading (a list of common headings, in any case, with or without a colon); with no heading, its first three lines. A header line that is a sentence of the person's own words (six or more words, no contact detail, not a place) is kept, so an un-headed summary is not lost, and is scrubbed like the rest. The header's own location is removed, but places in the body (where jobs were) stay. Emails, phone numbers and links anywhere become `{email}`, `{phone}`, `{link}`, and the name becomes `{fullName}`. The top-level domain `net` is not treated as a link, so `ASP.NET` survives. Phone numbers are `+` numbers, US-style groups and ten plain digits, never dates.
22. **`stepForTool` takes a bare tool name or Claude Code's `mcp__jobgoblin__<name>`.** Its table is typed by `McpToolName`, so a new tool does not compile until it has a line.
23. **No `zod` import.** Nothing here needs to build a schema, only to use the ones in `@jobgoblin/schemas`, so `package.json` is unchanged. The tests use `vitest` and `fast-check` from the repository root.
24. **`pnpm lint:deps` cannot check this package yet:** dependency-cruiser does not read TypeScript 7 files and reports 0 modules. The rule (only `@jobgoblin/schemas` and `node:crypto`) was checked by listing the package's imports.
25. **Imports inside `src/` have no file extension** (`./status`), as in `@jobgoblin/schemas`.
