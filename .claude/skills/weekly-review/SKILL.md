---
name: weekly-review
description: Weekly funnel and market review — application funnel metrics by track/region/resume variant, skills-gap trends via the market-researcher subagent, proposed resume and targeting changes. Use on Sundays (scheduled) or when the user asks "how is the search going".
---

# Weekly review

## 1. Funnel
From the Sheet's Applications tab, compute for the last 7 days and all-time:
- found → tailored → applied → OA / Phone / Onsite → offer
- response rate by track, by region and by tier
- median days to first response
- ghosted count (no response after 21 days; set those rows to `Ghosted`)

## 2. Market + skills
Run the `market-researcher` subagent (`model: sonnet`). It writes `reports/<date>-market.md`.

## 2b. Companies
Run the "Weekly refresh" and "Apply the user's decisions" parts of `/update-companies`. Include the top 5 `Suggested` companies in the proposals below.

## 2c. Cost check
From the Daily Log's **Notes**, total the subagents by tier for the week and compare them to the jobs found. If the Sonnet share keeps growing, or Opus ran daily, say so and suggest which `daily.*` cap to lower.

## 3. Proposals (do not apply without approval)
- **Targeting:** shift `config.yaml` thresholds or region weights; add or remove companies in `companies/candidates.yaml`, then re-run `tools/jobs-mcp/validate_targets.py`.
- **Resume:** list the bullet emphasis changes. Ask the user about new true achievements that fill the top gaps, then hand off to `/resume-update`.
- **Skill-up:** this week's 1–2 focus items from the report, each with a concrete deliverable.

## 4. Write + commit
- Write `reports/<date>-weekly.md` with the funnel table, proposals and focus items.
- Commit with `chore(review): week of <date>`.
- Show the user the summary and the proposals awaiting a yes/no.
