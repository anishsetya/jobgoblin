# Contributing to Jobgoblin

Thanks for wanting to help. Jobgoblin is a free, open-source job-application copilot. It is in developer preview, so some parts are rough and things change quickly.

## Before you start

- **Bug or idea?** Open an issue using one of the templates. For anything bigger than a small fix, talk about it in an issue first, so nobody builds the same thing twice.
- **Security problem?** Do not open a public issue. See [SECURITY.md](SECURITY.md).
- **New to the code?** Read the [reading order in the README](README.md#start-here-reading-order). It is the fastest way in. The rules are in [docs/poc/ARCHITECTURE.md](docs/poc/ARCHITECTURE.md) and [docs/poc/CODE_STYLE.md](docs/poc/CODE_STYLE.md).

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
