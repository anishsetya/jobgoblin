# Code style: written to be read and learned from

Jobgoblin's code is meant to be read by someone learning how the system works. When a choice is between short and clear, choose clear.

## Files and modules

- **Start every file with a short header comment** (two to five lines): what this module does, why it exists, and the spec section it implements. Example:

  ```ts
  // The application state machine: the only place that decides which status moves are allowed.
  // The server refuses any move that is not in TRANSITIONS, and each move names who may make it.
  // Spec: "Application state machine".
  ```

- **One idea per file.** A file over about 250 lines is usually two ideas.
- **Every package has a `README.md`**: what the package is for, which files to read first, and how it is tested.
- **`index.ts` only re-exports.** No logic in barrel files.

## Naming

- Use the product's words from [ARCHITECTURE.md](ARCHITECTURE.md) section 4: `storyItem`, `run`, `approval`, `dataSheet`, `needsYou`. Never invent synonyms (`bullet`, `job run`, `sign-off`).
- Functions are verbs that say what happens: `approveApplication`, `buildRunEnvironment`, `traceResume`. Booleans read as questions: `isConfirmed`, `hasLiveApproval`.
- No abbreviations except well-known ones (`id`, `url`, `pdf`, `db`, `api`). Write `application`, not `app`, in server code (the dashboard's route names are the exception).
- Named constants instead of magic numbers: `const BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1000;`.

## Functions

- Small, single-purpose functions with early returns. Prefer a sequence of well-named steps over one long function:

  ```ts
  export function approveApplication(input: ApproveInput): Approval {
    const application = loadApplicationOrFail(input.applicationId);
    const dataSheet = rebuildDataSheet(application);
    refuseIfDataSheetChanged(dataSheet, input.datasheetHash);
    const pdf = renderFinalPdf(application);
    return saveApprovalInOneTransaction(application, dataSheet, pdf);
  }
  ```

- Explicit parameter and return types on every exported function.
- Pass dependencies in as arguments or a small context object (`{ db, folder, bus }`). No hidden globals and no service locators. That keeps code testable without mocks.
- No clever one-liners, nested ternaries, or chains of more than three array methods. A `for` loop with a clear name is fine.

## Comments

- Comment **why**, not what. `// Bind to 127.0.0.1 only: a website must never reach this server.` is useful; `// set host` is not.
- Link rules to their source: `// PRD T4: 3 open applications per company.`
- Security and truthfulness controls get a one-line comment naming the threat they stop.
- No commented-out code, no TODOs without an owner and reason.

## Errors

- Errors the person sees use the `ApiError` shape `{ code, message, action }` with plain words and no blame: message "This job already has an open application.", action "Open it from Pipeline."
- Rule failures that a run must fix are returned as values (`ResumeCheckError[]`), not thrown.
- Never swallow an error silently. Log it with context (no profile values) and return a clear error.

## Types and validation

- Every value crossing a boundary (HTTP body, MCP tool input, JSON column, file) is parsed with its zod schema from `@jobgoblin/schemas`.
- Use `type` imports for types (`import type { Job } from "@jobgoblin/schemas"`).
- Avoid `any`. When a library forces `unknown`, narrow it right away with a schema.

## Tests

- Test names are sentences: `it("refuses to approve when the data sheet changed since the person saw it")`.
- Arrange, act, assert, separated by blank lines. Build test data with small named helpers (`aConfirmedAchievement({ text: "Led ..." })`).
- Tests use temporary folders and databases; they never touch the person's real folders or the network.

## React (dashboard)

- One component per file, named like the file. Screens in `src/screens/`, reusable parts in `src/components/`.
- Data fetching lives in hooks in `src/api/` (`useToday()`, `useApproveApplication()`); components do not call `fetch`.
- Every string comes from the English catalog in `src/i18n/en/` (one JSON file per area) through `t("…")`. Plain, calm, second person, no exclamation marks, buttons are verbs.
- Every interactive element has an accessible name. Use semantic HTML first (`button`, `nav`, `main`, `h1`).

## Dependencies

- Add a dependency only when it saves real complexity. Prefer the platform (`fetch`, `node:crypto`, `node:sqlite`).
- Respect the dependency rules in ARCHITECTURE.md section 3.
