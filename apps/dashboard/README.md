# @jobgoblin/dashboard

The screens a person uses: the setup wizard, Today, Review, Open application, Pipeline, the Application page, Profile and Settings. It is a React app (Vite, Tailwind 4, TanStack Query and Router, i18next) that talks to the local server over HTTP and nothing else. It imports only `@jobgoblin/schemas` from the workspace (the dependency rule `dashboard-uses-http-only` enforces this). Spec: [ARCHITECTURE.md](../../docs/poc/ARCHITECTURE.md) section 12 and the PRD's "User experience".

Read first: `src/router.tsx` (the map of every screen), `src/api/client.ts` (how every request is made), then one screen, for example `src/screens/TodayScreen.tsx`.

## Screen map

| Address | Screen | Where |
| --- | --- | --- |
| `/` | sends the person to `/setup/1` or `/today` | `router.tsx` |
| `/setup/:step` | Setup wizard, 8 steps (7 tasks plus Finish) | `screens/setup/` (loaded on demand) |
| `/today` | Today: Find jobs, Add a job, Needs you, Running, Done today | `screens/TodayScreen.tsx` |
| `/review/:id` | Review one application (keys A, E, S, J, K) | `screens/ReviewScreen.tsx`, `screens/review/` |
| `/apply/:id` | Open application: frozen data sheet, answers, "I submitted" | `screens/ApplyScreen.tsx`, `screens/apply/` |
| `/pipeline` | Board or list, search and filters (kept in the address) | `screens/PipelineScreen.tsx`, `screens/pipeline/` |
| `/apps/:id` | Application: description, fit, versions, answers, history, status, Ask | `screens/ApplicationDetailScreen.tsx`, `screens/application/` |
| `/profile/:tab` | Your story, Form answers, Targets, Banned words | `screens/ProfileScreen.tsx`, `screens/profile/` |
| `/settings` | Claude, folder, limits, tracker, backups, exports | `screens/SettingsScreen.tsx`, `screens/settings/` |

A route component in `router.tsx` only reads the address and passes plain props to a screen, so a screen knows nothing about routing.

```
src/
  api/          every request: client, token, events, desktop bridge, and one hooks file per area
  components/   parts shared by screens; ui/ holds the small shadcn-style primitives
  screens/      one file per screen (plus a folder for its parts)
  i18n/         index.ts and en/<area>.json
  lib/          small helpers: class names, dates, downloads, shortcuts, page title, focus
  router.tsx  queryClient.ts  App.tsx  main.tsx  styles.css
```

## Where data fetching lives

Only `src/api/`. Components never call `fetch`; they call a hook.

| File | Routes |
| --- | --- |
| `client.ts` | `apiFetch` (adds the session key, checks the answer against its schema, throws `ApiProblem`), `apiFetchBlob`, `withQuery` |
| `token.ts` | `readSessionToken()` |
| `events.ts` | `subscribeToServerEvents()`, the fetch-based event stream with reconnect and backoff |
| `desktop.ts` | `window.jobgoblin` (folder chooser, open file) with browser fallbacks |
| `today.ts` | `GET /api/today`, `POST /api/jobs` |
| `applications.ts` | `GET /api/apps/:id`, `resume.pdf`, `approve`, `skip`, `undo-skip`, `withdraw`, `request-edit`, `tailor`, `ask`, `status`, `submitted` |
| `pipeline.ts` | `GET /api/pipeline` |
| `profile.ts` | `GET /api/profile`, `PUT /api/profile/:section` |
| `story.ts` | `GET`/`POST /api/story`, `PUT /api/story/:id`, `confirm`, `reject`, `POST /api/import-resume` |
| `runs.ts` | `POST /api/runs`, `retry`, `dismiss`, `DELETE /api/runs/:id`, `POST /api/questions/:id/answer` |
| `settings.ts` | `GET`/`PUT /api/settings`, `POST /api/settings/folder`, `POST /api/setup/finish`, `POST /api/open`, `GET /api/export/csv` and `/xlsx` |
| `claude.ts` | `GET /api/claude/status`, `POST /api/claude/install` and `/sign-in` |
| `backups.ts` | `GET`/`POST /api/backups`, `POST /api/backups/:id/restore` |
| `keys.ts` | every query key, in one place |

Errors reach the screen as `ApiProblem` (`message` and `action` in plain words). `<ErrorNotice error={...} />` shows one and renders nothing when there is no error.

## How server events refresh screens

1. `App.tsx` calls `useLiveUpdates()` once.
2. `events.ts` reads `GET /api/events` with `fetch` (an `EventSource` cannot send the session header) and calls back once per event. If the stream drops it waits 1 s, then 2 s, 4 s ... up to 30 s, and tries again.
3. `liveUpdates.ts` turns each event into "this data is stale" (`invalidate.ts`), and React Query refetches it for whichever screens show it:

| Event | Refreshed |
| --- | --- |
| `run.updated` | the run's card (stored under `keys.run(id)`), Today, Pipeline; when the run has stopped, also application pages, Your story and the profile |
| `application.updated` | that application's page, Pipeline, Today |
| `needs-you.changed` | Today |
| `profile.updated` | the profile, Your story, every application page (data sheets come from the profile) |
| `backup.done` | settings and backups |

After a reconnect everything is refreshed, because events sent while the stream was down are lost. Each mutation hook also refreshes what it changed, so the screen is right even before the event arrives.

The server has no route to fetch one run, so a run's live state lives only in the cache, filled by `run.updated` events and by the run a click returns (`useLiveRun` in `runs.ts` never fetches).

