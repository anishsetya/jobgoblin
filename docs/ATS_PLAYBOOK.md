# Application playbook (learned on Stripe, 2026-10-17/18)

How `/apply-batch` fills forms. Update this file when a portal surprises us.

## Which browser
Use **the user's Chrome** through the Claude-in-Chrome extension (`mcp__claude-in-chrome__*`), so they can see the form, take the human step, and click Submit. The app's built-in browser pane is invisible when the session isn't open in a desktop window; do not send the user to it. Confirm they can see the tab before filling.

## The flow, per application
1. **Data sheet first.** Open the form, paste `scripts/browser_helpers.js`, run `formSchema()` (one compact line per field), read dropdown options with `optionsOf()`, and show the user a table of *field → value I'll enter* with the resume version and link. Wait for "OK". Avoid `read_page` / `get_page_text` on forms: they are ~10x larger and stay in the conversation for every later turn.
2. **Fill** (below). Paste `scripts/browser_helpers.js` once per page load. `fillAll({id: value, ...})` sets all plain text fields in one call; dropdowns need `focusCtl` + a real click + `choose`.
3. **Attach the resume** with `file_upload`.
4. **Read every field back** with `readBack()` (text, cheap) against the data sheet; run `requiredReport()`; take one screenshot at `scale: 0.5` just before Submit.
5. **Submit**: the user clicks it, or authorizes the click in chat for that application. The permission check may block the click ("Real-World Transactions"). Don't work around it: stop and ask.
6. **Human step** (emailed code, CAPTCHA): the user's. See "Hard stops".
7. After the confirmation page: write `submitted.json`, tag, set Sheet status, fill the **Sent** row (see `/apply-batch`).

## Uploading the resume
Claude-in-Chrome has `file_upload` (ref of the file input + local path). `find` the "Attach" / file input, then upload `applications/<folder>/out/Resume.pdf`. Confirm the filename appears on the page. This replaces the old `window.name` / BroadcastChannel / localhost-server trick (the built-in browser had no upload tool and Greenhouse's CSP blocked `fetch` to localhost). Never push file bytes through the model.

## Layout shifts (the cause of most mistakes)
Greenhouse reflows after every dropdown, upload and typeahead. Typing or clicking at remembered coordinates lands in the wrong field. On Stripe this put the phone in the wrong place, typed "Computer Science" into Degree, and clicked "Attach" by accident.
- **Fresh screenshot before every coordinate click and every typed value.**
- Never type blind after a selection; click the field, screenshot, then type.
- Use `window.scrollTo(... behavior:'instant')`; `scrollIntoView` is smooth and returns stale coordinates.
- Chrome screenshots at scale 0.6 give a 1272×668 frame. `focusCtl` returns raw viewport coordinates when `window.__chrome = true` is set, and an 800 px-frame scale otherwise.

## Fields
- **react-select dropdowns:** synthetic events do not open them. `focusCtl(id)` → real `computer` click → `choose(id, text)`. Options near the page bottom: scroll first or the click misses.
- **Match option text exactly or by prefix, never `includes`.** (`"No"` matched `"…now or in the future"` and picked "Yes, I will require visa sponsorship". Caught only because every field is read back.)
- **Typeahead (School, Location):** click, type, wait ~2 s, screenshot, click the suggestion.
- **Phone:** the country picker is **intl-tel-input** (`[role=option]` list), not react-select, and `focusCtl` doesn't scroll to it. Scroll to the top and click it from a screenshot. Choose the country code first, then type the number with the real `type` action.
- **Education:** School (typeahead), "not listed" box for the exact school name, Degree, Discipline (both dropdowns), start/end year. Choose School first, re-screenshot, then Degree, then Discipline.
- **Optional fields** (GPA, SAT, pronouns, conference questions): leave blank.

## Hard stops (do not work around)
- **Greenhouse "verification code sent to your email … confirm you're human"**: bot detection, sent only after Submit. The user types it. Claude does not read the inbox for it, forward it, filter it, or enter it, and no change to `CLAUDE.md` alters that.
- reCAPTCHA / hCaptcha challenges (Lever uses hCaptcha): the user solves them.
- Login wall or account creation: the user's. Never type passwords.
- Legal acknowledgements (privacy notice, arbitration agreements): tick only with the user's standing OK, and list each one in the report.
- Required fields with `TODO`/unknown answers (salary, GPA on a 4.0 scale, etc.): ask.
- Submit click denied by the permission check: stop, explain, let the user decide.

## Ready queue (how the user stays in control with little effort)
Filled forms live only in the Chrome tab: there is no link that reopens a filled form. So after filling, leave the tab open and report "Ready: tab '<title>', click Submit, enter code". Fill Greenhouse forms in separate tabs so the user clears the codes together. Fallback if a tab is closed: the data sheet plus the resume link, pasted in by hand (~3 min).

## Portal notes
| Portal | Form URL pattern | Notes |
|---|---|---|
| Greenhouse | `https://job-boards.greenhouse.io/embed/job_app?for=<board>&token=<id>` (company sites often embed it in an iframe: read `iframe.src`) | Emailed code after Submit. Stable field ids (`first_name`, `question_<id>`). School list may not contain the exact school: pick the closest, write the exact name in the "not listed" box. |
| Ashby | `https://jobs.ashbyhq.com/<company>/<id>/application` | Not yet driven; expect invisible reCAPTCHA. |
| Lever | `https://jobs.lever.co/<company>/<id>/apply` | hCaptcha for the user. |

## Facts that keep coming up
- Take every value from `profile/facts.yaml`; never retype a fact from memory.
- GPA: only when a form requires it, in the scale stored in facts; if a form demands a different scale, ask first.
- EEO: use the `eeo` section, which declines by default.
