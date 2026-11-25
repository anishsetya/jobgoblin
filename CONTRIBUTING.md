# Contributing to Jobgoblin

Thanks for wanting to help. Jobgoblin is a free, open-source job-application copilot. It is in developer preview, so some parts are rough and things change quickly.

## Before you start

- **Bug or idea?** Open an issue using one of the templates. For anything bigger than a small fix, talk about it in an issue first, so nobody builds the same thing twice.
- **Security problem?** Do not open a public issue. See [SECURITY.md](SECURITY.md).
- **New to the code?** Read the [reading order in the README](README.md#start-here-reading-order). It is the fastest way in. The rules are in [docs/poc/ARCHITECTURE.md](docs/poc/ARCHITECTURE.md) and [docs/poc/CODE_STYLE.md](docs/poc/CODE_STYLE.md).
- **Looking for something to pick up?** Start with [`good-first-issue`](https://github.com/anishsetya/jobgoblin/issues?q=is%3Aopen+label%3Agood-first-issue). Say in the issue that you are taking it, so two people don't work on the same thing.

## How we track work

All work is tracked in GitHub Issues. Labels tell you what an issue is, how urgent it is, and which part of the code it touches.

### Type: what kind of work it is

Every issue has exactly one type. The issue form you pick sets it for you.

| Label | Means | Example |
| --- | --- | --- |
| `type:bug` | Something is broken: the app does the wrong thing, or a test fails on `main` | "Double-clicking Approve shows an error after it worked" |
| `type:enhancement` | A small change to something that already works | "Long names should wrap instead of scrolling the page" |
| `type:feature` | A new capability the app does not have yet | "Show live progress in the Running cards" |
| `type:chore` | Work a user never sees: refactors, tooling, tests, docs, CI | "Run unit and e2e tests in GitHub Actions" |
| `type:epic` | A larger goal made of other issues (its sub-issues) | "Ready for five outside testers" |

**Bug or enhancement?** If the app does what it was designed to do, but that could be better, it is an enhancement. If it does something it was never meant to do, it is a bug.

**Enhancement or feature?** Changing a screen or a flow that exists is an enhancement. Adding one that doesn't exist yet is a feature.

### Priority: how urgent it is

Maintainers set the priority during triage.

| Label | Means |
| --- | --- |
| `priority:p0` | Data loss, or an application that could go out with something the person did not approve. Fixed first. |
| `priority:p1` | The main flow is broken: setup, finding jobs, review, approve, or recording that you applied. |
| `priority:p2` | Everything else. |

### Area: which part of the code it touches

These follow the folders in the repository. An issue can have more than one.

| Label | Where |
| --- | --- |
| `area:dashboard` | `apps/dashboard`, the screens |
| `area:server` | `packages/server`, the local server and its services |
| `area:core` | `packages/core`, the pure rules (filters, data sheets, the truth trace) |
| `area:storage` | `packages/storage`, the database |
| `area:resume` | Resume rendering |
| `area:runner` | How Claude Code runs are started, queued and stopped |
| `area:mcp` | The tools a Claude run can call |
| `area:e2e` | `e2e/`, the Playwright tests |
| `area:docs` | The README, the user guide and the other docs |

### Workflow

| Label | Means |
| --- | --- |
| `needs-triage` | New. A maintainer has not yet checked it or set its priority. The issue forms add it. |
| `blocked` | Waiting on something else. The issue says what. |
| `good-first-issue` | Small, well described, and a good way to learn the code |

### Epics and the board

A big goal is an epic, and the issues that make it up are its sub-issues. On GitHub, an epic shows how many of its sub-issues are done, and each sub-issue links back to its epic. We keep this to two levels: an epic, then its issues.

Maintainers plan the work on a GitHub Project board with these columns: Backlog, Ready, In progress, In review and Done. An issue moves to In review when a PR for it is opened, and to Done when the PR is merged.

### Searches worth bookmarking

Paste these into the search box on the Issues tab:

| To find | Search |
| --- | --- |
| Open bugs | `is:open label:type:bug` |
| Anything urgent | `is:open label:priority:p0,priority:p1` |
| Small improvements | `is:open label:type:enhancement` |
| One part of the code | `is:open label:area:dashboard` |
| Good first issues | `is:open label:good-first-issue` |
| Not yet triaged | `is:open label:needs-triage` |

## Set up

You need Node 24 and pnpm 10. The pnpm version is pinned in the `packageManager` field of [package.json](package.json), so [corepack](https://nodejs.org/api/corepack.html) picks it up for you.

```bash
pnpm install
pnpm test
```

| Command | What it checks |
| --- | --- |
| `pnpm typecheck` | TypeScript types in every package |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:e2e` | Browser and desktop tests (Playwright). The first run needs `pnpm --filter @jobgoblin/e2e exec playwright install chromium` |
| `pnpm lint:deps` | Dependency rules, such as "only the storage package opens the database" |

You do not need a Claude plan to develop. The README's "Run it" section explains the demo mode, which uses a saved job board and a fake `claude` command.

CI runs on Windows, and the app is developed on Windows, because process handling and the e2e harness are written for it. If you work on macOS or Linux, say so in your PR and list what you ran.

## Making a change

1. Fork the repository and create a branch from `main`, for example `fix/runner-timeout` or `docs/readme-setup`.
2. Keep each PR to one idea. Small PRs get reviewed faster.
3. Add or update tests. Run `pnpm typecheck` and `pnpm test`. If you touched the dashboard or the desktop flow, also run `pnpm test:e2e`.
4. Update the docs if behavior changed: the README, or the README of the package you changed.
5. Open the PR and fill in the template. Link the issue it closes with `Closes #123`.

We squash-merge every PR, so the PR title becomes the commit message on `main`.

### Commit and PR titles

We use [Conventional Commits](https://www.conventionalcommits.org/) with the area in brackets. Recent history has examples:

- `feat(setup): honest resume upload errors`
- `fix(runner): accept Claude Code's 'Task' name for the subagent tool`
- `test(e2e): upload a resume inside the Electron app`
- `docs: user guide for every feature`
- `chore(github): issue forms and PR template`

### Code style

Code is written to be read and learned from. Comments explain **why**, not what. The full rules are in [docs/poc/CODE_STYLE.md](docs/poc/CODE_STYLE.md).

## Rules that protect people's data

Jobgoblin handles personal data, so these rules are strict.

- **Never commit personal data.** That means nothing from `profile/`, `applications/`, `state/`, `config.yaml`, or a real resume. Use the fake person in `fixtures/` (Alex Rivera) for tests and examples.
- **Keep the approval gate.** Nothing is submitted to an employer until the person approves that exact application. Do not add a path around it, even for testing.
- **Keep the truthfulness checks.** Resume lines must trace back to a story the person confirmed. A change that weakens this check needs a strong reason and a test.
- **Keep the dependency rules.** `pnpm lint:deps` enforces them. Fix the code rather than working around the check.

## Licensing

Jobgoblin is licensed under the [GNU Affero General Public License v3.0](LICENSE). By submitting a contribution, you agree that it is licensed under the same terms.

## Questions

Open an issue with a clear title. Please be patient: maintainers are volunteers.

By taking part in this project, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
