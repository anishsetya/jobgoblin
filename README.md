# Jobgoblin

**A free, open-source job-application copilot that runs on the AI subscription you already pay for.**

Paid job-application apps charge a separate subscription for their own AI. Jobgoblin doesn't: it does the bookkeeping, rule-checking and tracking in plain code, and borrows the brains of the Claude plan you already have.

It finds roles, scores how well you fit, tailors a one-page resume using **only achievements you have confirmed**, prepares form answers, and tracks everything. **Nothing is submitted until you approve it.**

> **Status: developer preview.** The desktop app below runs from source. It is not packaged or signed yet. Before it, Jobgoblin was a set of Claude Code skills driven by slash commands; that prototype is still in this repo (see [The earlier Claude Code prototype](#the-earlier-claude-code-prototype)).

## Principles

- **You approve every application.** No mass auto-apply, no CAPTCHA solving, no account creation.
- **Truthful resumes.** Every bullet must come from your confirmed story; a draft fails on a changed fact, a banned term or a second page.
- **Your data stays yours.** Profile, resumes and applications live in your folder on your computer.
- **Cheap by design.** Plain code first; Claude runs only for judgement and writing.

## Desktop app (developer preview)

An Electron app with a React dashboard. A local server (bound to `127.0.0.1` only) keeps your data in SQLite and your folder, and starts Claude Code runs for the parts that need a model. A run can only call a small set of tools on that server, and never sees your contact details.

### Run it

You need Node 24 and pnpm 10.

```powershell
pnpm install
pnpm --filter @jobgoblin/fake-claude build   # only for the demo: a scripted stand-in for Claude Code
```

Start the server and dashboard in a browser. The two variables make it work without a Claude plan or the internet: `JOBGOBLIN_FEED_FIXTURES` serves the saved demo job board, and `JOBGOBLIN_CLAUDE_COMMAND` is a JSON list of absolute paths for the fake `claude`. Leave both out to use the real internet and your own Claude Code.

```powershell
$env:JOBGOBLIN_FEED_FIXTURES = "$PWD\fixtures\feeds\demo"
$env:JOBGOBLIN_CLAUDE_COMMAND = ConvertTo-Json -Compress @((Get-Command node).Source, "$PWD\fixtures\fake-claude\dist\cli.mjs")
pnpm dev
```

`pnpm dev` prints one line, `JOBGOBLIN_READY {...}`, with the address to open (it ends in `#token=...`).

| Command | What it does |
| --- | --- |
| `pnpm dev` | Builds the dashboard and starts the server |
| `pnpm dev:desktop` | Builds the dashboard and server, then opens the Electron app |
| `pnpm test` | All unit tests (Vitest) |
| `pnpm test:e2e` | Browser tests of every dashboard flow (Playwright), using the demo board and the fake `claude` |
| `pnpm lint:deps` | Checks the dependency rules (no model SDK, only `storage` opens the database, only the runner starts processes) |

### Start here: reading order

The code is written to be read and learned from. These 15 stops, in this order, show how the whole system fits together.

1. [docs/poc/ARCHITECTURE.md](docs/poc/ARCHITECTURE.md), sections 1, 4 and 6.1: what is in scope, the product's words (use them in code), and the table of every allowed status move.
2. [docs/poc/CODE_STYLE.md](docs/poc/CODE_STYLE.md): how files, functions, comments and tests are written here.
3. [packages/schemas/src/status.ts](packages/schemas/src/status.ts): the 20 application statuses everything else refers to.
4. [packages/core/src/stateMachine.ts](packages/core/src/stateMachine.ts): the only place that decides which status moves are allowed, and who may make them.
5. [packages/storage/migrations/0001_initial.sql](packages/storage/migrations/0001_initial.sql): the whole database in one file.
6. [packages/storage/src/tables/applications.ts](packages/storage/src/tables/applications.ts) (`updateApplicationStatus`): how a table module saves a status change and its history row.
7. [packages/server/src/services/moves.ts](packages/server/src/services/moves.ts): the one function every status change goes through.
8. [packages/server/src/http/app.ts](packages/server/src/http/app.ts), then [middleware/auth.ts](packages/server/src/http/middleware/auth.ts): how a request reaches a service, and how the session token and the run token keep callers apart.
9. [packages/server/src/services/approvals.ts](packages/server/src/services/approvals.ts): the person's approval of one exact data sheet and one exact resume file.
10. [packages/server/src/services/submissions.ts](packages/server/src/services/submissions.ts): "I submitted", with proof, and the move to Applied.
11. [packages/core/src/truthTrace.ts](packages/core/src/truthTrace.ts): the check that every resume line comes from something the person confirmed.
12. [packages/server/src/services/resumes.ts](packages/server/src/services/resumes.ts): a run's resume draft goes through the checks, is rendered, and is saved.
13. [packages/server/src/mcp/tools/defineTool.ts](packages/server/src/mcp/tools/defineTool.ts), then [answerTools.ts](packages/server/src/mcp/tools/answerTools.ts): how a model-facing tool is a thin adapter over a service, and what a run can and cannot see.
14. [packages/server/src/runner/README.md](packages/server/src/runner/README.md), then [launchRun.ts](packages/server/src/runner/launchRun.ts): how one sealed Claude Code run is started, watched and ended.
15. [apps/dashboard/src/screens/review/ReviewContent.tsx](apps/dashboard/src/screens/review/ReviewContent.tsx): the Review screen, where the person decides.

Every package has its own README with the files to read first and how it is tested.

## The earlier Claude Code prototype

Before the desktop app, Jobgoblin ran inside [Claude Code](https://code.claude.com) as skills and agents, driven by slash commands. These folders and files belong to that prototype and are not used by the desktop app:

- `.claude/` (skills and agents)
- `scripts/` and `tools/` (Python and PowerShell helpers, the `jobs` MCP server)
- `profile/`, `resume/` and `companies/` (the person's data files and target list)
- `config.example.yaml`
- `MODELS.md`

| Command | What happens |
|---|---|
| `/daily-hunt` | Finds new roles (public Greenhouse, Lever and Ashby boards, HN Who is hiring, YC jobs, RemoteOK, We Work Remotely), screens them cheaply, scores the best, tailors resumes |
| `/apply-batch` | Shows today's batch; fills forms in your Chrome only for the numbers you approve; you click Submit and clear any CAPTCHA or code |
| `/resume-update` | Adds a confirmed achievement to your bullet bank and re-renders your resume |
| `/interview-prep <company>` | Builds a prep pack for an interview |
| `/weekly-review` | Funnel metrics, skill gaps, suggested changes |
| `/cold-outreach` | Drafts short emails to people who publicly invite them; sends only the drafts you approve |
| `/update-companies` | Keeps your list of target companies current |
| `/browse-boards` | Walks login-only boards in your own Chrome at human pace |

To use the prototype:

1. Install [Claude Code](https://code.claude.com) and sign in with your Claude plan.
2. Clone this repo and create a Python venv with `rendercv`, `pypdf` and `pyyaml`.
3. Copy each `*.example.yaml` to the same name without `.example` (`config.yaml`, `profile/*.yaml`, `resume/master.yaml`) and fill them in.
4. Open Claude Code in this folder, approve the `jobs` MCP server, and run `/daily-hunt`.

## License

[AGPL-3.0](LICENSE).
