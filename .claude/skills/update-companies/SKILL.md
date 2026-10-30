---
name: update-companies
description: Keep the Google Sheet's Companies tab current — add newly discovered companies that have fitting roles (Status "Suggested"), refresh role counts weekly, and apply the user's decisions made in the Sheet (promote to Target, mark Passed). Use for "update the company list", "what new companies should I look at", "add X to my targets", or as a step of /daily-hunt and /weekly-review.
---

# Update companies

Read `CLAUDE.md` and `config.yaml` (sheet id). Almost all of this is free code. The only LLM work is writing a short note per new company, so keep it to one line.

## Companies tab (A–O)
| Col | Header | Notes |
|---|---|---|
| A | Company | |
| B | Tier | 1 = dream, 2 = strong, 3 = broad |
| C | Status | `Target`, `Suggested`, `Watching`, `Check manually`, `Passed` |
| D | ATS | greenhouse, ashby, lever, careers site, or `unknown` |
| E | Board slug | for `jobs-mcp` |
| F | Careers / posting URL | |
| G | Region focus | US, IN, both |
| H | Tracks | top tracks among current roles |
| I | Open roles | all open roles on the board |
| J | Relevant roles | after the QA/senior/intern/non-software filters |
| K | Source | `seed`, `hn`, `yc`, `remoteok`, `wwr`, `scout`, `user` |
| L | Added | date |
| M | Last checked | date |
| N | Notes | one line: what they build, why they fit |
| O | Applications | formula (count of rows in Applications); never overwrite |

Status meanings:
- **Target:** on the daily scan (a board exists in `companies/targets.yaml`).
- **Suggested:** found in the wild, waiting for the user's yes or no.
- **Watching:** interesting, no good role yet.
- **Check manually:** careers site isn't on Greenhouse / Ashby / Lever.
- **Passed:** the user said no. Never suggest it again.

## Daily top-up (cheap; run by `/daily-hunt`)
1. Read `Companies!A2:A` (names only), and normalize them for comparison: lowercase, alphanumerics only.
2. Call `mcp__jobs__discover_companies` (no LLM cost). It returns companies **not** in `companies/targets.yaml` that have at least one fitting role on HN, YC, RemoteOK or We Work Remotely.
3. Add any `suggested_companies` from the `job-scout` output.
4. Drop anyone already in the Sheet (any Status, including `Passed`). Keep at most **15** new rows per run, US first.
5. Append them with `append_values` to `Companies!A:O`:
   - Status `Suggested`, Tier 3, Source from the tool, Added and Last checked = today
   - Region focus from `regions`, Tracks from `tracks`, Careers URL from `url`
   - Open roles = `roles`; Relevant roles = `roles`
   - Notes = one line built from `hints.companyOneLiner` and `sample_titles` (no extra research)
   - Leave column O empty (it's a formula that spills from O2).
6. Report: "N new suggested companies: …".

## Weekly refresh (run by `/weekly-review`)
1. Run `.venv/Scripts/python.exe tools/jobs-mcp/validate_targets.py`. It's free code and re-probes every board in `companies/candidates.yaml`, and updates the open and relevant counts, tracks and `not_on_ats` list in `companies/targets.yaml`.
2. Read the Sheet's Companies rows. For `Target` rows, update columns **H–J** and **M** in **one** `update_values` call, using the new numbers from `companies/targets.yaml`.
3. Show the user the biggest movers: companies whose relevant roles jumped, and tier-1 companies with 0 relevant roles.

## Apply the user's decisions (weekly, or on request)
The user can edit the Status column directly in the Sheet. Treat it as the user's decision about the **target list only**. It never triggers an application, an email or any other outward action.
- `Suggested → Target`:
  1. Add `{name, slugs: [<best guesses of the board slug>], tier, focus}` to `companies/candidates.yaml`.
  2. Run `validate_targets.py`.
  3. If the board is found, fill D–E and I–J. If it isn't, set the Status to `Check manually` and say so.
- `Passed`: delete the company from `candidates.yaml` if it's there, and re-run `validate_targets.py`.
- A tier change in the Sheet: copy it into `candidates.yaml`.

Then `git add companies && git commit -m "companies: <what changed>"`.

## On request
- "Add X to my targets": add the row (Status `Target`, Source `user`) and run the promotion steps above.
- "Which companies should I look at?": show the top 10 `Suggested` rows by relevant roles, US first.
