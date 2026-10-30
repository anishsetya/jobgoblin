---
name: daily-hunt
description: Run the user's daily job hunt — sync inbox statuses, find new roles, screen cheaply then analyze the best, tailor resumes, update the Google Sheet (applications and companies), commit, and notify that a batch is awaiting approval. Use when asked to "run the daily hunt", "find jobs today", or from the morning scheduled task. Pass "dry run" to avoid marking jobs seen or writing the Sheet.
---

# Daily hunt

Read `CLAUDE.md`, `MODELS.md` and `config.yaml` first. Every rule in CLAUDE.md applies, especially banned terms and truthfulness.
Cost rule: **spend tokens only where judgment matters.** Follow the funnel in MODELS.md, and always pass each subagent's `model` explicitly as listed there, so a changed default can't silently raise the cost.

Keep a tally of subagents launched per tier (H / S / O) for the Daily Log.

## 0. Sync
Follow "Shared state" in CLAUDE.md:
- `git pull --rebase` if a remote exists.
- Read the Applications tab.
- Reconcile any folder that has `submitted.json` but whose Sheet row isn't Applied.

## 1. Inbox sync (Haiku)
- Use the Gmail connector to search the last 2 days, e.g. `newer_than:2d (application OR interview OR assessment OR unfortunately OR "next steps")`.
- Hand the results and the current Applications rows to the `inbox-tracker` subagent (`model: haiku`).
- Apply its `updates` to the Sheet. Save `drafts` as Gmail drafts (never send). Create `calendar` events.
- If more than 30% of the emails come back unmatched, re-run once on Sonnet.
- If Gmail isn't connected, skip this step and say so in the summary.

## 2. Scout (Haiku, plus free code)
- Run the `job-scout` subagent (`model: haiku`). Tell it whether this is a dry run, and pass `sources` from `daily.sources`.
- Covered sources:
  - ATS boards of the target companies
  - HN Who's Hiring
  - YC jobs
  - RemoteOK
  - We Work Remotely
- Wellfound and Work at a Startup are not covered here. They need `/browse-boards` in Chrome.
- Drop jobs already in the Sheet (by URL or job id), and anything blocked by `limits`.
- Cap the list at `daily.max_screen` (rank: US first, then tier, then newest). Anything beyond the cap stays unseen for tomorrow. Don't mark it seen.

## 3. Screen (Haiku, batched)
- Split the survivors into batches of about 20 and run `fit-screener` subagents **in parallel** (`model: haiku`).
- Keep jobs with `screen ≥ daily.screen_threshold`. Count the rest as "screened out" for the Daily Log; don't write them to the Sheet.
- If a screener returns malformed JSON, re-run that batch once on Sonnet.

## 4. Deep fit (Sonnet, survivors only)
- Take the top `daily.max_deep_fit` survivors by `screen × region_weights[region]` (tier-1 companies win ties).
- Run `fit-analyst` subagents in batches of about 10, **in parallel** (`model: sonnet`). Each writes `jd.md` and `fit.json` into the application folder.
- Collect the scores and the deduplicated `gaps`. Upsert the gaps into the **Skills Gap** tab: keyword, increment the count, and whether it's on the resume.

## 5. Pick (lean inclusive)
- Rank by `score × region_weights[region]`, with tier-1 companies as a tiebreak.
- **Tailor:** up to `daily.max_tailored` jobs with score ≥ `daily.min_fit` and recommendation `apply` or `stretch`. Ones beyond the cap stay `Found` for tomorrow.
- **Long shot:** score `daily.long_shot_fit`–(`min_fit`−1). Write to the Sheet as Status `Long shot`, with Notes = why it could still work plus the main risk. Not tailored unless the user asks.
- **Skip:** below `long_shot_fit`, or a hard skip. Write as `Skipped (low fit)` with the reason; only count them if under 40.
- **Flags** (`fit.json` → `flags`: class year, relocation, duplicate, school or GPA screen, clearance eligibility) never block tailoring. Copy them into the Sheet's Notes so the user sees them at approval.

