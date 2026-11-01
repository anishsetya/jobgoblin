# @jobgoblin/e2e

End-to-end tests of Jobgoblin. Each test is a user story: it starts a real server, opens the real dashboard in a browser (or the desktop app in Electron) and does what a person would do, finding things by their role and visible name, the way a screen reader does. A test passes when the person would have got what they wanted.

Spec: [ARCHITECTURE.md](../docs/poc/ARCHITECTURE.md) section 15, and the PRD's seven-step user journey (set up, tell it about me, find jobs, review, approve, apply, track).

## Run them

From the repository root (Playwright's Chromium and Electron must already be installed):

```powershell
pnpm test:e2e                               # everything: builds first, then runs both projects
pnpm --filter @jobgoblin/e2e test -- review-approve-apply     # one file
$env:E2E_SKIP_BUILD = "1"; pnpm --filter @jobgoblin/e2e test  # reuse the builds that are already there
```

`support/globalSetup.ts` builds the dashboard, the server bundle, the fake claude and the desktop shell once, before any test, because the tests run the BUILT programs. After a failure: `pnpm --filter @jobgoblin/e2e exec playwright show-report` (or `show-trace` on a `trace.zip` in `e2e/test-results/`). A failing test also attaches the server's own output.

| Variable | Effect |
| --- | --- |
| `E2E_SKIP_BUILD=1` | Do not rebuild. Use it while writing a test; rebuild after changing app code |
| `E2E_KEEP_DATA=1` | Keep each test's temporary app data and person's folder (they are in `%TEMP%\jobgoblin-e2e-*`) |
| `E2E_SCREENSHOTS_DIR=<folder>` | The setup, find-jobs and review stories also save a picture of each screen there |

Two Playwright projects: `chromium` (every story except the last) and `electron` (the smoke test). One worker, because each test starts its own server and some start real child processes.

## How a test gets its app

`support/server.ts` `startTestServer(...)` (handed to tests as the `startServer` fixture in `support/fixtures.ts`, which also stops everything afterwards, even when the test fails):

- spawns `node packages/server/dist/server.mjs` with a **fresh temporary app data folder** and person's folder, `JOBGOBLIN_PORT=0`, `JOBGOBLIN_RESOURCES_DIR` = the repository, **`JOBGOBLIN_FEED_FIXTURES` = `fixtures/feeds/demo`** (the 7-posting demo board, no network) and **`JOBGOBLIN_CLAUDE_COMMAND` = node + `fixtures/fake-claude/dist/cli.mjs`** (no Claude plan);
- reads the `JOBGOBLIN_READY` line for the address, `#token` included, which the test opens in the browser;
- `seed: "alex-rivera"` sets the demo person up first, through the public HTTP API only (`support/seed.ts`: folder, profile sections, story items added and confirmed, `setup/finish`), so a story that is not about setup starts at Today. `seedOptions.usageNoticeSeen` marks the usage notice as read. `seed: "none"` leaves the app empty, as on a first run;
- `fakeClaudeEnv` sets the fake's switches for that one server; `reuseDataOf` starts a new server on the data of a crashed one; `personFolder` points a new app at an old person's folder (a new computer);
- stops the whole process tree with `taskkill /T` (`crash()` kills only the server, the way a crash would).

`support/waits.ts` waits until no run is queued or running (it polls `GET /api/today` and wants three quiet polls in a row, because a hunt ends and the tailoring run is queued a moment later). `support/flows.ts` holds the steps several stories begin with. `support/axe.ts` runs axe-core. `support/pageProbes.ts` records what a run card showed while it changed.

## How the fake claude makes it deterministic

The server launches the fake exactly as it would launch Claude Code. The fake connects to the server's MCP endpoint with the run's token, calls the same tools a real run would, and prints `stream-json` ([fixtures/fake-claude/README.md](../fixtures/fake-claude/README.md)). It never uses a model:

- fit scores come from `fixtures/fake-claude/data/scores.json`: Acme Cloud 86 (apply), Brightpath 68 (stretch), Copperleaf Applied AI 55 (long shot), Data Analyst 20 (skip), the pasted Gridline job 78;
- the tailored resume is the master resume with matching bullets first; **with `FAKE_CLAUDE_REWORD=1` one bullet is also reworded** so Review has a line to highlight; an edit note drops a bullet;
- the answers come from the data sheet, with `{placeholders}` for personal values;
- the switches turn failures on: `FAKE_CLAUDE_MODE=slow | usage-limit | signed-out`, `FAKE_CLAUDE_ASK_FIRST=1`, `FAKE_CLAUDE_INVENT_BULLET=1`.

The code filter and dedupe key run in the server before any run starts, which is why the QA role, the Senior Staff role and the repeated Hacker News posting never appear.

## What each spec covers

PRD requirement ids as in the PRD (S setup, P profile, D discover, F fit, T tailor, A approve, U apply, K track, R runs).

| Spec | The story | Requirements |
| --- | --- | --- |
| `setup-wizard.spec.ts` | An empty app, every wizard step (Welcome, Connect Claude, folder, resume upload, Your story with an edit and a drop, Form answers with the pay left missing, Targets, Finish), then Find jobs works on what was set up. Profile shows it afterwards; a bad number is explained in plain words | S2 S3 S4 P1 P2 P3 P4 |
| `find-to-review.spec.ts` | Usage notice before the first run; Find jobs shows plain-language steps and progress; Needs you has Acme Cloud and Brightpath to review and Copperleaf as a long shot; the QA, Senior Staff and repeated postings never reach Pipeline | D1 D3 F1 F2 R1 R3 |
| `review-approve-apply.spec.ts` | Review (fit, band, reason, gaps, reworded line highlighted, data sheet), key A approves, answers are written, Open application has a copy button for every frozen field and answer, the resume file can be found and downloaded, "I submitted" with proof makes it Applied with a follow-up, Pipeline, the PDF and Answers.md on disk. A changed phone number voids the approval | F1 F2 T1 T2 A1 A2 A3 A4 U1 U4 K1 |
| `skip-undo-and-edit.spec.ts` | S skips, Undo skip restores Awaiting approval, J and K and E work and ignore typing, Request edit with a note gives a new resume version, a long shot is tailored only on request | A2 T2 F1 |
| `paste-a-job.spec.ts` | A Greenhouse link is read, scored and reviewed, once; a LinkedIn link asks for company, title and text | D2 |
| `question-pauses-one-application.spec.ts` | A question about one application waits on Today, the other reaches review, answering re-queues that one | R2 |
| `pipeline-and-status.spec.ts` | Applied to Online assessment to Phone screen to Interview round to Offer to Accepted using only the offered moves; an overdue follow-up is amber and on Today; Withdraw; search and filters, board and list; Ask about an application | K1 K2 |
| `settings-backups-export.spec.ts` | Back up now shows the last backup time; Restore returns to an earlier state; a new computer finds its backups from the wizard; limits are validated, saved and used; CSV (header first) and Excel downloads | S4 S5 K3 T4 |
| `runs-cancel-and-outcomes.spec.ts` | Cancel a slow run; "Your Claude plan limit is reached" with Try again; signed out shows sign-in needed and blocks a run | R1 R3 R4 S2 S3 |
| `crash-recovery.spec.ts` | A slow hunt, the server killed hard, a new server on the same data: "This run was interrupted", Try again works, no Claude process is left | R4 |
| `accessibility.spec.ts` | axe (WCAG 2.1 A and AA) on Today, Review, Open application, Pipeline (board and list), Application, Profile (four tabs), Settings, every wizard step and every dialog, in light and dark | the PRD's accessibility target |
| `truthful-resumes.spec.ts` | A made-up bullet and an inflated verb never reach the resume; a banned word is left out | T1 P5 |
| `electron-smoke.spec.ts` (project `electron`) | The desktop window shows the wizard, `window.jobgoblin` has a token, an outside link and an outside navigation do not move the window, Quit exits 0 and the server cleans up | ARCHITECTURE 13 |

## Notes for whoever writes the next test

- Locate by role and name. `data-testid` is used only where [the dashboard README](../apps/dashboard/README.md) says so: `run-card`, `needs-you-item`, `pipeline-card`.
- Do not sleep. Wait for what the person would wait for (a heading, a status line, a count); `waitUntilNoRunIsActive` for background work with no visible end.
- A precondition that is not the point of the story (an application that is already Applied) may be set through the public API (`approveAndMarkApplied`); the story that shows those screens is `review-approve-apply.spec.ts`.
- Tests never touch the network, a real Claude Code or the person's real folders.
