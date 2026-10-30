---
name: browse-boards
description: Browse login-gated startup job boards and LinkedIn (read-only) (LinkedIn, Wellfound, YC Work at a Startup, Welcome to the Jungle, Instahyre, Cutshort) in the user's own Chrome at human pace, pull matching roles into the pipeline, and apply through the site's own flow only after the user approves. Use for "check Wellfound", "look at Work at a Startup", "browse startup boards". Interactive only — never run from a schedule.
---

# Browse startup boards (in the user's Chrome)

These sites need a login, and their terms forbid scraping. So **Claude never scrapes them with scripts.** It browses them like a person would, in the user's already-logged-in Chrome, while the user is at the laptop.

## Setup check
- Load the Claude in Chrome tools first (see the chrome-browser skill).
- Board list: `config.yaml` → `browser_boards`. Ask which ones today, or default to every board for the user's target regions.
- If a board shows a login page: stop and ask the user to log in. **Never type passwords or create accounts.** If it shows a CAPTCHA or bot check: stop and hand it to the user. Never try to solve or bypass it.

## Browse (per board)
1. Open the board in a new tab. Use the site's own filters:
   - role: Software / Backend / ML / AI / DevOps / Platform engineer
   - experience: 0–3 years / new grad OK
   - location: the regions and cities in `profile/facts.yaml` → `preferences`
   - work-authorization filters that match `facts.work_authorization`, where the board offers them
2. Read the listings with `get_page_text` and `read_page`.
   - Stay at human pace: one page at a time, at most about 5 result pages per board per session.
   - No infinite scrolling loops. No bulk-opening dozens of tabs.
3. For each promising role, capture: company, title, location, salary/equity if shown, posting URL, and the "about the role" text.
   - Apply CLAUDE.md filters (excluded roles, years-of-experience limit, region rules per track).
   - Dedupe against the Applications tab by company + title.

## LinkedIn (browse-only)
LinkedIn is read-only. Everything below is allowed; anything not listed is not.
- **Jobs:** `linkedin.com/jobs` with filters (Entry level / Associate, US or Remote, the target titles, "Past week"). Capture the posting like any other board, and use the employer's own careers link to apply. Never Easy Apply.
- **Founder posts:** search Posts for "hiring" + "founding engineer" / "AI engineer" / "forward deployed", sorted by Latest. Capture the author, company, post URL and role.
- **Founder profiles:** open the profile of a founder, CTO or head of eng at a tier-1 or fitting company, and note name, title and company. Read only the visible profile.
- **Pace:** one page at a time, at most about 5 result pages and 15 profiles per session, with pauses. No scroll loops, no bulk tabs.
- **Never:** connect, send messages or InMail, comment, react, follow, view profiles in bulk, or use any script or extension on the page. If LinkedIn shows a CAPTCHA, a login wall or an "unusual activity" / restriction notice, stop and tell the user.
- **Outreach from it:**
  1. Write each LinkedIn note (300 characters or fewer for a connection request, short for a message) as a **draft** in `outreach/linkedin/<id>.md` with the profile URL. The user copies and sends it themselves.
  2. An email is drafted only if the address appears in the post or profile text itself (see `/cold-outreach` rules). Never guess it.
  3. Add a Sheet Outreach row with Source `LinkedIn`, Status `Drafted (LinkedIn)`. The user marks it `Sent` themselves or tells you in chat.
  4. Dedupe by person against the Outreach tab and apply `recontact_days`.

## Into the pipeline
For each kept role:
1. Create `applications/<date>_<company>_<role>/jd.md` with the captured text and `source: wellfound|waas|wttj|instahyre|cutshort`.
2. Run `fit-analyst`. If fit ≥ `daily.min_fit`, run `resume-tailor`, then `cover-writer`.
   - Wellfound and Work at a Startup applications are mostly a **short note to the founder** (150 words or fewer), so have `cover-writer` produce `founder_note.md` in the cold-emailer style.
3. Add the Sheet row with Status `Awaiting approval` and ATS set to the board name.

## Apply (only after approval)
Show the numbered batch, as `/apply-batch` does, and wait for "submit 1, 3".
For each approved one:
- Use the site's own Apply button.
- Paste `founder_note.md` and upload the tailored PDF if the site asks.
- Answer screening questions from `facts.yaml`. If unsure, stop and ask.

Then record it exactly as in `/apply-batch` step 4: `submitted.json`, git tag, Sheet set to `Applied`.

## Report
Per board: listings seen, roles kept, roles applied to, and anything blocked (login, CAPTCHA).