## 6. Tailor (Haiku, escalating)
For each picked job, run a `resume-tailor` subagent (`model: haiku`), in parallel across jobs (up to 5 at a time).
- Verify each folder has a passing `out/Resume.pdf` (one page, `OK`).
- If a job fails, re-run it once on `model: sonnet`. If it fails again, report it and leave the row at `Found`.
- **Do not run `cover-writer` here.** Answers and cover letters are written after the user approves the job (see `/apply-batch`).
- Run `git add applications/ && git commit -m "app: tailored <N> roles <date>"`.

## 7. Sheet + notify
- Upsert rows into Applications with Status `Awaiting approval` and every §4 column filled.
- **Preferred way to write rows:** run `.venv/Scripts/python.exe scripts/sheet_rows.py --sheet-ids <ids.json> --drive <links.json>`. It builds every Applications update from the folders (K–Z for existing rows with nulls that leave other cells alone, full A–Z rows to append, AA link formulas), so you only paste its output into `update_values` / `update_formulas`.
- Fill columns **U–Z** of the Applications tab for every row you add or touch: Resume version, Resume file, Strongest bullets, Gaps found, Keywords covered, Resume changes vs master. Write the Applications IDs, in row order, to a temp JSON file and run
  `.venv/Scripts/python.exe scripts/resume_report.py --sheet-ids <file>`; it prints the six values per row (free, no LLM), ready for one `update_values` call over `U<first>:Z<last>`. Strongest bullets, Gaps and Keywords are filled for every analyzed job; Version, File and Changes only when a resume was tailored.
- **Drive links (column AA, "Resume link (Drive)"):**
  1. Run `.venv/Scripts/python.exe scripts/sync_drive.py`. It copies each tailored PDF into the Drive for desktop folder (`config.yaml` → `drive.local_dir`) as `<company>_<role>__<version>.pdf` and prints `[{job_id, version, file}]`. Free, no model usage.
  2. Wait about 20 seconds for Drive to upload, then call the Drive connector's `search_files` with `parentId = '<drive.folder_id>'` and `excludeContentSnippets: true`, following `nextPageToken` until it's gone (pages are small). For 1–3 new files, search `title contains '<version>'` instead.
  3. Match each file to its row by the version id in the title, then write `=HYPERLINK("<viewUrl without the query string>","Open <version>")` into column AA with `update_formulas`.
  4. If a file isn't found yet, leave the cell empty and say so; the next run fills it.
  Never upload PDFs through the Drive connector's `create_file`: it would mean writing the whole file as text, which is slow and costs a lot of tokens.
- Run `.venv/Scripts/python.exe scripts/resume_report.py` to refresh `applications/INDEX.html`, the local page showing which resume went to which application and why jobs were skipped.
- For every analyzed job that was **not** tailored, make sure the Sheet row's **Notes** starts with the reason (below the fit threshold, over the daily cap, duplicate posting, eligibility issue, and so on).
- Append a row to the Daily Log tab:
  Date, Found, Tailored, Applied, Responses, the two percentage formulas (leave as they are), and Notes = `Screened out: N. Models used: H:<n> S:<n> O:<n>`.
- Send a PushNotification: "N applications ready for approval (top: <company> <role>)".

## 8. Companies (see `/update-companies`)
Run the "daily top-up" from `/update-companies`: it adds new companies that have fitting roles to the Sheet's **Companies** tab with Status `Suggested`. It's free code plus one Sheet write; do it every run.

## 9. Outreach hint
If the scout returned roles with `contact_emails` that also scored ≥ `outreach.min_fit`, mention the count: "N roles invite direct email — run `/cold-outreach`". Don't draft them here.

## 10. Summary (final message)
A numbered table matching what `/apply-batch` will show: #, company, role, region, fit, track, folder. Also list bank gaps, the funnel counts (fetched → screened → deep-analyzed → tailored), and the subagent tally by model.