## Run it against a local server

Production: build, and the server serves `dist/` at `/`.

```
pnpm --filter @jobgoblin/dashboard build
pnpm --filter @jobgoblin/server dev        # prints JOBGOBLIN_READY {"port":...,"url":"http://127.0.0.1:...#token=..."}
```

Open the printed `url` in a browser. The `#token=...` part is read once, kept in `sessionStorage`, and removed from the address bar.

Development with hot reload:

```
JOBGOBLIN_DEV_ORIGIN=http://localhost:5173 pnpm --filter @jobgoblin/server dev    # in PowerShell: $env:JOBGOBLIN_DEV_ORIGIN = "http://localhost:5173"
pnpm --filter @jobgoblin/dashboard dev
```

Then open `http://localhost:5173/#token=<the token from the JOBGOBLIN_READY line>`. Vite proxies `/api` to `http://127.0.0.1:47615`, so the server must be on its default port (see `vite.config.ts` if it picked another). The server must be started with `JOBGOBLIN_DEV_ORIGIN=http://localhost:5173`, because it refuses requests whose `Origin` is not its own address or that one. Vite uses `strictPort`, so it will fail rather than move to 5174 and be refused.

Checks: `pnpm --filter @jobgoblin/dashboard typecheck` and `pnpm --filter @jobgoblin/dashboard build`. The Playwright tests in `e2e/` drive these screens; they rely on `data-testid="run-card"`, `"needs-you-item"` and `"pipeline-card"` and on roles and labels everywhere else.

## Decisions

1. **One JSON file per area** under `src/i18n/en/` (common, today, review, apply, pipeline, application, setup, profile, settings) instead of the single `en.json` in CODE_STYLE.md. Components ask for `t("today:needsYou.title")`; the namespace is always written out, so a key is easy to search for.
2. **Every answer is checked against its schema** from `@jobgoblin/schemas` in `apiFetch`. A reply with the wrong shape becomes a calm `ApiProblem`, never a half-drawn screen. Lists use `arrayOf(schema)`.
3. **The session key from the address wins over an older stored one.** `readSessionToken` follows the order in section 12 (desktop preload, session storage, fragment), but writes a fresh `#token=` into session storage first, so reopening the new address after a server restart works.
4. **The router is created after the key is read** (`createAppRouter` in `main.tsx`), so the router never sees the `#token=` fragment.
5. **Files are saved with a clicked `<a download>`**, never `window.open(blob:)`, because Electron refuses blob addresses in new windows. So "Open PDF" is "Download PDF" (Review and Application) and the CSV and Excel exports download the same way. "Open resume file" and "Open tracker" go through `window.jobgoblin.openPath` in the desktop app (a rejected promise means refused) or `POST /api/open` in a browser; if neither can open the file the screen shows its path.
6. **Pipeline filters pick one status and one band.** Each query parameter then holds one value, so the request means the same whether the server reads repeated or comma-separated values. The filters live in the address (`?view=list&status=Applied`).
7. **Every screen except Today is loaded on demand** with `React.lazy`; `Suspense` sits in `AppShell` and in the setup route. The wizard, Review and Profile are the largest.
8. **The usage notice is a dialog shown before the first run** (Find jobs, Add a job, or reading the resume in setup), then remembered in settings (`useUsageNotice`).
9. **After Approve, Skip or Request edit, Review moves to the next application waiting for review**, or back to Today when none is left.
10. **"I submitted" can check the attached file.** The person may pick the file they uploaded; its SHA-256 is computed in the browser and compared with the approved file. A mismatch needs an explicit "Record it anyway". The file never leaves the computer.
11. **Targets shows roles, regions, seniority, roles to avoid, hard skips and flags** (PRD P4). The `tracks` list is kept as it is and not shown, because the PRD does not name it.
12. **Lists of text are typed one per line** (`LineListField`), which works for people and screen readers without chips.
13. **Colors are variables that follow the system theme.** One accent (teal-blue), amber only for flags and risks (and the one overdue follow-up), green only for success. The contrast of every text and background pair is noted next to its definition in `styles.css`.
14. **Dialogs, tabs and the focus trap come from Radix**; everything else is native HTML (`select`, radio and checkbox inputs, `details`) because the browser already makes those accessible.
15. **Moving between screens moves keyboard focus to the main area**, and each screen sets the page title, so a screen reader announces where the person is. Switching Profile tabs keeps focus on the tab.
16. **Plain text only.** Job postings, resumes, answers and Ask results are rendered as text by React. Nothing uses `dangerouslySetInnerHTML`; `JobText` and `ResumePreview` say why in a comment.

## Gaps in the shared schemas

These are marked `// Needs:` where they occur in the code.

- `NewStoryItemRequest` and `UpdateStoryItemRequest` for `POST /api/story` and `PUT /api/story/:id` (`api/story.ts` sends `{ kind, parentId, data, keywords }` and `{ data, keywords }`).
- `ImportResumeResponse` (`{ runId }`) and `OpenPathResponse` (`{ opened, path }`), which are read by hand in `api/story.ts` and `api/settings.ts`.
- What `NeedsYouItem.id` holds for `kind: "question"`. The dashboard assumes it is the question's id, and `detail` its text.
- The tracker file's path (assumed `<person folder>/Tracker.xlsx`) and the application folder's layout (assumed `<person folder>/<application.folder>/<resumeFileName>` for the approved resume).
- A route to fetch one run, which would remove the need to keep run state only from events.
