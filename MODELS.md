# Model guidelines for Jobgoblin

**Principle: spend tokens only where judgment or voice matters. Everything else is code or a cheap model.**

This file is the policy. The model each agent actually uses is the `model:` line in its file under `.claude/agents/`.
The aliases `haiku`, `sonnet` and `opus` always mean the latest model of that tier. Haiku is the cheapest tier and Opus the most expensive; check current pricing before relying on any numbers.

## The ladder (cheapest first)

| Tier | Use for | Never use for |
|---|---|---|
| **0. Plain code (free)** | Fetching, filtering, deduping, ranking, title and region rules, company discovery, rendering PDFs, one-page and banned-word checks, git, Sheet row math | n/a. Move work down to this tier whenever it can be a rule |
| **1. Haiku** | Bulk, structured, low-stakes reads: scouting a list, screening 20 postings at once, classifying emails, formatting rows | Anything outward-facing (submitting, emailing), anything in the user's voice |
| **2. Sonnet** | Resume tailoring, deep fit analysis, cold emails, cover letters and form answers, company research, the main orchestrating session, **submitting applications and sending approved emails** | Bulk work a rule or Haiku can do |
| **3. Opus** | Interview prep (rare, high value), a hard resume rewrite when the user asks, debugging a pipeline failure that Sonnet couldn't fix | Anything that runs daily, or in bulk |

## Who uses what

| Agent / step | Model | Why |
|---|---|---|
| `job-scout` | Haiku | Reads structured lists and applies simple rules |
| `fit-screener` (stage 1 of fit) | Haiku | 20 postings per call, 2000 characters each, coarse score only |
| `fit-analyst` (stage 2 of fit) | Sonnet | Full JD read plus bullet matching; runs only on screen survivors |
| `resume-tailor` | **Haiku first, Sonnet on failure** | Constrained edit of a YAML file with automatic checks (one page, banned terms). The render script is the safety net |
| `cover-writer` | Sonnet | The user's voice. Runs **only for approved applications**, not for the whole batch |
| `inbox-tracker` | Haiku | Classifying emails into statuses |
| `cold-emailer` | Sonnet | Voice and specificity decide whether an email gets a reply |
| `outreach-drafter` | Sonnet | Same |
| `market-researcher` | Sonnet | Weekly only; synthesis across sources |
| `interview-prep` | Opus | Rare and high value; runs on demand |
| **Main session** (orchestrating, `/apply-batch`, `/cold-outreach` sending) | **Sonnet or higher, never Haiku** | Form filling and email sending are outward-facing and hard to undo |
| **Scheduled runs** (`/daily-hunt`, `/weekly-review`) | Sonnet orchestrator | Set it on the scheduled task; it spawns Haiku and Sonnet subagents itself |

## Form filling (`/apply-batch`)

Default: the main session (Sonnet or higher) fills, reads back and hands over Submit. Filling is where the Stripe mistakes happened (a wrong dropdown match, text typed into the wrong field after a layout shift), and a wrong answer on a real application is hard to undo.

**Haiku pilot (opt-in, not yet proven):** the user says "pilot Haiku fill". Then:
1. Sonnet resolves every value first and the user OKs the data sheet. Haiku gets a finished field → value list and makes **no** decisions.
2. A Haiku subagent (`model: haiku`) does the clicking and typing in a Chrome tab, up to but never including Submit.
3. A code check reads the form back and compares it to the data sheet (`requiredReport()` plus a field diff). Sonnet reviews the diff and screenshot.
4. Any mismatch, or a stuck field after two tries → Sonnet takes over that form once. A legal box, salary or other unlisted question is never Haiku's call; it stops and asks.
5. Judge the pilot on 3 forms: zero wrong fields in the diff means Haiku can keep the mechanical fill; otherwise drop it. Don't expect large savings: the cost is mostly screenshots, not reasoning.

Most savings come from tier 0: a per-portal field-map script that fills known ids without a model.

## Where the model is set (module-level control)

| Level | How | Used for |
|---|---|---|
| Agent file | `model:` line in `.claude/agents/<name>.md` | The default for that subagent |
| Per call | The Agent tool's `model` parameter (`haiku` / `sonnet` / `opus`) | Overriding for one run, and escalation retries |
| Session | `/model` or the app's model picker | The main conversation, which runs the skills |
| Scheduled task | The model set on the task itself | `/daily-hunt`, `/weekly-review` |

So control is per agent and per call, not per skill: a skill runs in the main session's model and picks a model for each subagent it launches.

## Escalation rules (try cheap, then step up)

A skill calls the Agent tool with the default model, and re-runs on the next tier only when:

1. **`resume-tailor` (Haiku)** produces a PDF that fails `scripts/render.ps1` (more than one page, a banned term, an invalid YAML) twice → re-run once on **Sonnet**. If that also fails, report it. Don't loop.
2. **`fit-screener` (Haiku)** returns malformed JSON → re-run that batch once on Sonnet.
3. **`inbox-tracker` (Haiku)** returns "unmatched" for more than 30% of emails → re-run once on Sonnet.
4. Anything flagged `NEEDS USER` is never escalated; it goes to the user.

Escalation is **one step, once**. There are no retry loops.

## Funnel (how the daily run stays cheap)

```
~300 postings fetched          code (free)
  └ title / region / seniority rules + dedupe       code (free)        → ~40–60
      └ fit-screener, 20 per call                   Haiku              → keep screen ≥ 55
          └ fit-analyst, full JD                    Sonnet             → top ~15–25 only
              └ resume-tailor per pick              Haiku (→ Sonnet)
                  └ [you approve in chat]
                      └ cover-writer / answers      Sonnet, approved jobs only
                          └ submit                  main session (Sonnet+)
```

Rules of thumb:
- **Batch.** One screener call handles ~20 jobs, so the instructions are paid once.
- **Truncate.** Cheap agents read 2000 characters (`get_job max_chars`), never the full posting.
- **Lazy.** Don't write cover letters or answers for jobs the user hasn't approved.
- **Cap.** `config.yaml` → `daily.max_deep_fit` and `daily.max_tailored` limit the expensive stages, no matter how many jobs come in.
- **Cache.** `state/seen.json` ensures no posting is analyzed twice.

## Changing a model

- Permanently: edit the `model:` line in the agent file, and update the table above.
- For one run: tell Claude ("run the hunt with everything on Sonnet"). The skills pass a model override per call.
- Scheduled tasks: the model is set on the scheduled task itself.

## Tracking cost

Claude Code doesn't expose exact token counts to skills, so the Daily Log tab's **Models used** column records how many subagents ran on each tier (e.g. `H:6 S:18 O:0`). Compare that to the number of jobs found; the ratio tells you if the funnel is working. Per-session usage is also visible in the app's usage view.
