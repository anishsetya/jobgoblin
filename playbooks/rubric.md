<!-- rubric-version: 1 -->
# Fit rubric

Score how well one job fits one person, from 0 to 100. The person reads every result and approves every application
themselves, so your job is to surface every role worth a real shot and to be honest about the risks.
**Lean inclusive: flag, don't penalize.**

The question is "would a reasonable hiring manager interview this person?", not "does the person match every line?".
Postings are wish lists, and people who get interviews usually miss some listed items.

You are given the person's targets (`roles`, `regions`, `tracks`, `maxYearsRequired`, `rolesToAvoid`, `hardSkips`,
`flags`) and every confirmed item of Your story. Build your picture of the person from those and nothing else. Never
assume a skill, title, number or date they have not confirmed.

## 1. Hard skips (score 0, set `hardSkip`)

Score 0 and write a one-line `hardSkip` reason only when:

- the job matches one of the person's `hardSkips` (judge the work itself, not only the title)
- the work is one of the person's `rolesToAvoid`, even when the title hides it
- the posting requires more years of experience than `maxYearsRequired` (use the lowest number it states; "preferred"
  years do not count)
- the posting is closed or expired

Nothing else is a hard skip. Everything else is a flag (section 4) or simply a lower score.

## 2. Score (total 100)

| Part | Points | How to judge |
| --- | --- | --- |
| Role match | 35 | Does the day-to-day work map to what Your story shows the person has done or built? Adjacent work earns about 70% of the points. Work in a different field earns close to none. |
| Skills | 25 | Start at 25 and subtract for missing hard requirements, at most 12 in all (rules below). |
| Seniority | 20 | See the table below. |
| Region | 10 | See the table below. |
| Upside | 10 | The company or role fits the person's `roles` and `tracks`, or is friendly to someone at their stage. Do not reward brand names alone. |

Skills rules:

- Languages transfer. If the person knows any mainstream language, a different required language costs at most 2
  points, unless the posting demands deep expertise in it.
- Tools and frameworks are learnable: 2 to 3 points each when required, 0 to 1 when "preferred" or "nice to have".
- A role that leans heavily on the side of the stack the person has not worked on costs at most 8 in all, when Your story
  shows depth on the other side.
- A skill listed in Your story without a bullet counts as covered, not as a gap. Do not claim more depth than the story says.
- Never count the same gap twice ("TypeScript" and "TS / React").

Seniority, with M = `maxYearsRequired` and N = the lowest number of years the posting requires:

| The posting asks for | Points |
| --- | --- |
| New grad, early career, no number, or N of M - 2 or less | 20 |
| N = M - 1 | 15 |
| A range that starts below M and ends above M (for example 3 to 5 when M is 4) | 12 |
| N = M | 9 |
| Senior-level scope with no number (owns strategy, very high pay band) | 8 |

Region, with the job's `region` and the person's `regions`:

| The job is | Points |
| --- | --- |
| In one of the person's regions | 10 |
| Remote with no country, and the person lists a country | 9 (add the flag "Check you can work remotely from there") |
| Anywhere else | 3 (add a flag naming the region) |

## 3. Bands

| Score | Band | What happens |
| --- | --- | --- |
| 75 to 100 | apply | The resume is tailored |
| 60 to 74 | stretch | Tailored; the reason says what makes it a stretch |
| 50 to 59 | long shot | Listed for the person; tailored only if they ask. The reason says why it could still work |
| under 50 | skip | Not tailored |

## 4. Flags: tell the person, do not lower the score

Add a short plain-words flag for each of these that applies, and for every entry of the person's `flags` that applies:

- relocation or on-site work, or "must live in" a place
- a graduation-year or class-year window
- clearance "eligibility" (an active clearance required is a hard skip, not a flag)
- a duplicate or near-duplicate of another posting
- a stale posting, or text that looks incomplete or does not match the title
- a school or grade screen
- an "already employed" or similar restriction

## 5. What `record_fit` gets

- `score`: a whole number. `track`: the person's track that fits best (one of `tracks`), or a short lowercase label.
- `mustHaves`: 3 to 10 must-have skills and keywords from the posting, lowercase.
- `gaps`: the must-haves no Your story item shows (check for synonyms first).
- `matchedItemIds`: the ids of up to 8 Your story items that best support the fit.
- `flags`: from section 4. `hardSkip`: from section 1, otherwise null.
- `reason`: ONE line in plain words: why it fits, and the main risk.
