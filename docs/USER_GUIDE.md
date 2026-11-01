# Using Jobgoblin

Jobgoblin runs your job search on the Claude plan you already have. It finds roles, scores how well you fit, writes a truthful one-page resume for each, and tracks every application. Nothing is submitted until you approve it, and you click Submit on the company's site yourself.

This guide covers the developer preview, which you run from source. A one-click installer comes with the public release.

## Two ways to run it

| Mode | Who does the thinking | Job boards | Use it to |
| --- | --- | --- | --- |
| **Real** | Your own Claude Code, on your Claude Pro or Max plan | Live public boards (Greenhouse, Lever, Ashby, HN, YC, RemoteOK, We Work Remotely) | Apply for real jobs |
| **Demo** | The "fake claude": a scripted stand-in with fixed answers | Seven made-up jobs | See every screen without spending plan usage |

The demo mode cannot run a real job search: the fake claude knows nothing about you or real jobs. It only replays fixed steps so the app can be tested. To apply for real jobs, use Real mode.

## Before you start (once)

1. Install Node 22.13 or later and pnpm 10 (`npm install -g pnpm@10`).
2. Install Claude Code and sign in with your Claude plan:

   ```bash
   winget install Anthropic.ClaudeCode
   ```
   ```bash
   claude auth login
   ```

   The Connect Claude step of the wizard can also do both.
3. Get the code:

   ```bash
   git clone -b poc/developer-preview https://github.com/anishsetya/jobgoblin.git
   ```
   ```bash
   cd jobgoblin
   ```
   ```bash
   pnpm install
   ```

## Start the app

Real mode, as a desktop window:

```bash
pnpm dev:desktop
```

Or in your browser: run `pnpm dev`, then open the `http://127.0.0.1:…/#token=…` link it prints.

Demo mode (PowerShell, from the `jobgoblin` folder):

