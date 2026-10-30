---
name: interview-prep
description: Build an interview prep pack for a company/role that reached OA, Phone, or Onsite. Use for "prep me for <company>", "I have an interview with X", or when inbox-tracker moves a row to OA/Phone/Onsite.
---

# Interview prep

1. Find the application folder: `applications/*_<company-slug>_*`. If there are several, ask which one.
2. Run the `interview-prep` subagent on it. It writes `<folder>/prep.md`.
3. If the interview time is known and the Calendar connector is available:
   - Create the event if it doesn't exist.
   - Add a prep block the day before, linking `prep.md`.
4. Commit with `git commit -m "app(<company>): interview prep"`.
5. Show the user the 5-line summary and any `NEEDS USER` STAR stories to fill in. Offer a mock-interview round in chat.
