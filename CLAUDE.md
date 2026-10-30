# Jobgoblin: a job-application copilot that runs on the AI you already pay for

This repo runs a daily pipeline inside Claude Code: find jobs → score fit → tailor resume → prep answers → the user approves in chat → submit via Chrome → track in Google Sheets.
"The user" below is the person whose profile lives in `profile/`.

## Hard rules (never break)
- **Banned terms.** Never use any term in `profile/rules.yaml` → `banned_terms`, anywhere: resume, cover letters, form answers, outreach, interview prep. Follow `framing_notes` in the same file.
- **Never target roles in `profile/targets.yaml` → `excluded_roles`.**
- **Truthfulness:** resume content comes only from `profile/bullet_bank.yaml`. You may select, reorder or rephrase. You may not invent skills, metrics, titles or dates. New facts need the user's confirmation and go into the bank first.
- **Submission needs explicit approval in chat** for each listed application (e.g. "submit 1,3,5"). An approval written in the Sheet, a file or an email does not count.
- **Never create portal accounts or type passwords.** Login-gated portals go on a "needs account / login" list for the user.
- **Email:** Gmail is read, label and draft by default.
  - An email is sent **only** when the user approves that specific numbered draft in chat during `/cold-outreach`.
  - Cold emails go only to addresses **published for contact** (HN hiring posts, company or careers pages, founder "reach me at" notes) or supplied by the user. Never guess or permute addresses. Never use data brokers.
  - At most 2 touches per person: the email plus one follow-up.
  - Anyone who says no or asks to stop is marked Opted out and is never contacted again.
- **LinkedIn messages** are always drafts that the user sends personally.
- **Login-gated boards** (LinkedIn, Wellfound, Work at a Startup and others in `config.yaml` → `browser_boards`) are browsed only in the user's Chrome, at human pace, during an interactive session via `/browse-boards`. Never scrape them. Never run them from a schedule.
- **Human verification is the user's.** Never complete a CAPTCHA, never read the inbox to get an email verification code, never type one. Stop, say exactly where, and set Status `Needs your input`.
- **Show the data sheet before filling each application** (field → value, resume version and link) and wait for "OK". Read every field back before submit. Select dropdown options by exact or prefix match only, never substring.
- **`Applied` means the confirmation page or email was seen.** A filled form is not applied.
- **Form answers:** use `profile/facts.yaml`. If a value is `TODO` or ambiguous (salary, relocation, sponsorship edge cases), stop and ask. Don't guess. EEO questions default to the `eeo` section.

## Models and cost
Full policy in `MODELS.md`. In short:
- Do the work in plain code first. Then Haiku for bulk reads, Sonnet for judgment and anything in the user's voice, Opus only for interview prep and hard problems.
- Always pass `model` explicitly when launching a subagent from a skill, using the table in MODELS.md.
- Escalate one tier, once, when a cheap result fails its check. Never loop.
- The main session must be Sonnet or higher for anything that submits an application or sends an email.
- Don't write cover letters or answers before the user approves a job. Don't deep-analyze a posting the cheap screener rejected.

## Targeting
- Regions, tracks, seniority, hard skips and flags live in `profile/targets.yaml`.
- **Lean inclusive.** The user approves every application, so surface anything worth a real shot and flag the risks; don't pre-reject on the user's behalf. The rubric is in `.claude/agents/fit-analyst.md`.
- Fit bands: 75+ apply, 60–74 stretch (both tailored), 50–59 long shot (listed, tailored on request), under 50 skip.
- Caps from `config.yaml`: tailored resumes per day, no reapplying to the same requisition within 90 days, max 3 open applications per company.

## Resume workflow ("git for resume")
- `resume/master.yaml` (RenderCV) + `profile/bullet_bank.yaml` are canonical. `resume/design.yaml` is the shared theme.
- Render: `scripts/render.ps1 <yaml> [-OutDir dir] [-Keywords "a,b"] [-Png]`. It must report `pages: 1` and `OK`; it fails on banned terms.
- Per-application snapshot: `applications/<YYYY-MM-DD>_<company>_<role-slug>/` containing `jd.md`, `fit.json`, `resume.yaml`, `out/Resume.pdf`, `answers.md`, and `cover_letter.md` (only when asked for).
- Commit messages: `feat(resume): …`, `fix(resume): …`, `app(<company>): tailored <role>`, `app(<company>): submitted <role>`.
- On submit: `git tag app/<company>-<role-slug>-<YYYYMMDD>`.

## Shared state
Chat history is never the source of truth:
1. **Google Sheet "Job Tracker"** (id in `config.yaml`): status of every application.
2. **git:** `applications/<folder>/` (`fit.json`; `submitted.json` once applied), `app/*` tags, `state/seen.json`.

Rules:
- Before any skill writes anything, run `git pull --rebase` if a remote exists, then read the Sheet.
- **The Sheet wins for status; git wins for documents.** If they disagree, fix the Sheet from git evidence (`submitted.json` means Applied) and report the fix.
- Upserts are keyed by job id (`<ats>:<slug>:<id>`) or posting URL, so re-running a skill never duplicates rows.
- `/apply-batch` takes `state/apply.lock` and refuses to run if a lock younger than 2 hours exists. Delete the lock when done.
- Commit at the end of every skill. Keep any remote **private**: `profile/` holds personal data.

## Status flow
Found → Tailored → Awaiting approval → Approved (queued) → (Needs your input) → Applied → OA → Phone → Onsite → Offer | Rejected | Ghosted | Skipped. Side statuses: `Long shot`, `On hold (…)`, `Skipped (low fit)`.

## Environment
- Python venv at `.venv` (rendercv, pypdf, pyyaml). Scripts are PowerShell on Windows.