```bash
pnpm --filter @jobgoblin/fake-claude build
```
```bash
$env:JOBGOBLIN_FEED_FIXTURES = "$PWD\fixtures\feeds\demo"; $env:JOBGOBLIN_CLAUDE_COMMAND = "[`"$((Get-Command node).Source -replace '\\','\\')`",`"$("$PWD\fixtures\fake-claude\dist\cli.mjs" -replace '\\','\\')`"]"; pnpm dev:desktop
```

Your data lives in two places. The database is in `%APPDATA%\Jobgoblin` and you never touch it. Your documents go in the folder you choose (default `Documents\Jobgoblin`).

## 1. Setup wizard (once, about 15 minutes)

| Step | What you do | What happens |
| --- | --- | --- |
| 1 Welcome | Read the short intro | |
| 2 Connect Claude | Click Install or Sign in if needed | The screen shows Connected. Your Claude sign-in stays inside Claude Code; Jobgoblin never sees it. |
| 3 Your folder | Pick a folder | It creates `Applications`, `Resumes`, `Backups` and the tracker. If you pick a folder with backups, it offers Restore. This is how you move to a new computer. |
| 4 Your resume | Upload a PDF or Word resume, and optionally a LinkedIn PDF | Your name, email, phone and links are removed by the app first. Claude reads the rest and drafts your Your story items. |
| 5 Your story | Confirm, edit or drop each experience, achievement, project, skill and headline | Only confirmed items can ever appear on a resume or count toward a fit score. Add anything the resume left out. |
| 6 Form answers | Fill in work authorization, notice period, start date, salary and EEO answers | Anything missing is marked. Salary and EEO answers are never shown to Claude; the app fills them in itself. |
| 7 Targets | Roles you want, regions, the most years of experience a job may ask for, roles to avoid, hard skips, flags | These change the next job search. |
| Finish | | Your main resume is built from Your story. You land on Today. |

## 2. Today: your daily home

- **Find jobs** runs a search. A card shows each step in plain words ("Checking job boards", "Scoring fit", "Checking every bullet against your profile") with a progress bar and **Cancel**. Before the first run, a note explains that runs share your Claude plan's limits.
- **Add a job** takes a link or the job text. Public Greenhouse, Lever and Ashby links are read directly. For LinkedIn, Wellfound and other login-only sites, paste the company, title and job text.
- **Needs you** is the only place that asks for your attention:
  - **Ready to review:** a tailored resume is waiting for your decision.
  - **Long shot:** fit 50–59. Click Tailor if you want to try anyway.
  - **Question:** a run needs a fact only you know. Answer it here; only that one application waits, and the rest carry on.
  - **Ready to submit:** approved, with screening answers written.
  - **Follow-up due:** an application has had no reply by its follow-up date.
  - **Couldn't tailor:** the limit of 3 open applications per company was reached, or the resume could not pass the truth check.
  - **Run attention:** a run stopped (plan limit reached, signed out, interrupted). Use Retry or Dismiss.
- **Done today** counts jobs found, resumes tailored, approvals and applications.

How jobs are sorted: fit 75 or higher is **apply**, 60–74 is **stretch** (both tailored automatically), 50–59 is **long shot**, and under 50 is skipped. Roles to avoid, jobs asking too many years, and duplicates are dropped before Claude ever sees them. Each job is shown only once.

## 3. Review: one application at a time

You see the role, company and fit score with a one-line reason, the gaps, and the Your story items that matched.

- **Changes from your main resume** shows what was added, removed or reordered, with reworded lines highlighted before and after.
- **The resume preview** has a Download PDF button.
- **What will be sent** lists every form value; approving locks this exact list.

The tailored resume can only reword your confirmed items. The app refuses changed numbers, new tools or employers, and stronger verbs ("contributed to" cannot become "led").

| Key | Action |
| --- | --- |
| A | Approve. The PDF is built once and frozen, and screening answers are written. |
| E | Request edit, with a note. A new resume version comes back for review. |
| S | Skip. You can undo it from the application page. |
| J / K | Next / previous application |

## 4. Open application: you submit

1. Open the posting; it opens in your normal browser.
2. Copy each field and each screening answer with its copy button.
3. Attach the resume: `Your Name - Resume.pdf` in the application's folder (use Open resume file).
4. Click Submit on the company's site. CAPTCHAs, logins and email codes are always yours.
5. Back in Jobgoblin, click **I submitted** and choose your proof: confirmation page seen, pasted confirmation text, screenshot, or the confirmation email's subject.

The status becomes **Applied** and a follow-up date is set (7 days by default). If you change your contact details after approving, the app asks you to review again so the sent data always matches what you approved.

## 5. Pipeline and application pages

- **Pipeline:** a board by stage (To review, Ready to apply, Applied, Interviewing, Offer, Closed) or a list. It has search and filters, and overdue follow-ups show in amber.
- **Application page:** the job text, fit, every resume version, answers and full history. From here you can:
  - Record replies: OA, Phone screen, Onsite, Offer, then Accepted or Declined, or Rejected or Ghosted. Only moves that make sense are offered.
  - Withdraw, Undo skip, or Tailor a long shot.
  - **Ask about this application:** Claude answers questions about it.

## 6. Profile and Settings

- **Profile:** Your story, form answers, targets and banned words. A banned word fails any resume, answer or data sheet that contains it, and names the word.
- **Settings:**
  - Claude connection.
  - Your folder, and Open tracker (`Tracker.xlsx`).
  - Limits: open applications per company, days before reapplying, follow-up days.
  - Backups: last backup time, Back up now, and Restore.
  - Export to CSV or Excel. The CSV opens in Google Sheets.

## What is in your folder

```
Jobgoblin/
  Tracker.xlsx, Tracker.csv            every application, always current
  Applications/2026-11-01 Acme - Backend Engineer/
    Your Name - Resume.pdf             the exact file you sent
    Job description.md
    Answers.md
  Resumes/                             every approved version, never changed
  Backups/                             automatic, after changes and daily
```

## Applying for real jobs this week

1. Install and sign in to Claude Code.
2. Start Real mode (`pnpm dev:desktop`) and do the wizard with your real resume.
3. In Targets, set your roles and regions.
4. Click Find jobs. The app watches a starter list of about 100 companies on Greenhouse, Lever and Ashby, plus HN, YC, RemoteOK and We Work Remotely. Paste anything else you find with Add a job.
5. Review, approve, submit, and record proof. Then repeat daily.

**Preview caveat:** real Claude Code has been checked only partly so far (see `docs/poc/REAL_CLAUDE_CHECKLIST.md`). Watch your first runs closely and read each resume before you approve it.

## How it was tested

- **1,195 unit tests** check every rule: the status moves, the truth check, limits, backups, the run sealing (no shell, no personal settings, scrubbed environment) and every API route's security.
- **37 browser tests** (Playwright) click through every flow above: the wizard; find, review, approve, apply; skip and undo; edits; pasted jobs; questions; the pipeline; backups and export; cancel; crash recovery. They also run accessibility checks on every screen in light and dark mode, and an Electron smoke test.
- These tests use the **fake claude** and the demo job board, so they are free and give the same result every time.
