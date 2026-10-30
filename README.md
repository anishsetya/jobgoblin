# Jobgoblin

**A free, open-source job-application copilot that runs on the AI subscription you already pay for.**

Paid job-application apps charge a separate subscription for their own AI. Jobgoblin doesn't: it does the bookkeeping, rule-checking and tracking in plain code, and borrows the brains of the Claude plan you already have.

It finds roles, scores how well you fit, tailors a one-page resume using **only achievements you have confirmed**, prepares form answers, and tracks everything. **Nothing is submitted until you approve it.**

> **Status: early prototype.** Today Jobgoblin runs inside [Claude Code](https://code.claude.com) as a set of skills and agents, and you drive it with slash commands. A desktop app with a click-only setup wizard and a dashboard is being designed: see the product requirements and design docs as they land in `docs/`.

## What it does

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

## Principles

- **You approve every application.** No mass auto-apply, no CAPTCHA solving, no account creation.
- **Truthful resumes.** Every bullet must come from your bullet bank; a render fails on banned terms or a second page.
- **Your data stays yours.** Profile, resumes and applications live in your folder and are git-ignored.
- **Cheap by design.** Plain code first, then the cheapest model that passes a check (see `MODELS.md`).

## Setup (prototype)

1. Install [Claude Code](https://code.claude.com) and sign in with your Claude plan.
2. Clone this repo and create a Python venv with `rendercv`, `pypdf` and `pyyaml`.
3. Copy each `*.example.yaml` to the same name without `.example` (`config.yaml`, `profile/*.yaml`, `resume/master.yaml`) and fill them in.
4. Open Claude Code in this folder, approve the `jobs` MCP server, and run `/daily-hunt`.

## License

[AGPL-3.0](LICENSE).
