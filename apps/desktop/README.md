# @jobgoblin/desktop

The Electron shell of Jobgoblin. It does four things and nothing else: it starts the server in its own process, shows the dashboard in a locked-down window, stays in the tray when the window is closed, and opens files and links for the person. All product logic lives in the server; the dashboard is the server's web page.

Spec: [ARCHITECTURE.md](../../docs/poc/ARCHITECTURE.md) decisions D2, D4, D14 and sections 3, 11 and 13; the tech spec's "Processes and startup" and "Security and privacy".

## Read first

1. `src/main.ts`: start-up and quit, in order. Everything else is a helper it calls.
2. `src/serverProcess.ts`: starting the server, waiting for `ready`, stopping it.
3. `src/preload.ts` and `src/ipc.ts`: the only bridge between the dashboard page and Electron.
4. `src/openRules.ts`: the pure checks that decide what main will open.

| File | Holds |
| --- | --- |
| `main.ts` | Single-instance lock, start-up steps, Quit, error dialogs |
| `startupConfig.ts` | App data folder, resources folder, server bundle path, the server's environment (pure) |
| `serverProcess.ts` | `utilityProcess.fork`, the `ready` wait (20 s), `shutdown` and kill (10 s), server output into the log |
| `messages.ts` | The three messages with the server and the checks on what comes in (pure) |
| `window.ts` | The BrowserWindow, navigation lock, hide-instead-of-close |
| `tray.ts`, `trayIcon.ts` | Tray menu; the icon is drawn in code |
| `ipc.ts`, `channels.ts` | `ipcMain` handlers and the channel names both sides share |
| `preload.ts` | Builds `window.jobgoblin` |
| `openPath.ts`, `openRules.ts` | Opening files inside the person's folder; URL, origin and folder checks |
| `logger.ts` | `<app data>/logs/desktop.log` |
| `scripts/stand-in-server.mjs` | A fake server for trying the shell before the real one exists |

## What main does

**Start-up** (`run()` in `main.ts`):

1. Work out the folders (`startupConfig.ts`) and open the log. Chromium's own data goes to `<app data>/electron` (`app.setPath("userData")`).
2. Take the single-instance lock. A second launch logs one line, exits, and the first copy shows its window.
3. Wait for Electron to be ready. If `<resourcesDir>/packages/server/dist/server.mjs` does not exist, show a plain dialog that says to build the server.
4. Fork the server (`serverProcess.ts`) and wait up to 20 seconds for its `ready` message. A timeout or an early exit shows a plain error dialog, kills the server and exits.
5. Register the IPC handlers, create the window (loads `http://127.0.0.1:<port>/`), create the tray.

**Quit** (tray, Quit; or the system asking the app to quit):

1. The window hides at once. Main sends `{ type: "shutdown" }` and waits up to 10 seconds for the server to exit; after that it kills the server.
2. Then the tray is removed and Electron quits. A run process the server could not stop in time is found and stopped by the server's crash recovery at the next start (ARCHITECTURE.md section 10, `recovery.ts`).

**Closing the window** only hides it, so runs keep going. Tray click or **Open Jobgoblin** brings it back.

**If the server dies on its own** after start-up, main shows a dialog and exits. It does not restart the server: a restart means a new session token and a reloaded window, and the next launch already recovers interrupted runs.

## Messages with the server

Over the utilityProcess channel (`process.parentPort` in the server, `child.postMessage` and `child.on("message")` in main). Plain objects, no replies.

| Direction | Message | When |
| --- | --- | --- |
| server to main | `{ type: "ready", port: number, sessionToken: string }` | Once, when listening. `port` is 1 to 65535, the token is not empty. |
| server to main | `{ type: "open-path", path: string, personFolder: string }` | When `POST /api/open` accepts a path. `path` is absolute. Main opens it only if it is inside `personFolder`. |
| main to server | `{ type: "shutdown" }` | Once, on Quit. The server cancels queued runs, stops running ones, flushes the tracker, closes the database, removes `server.json` and exits with code 0. |

Rules the server must follow:

- **Send `personFolder` in every `open-path` message.** It is the absolute path of the folder the person chose. Without it main refuses the path (fail closed) and writes a warning to `desktop.log`.
- **Print nothing secret.** Main copies the server's stdout and stderr into `desktop.log`, line by line.
- **Main never asks the server anything**, so the server has no message to answer and main makes no HTTP calls of its own.
- **Environment the server receives:** everything main has, plus `JOBGOBLIN_APP_DATA` and `JOBGOBLIN_RESOURCES_DIR` set by main. `JOBGOBLIN_CLAUDE_COMMAND`, `JOBGOBLIN_CLAUDE_INSTALL_COMMAND`, `JOBGOBLIN_FEED_FIXTURES`, `JOBGOBLIN_PORT` and `JOBGOBLIN_DEV_ORIGIN` arrive when they are set for the app.
- `POST /api/open` should answer `{ opened: true, path }` once it has sent the message, and `opened: false` (or an error status) when it refuses. The preload turns anything else into a rejected promise.

## IPC and the window bridge

The page gets `window.jobgoblin` only when the page is on the server's origin. Otherwise `window.jobgoblin` is `undefined`.

```ts
window.jobgoblin = {
  sessionToken: string,
  chooseFolder(): Promise<string | null>,   // null when the person cancels
  openPath(path: string): Promise<void>,    // resolves when accepted, rejects when refused
}
```

| Channel | Kind | Answer |
| --- | --- | --- |
| `jobgoblin:get-session-token` | `sendSync` (`ipcMain.on`) | The token, or `null` unless the sender frame's origin is the server origin |
| `jobgoblin:choose-folder` | `invoke` (`ipcMain.handle`) | `dialog.showOpenDialog` (`openDirectory`, `createDirectory`, starts in Documents): the folder, or `null` on cancel. Rejects for any other origin. |

`openPath` has no channel of its own. The preload sends `POST /api/open { path }` with the token; the server checks the folder and sends `open-path` to main; main checks again and calls `shell.openPath` on the resolved path. This is the same route the dashboard uses in a plain browser.

## Security settings and why

| Setting | Why |
| --- | --- |
| `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` | The dashboard page cannot reach Node or Electron. The preload is the only bridge and exposes three things. |
| Session token from main, not the command line | Command lines are readable by other programs on the computer. Main answers only a frame whose origin the browser process verified as the server's. |
| `will-navigate` and `will-redirect` blocked off the server origin | A page must never leave the server, where it would sit next to the token. A blocked http(s) click goes to the person's browser; a blocked redirect is only logged. |
| `setWindowOpenHandler` denies everything | No second Electron window ever. http(s) links go to `shell.openExternal`; `file:` and custom protocols are dropped. |
| Open only inside the person's folder | `shell.openPath` runs whatever program the system associates with a file. Both paths are resolved through links, so `..` and links pointing outside do not work. |
| Server on `127.0.0.1` only | The server's job; main loads only `http://127.0.0.1:<port>/`. |
| Logs hold no tokens, paths or job text | Refusals are logged as a sentence, not with the path. |

## How to run

From the repository root, with the server and dashboard built:

```powershell
pnpm dev:desktop
```

That builds the dashboard and server, then runs `pnpm --filter @jobgoblin/desktop start` (`tsup && electron .`). To work on the shell alone: `pnpm --filter @jobgoblin/desktop start`.

| Command | What |
| --- | --- |
| `pnpm --filter @jobgoblin/desktop build` | Bundles `dist/main.cjs` and `dist/preload.cjs` |
| `pnpm --filter @jobgoblin/desktop typecheck` | Type check |
| `pnpm --filter @jobgoblin/desktop test` | Unit tests of the pure files (`openRules`, `messages`, `startupConfig`) |

Settings (environment variables read by main):

| Variable | Effect |
| --- | --- |
| `JOBGOBLIN_APP_DATA` | App data folder. Default `%APPDATA%\Jobgoblin`. Tests use a temporary folder, which also gives them their own single-instance lock. |
| `JOBGOBLIN_RESOURCES_DIR` | Folder that holds `packages/server/dist/server.mjs` and the other resources. Default: the repository root, two levels above `apps/desktop`. |
| `JOBGOBLIN_CLAUDE_COMMAND`, `JOBGOBLIN_FEED_FIXTURES`, `JOBGOBLIN_PORT`, ... | Passed on to the server untouched. |

**Logs.** `electron.exe` has no console on Windows, so read `%APPDATA%\Jobgoblin\logs\desktop.log` (main's lines, plus the server's stdout and stderr). It is moved to `desktop.log.1` at start when it is over 1 MB.

## Try it with the stand-in server

`scripts/stand-in-server.mjs` speaks the protocol above and serves a page that reports what the preload gave it. Run from the repository root:

```powershell
$work = Join-Path $env:TEMP "jobgoblin-desktop-try"
New-Item -ItemType Directory -Force "$work\resources\packages\server\dist", "$work\person-folder" | Out-Null
Copy-Item apps\desktop\scripts\stand-in-server.mjs "$work\resources\packages\server\dist\server.mjs"
$env:JOBGOBLIN_APP_DATA = "$work\appdata"
$env:JOBGOBLIN_RESOURCES_DIR = "$work\resources"
$env:STAND_IN_PERSON_FOLDER = "$work\person-folder"
pnpm --filter @jobgoblin/desktop start
```

The window shows "Bridge present: chooseFolder, openPath, sessionToken". `$work\appdata\stand-in-report.json` records what the page saw, and `$work\appdata\logs\desktop.log` shows start-up and Quit.

## Decisions

1. **The token arrives by `sendSync`, so its channel uses `ipcMain.on`, not `handle`.** The brief asked for `handle`, but `handle` answers only `invoke`, which is asynchronous. `window.jobgoblin.sessionToken` must be a plain value before the page's scripts run, so the preload asks synchronously. The check is the same: the sender frame's origin must equal the server origin.
2. **The origin decision is made in main only.** The preload does not compare `location.origin`: it asks main and exposes the bridge only if main hands back a token.
3. **`openPath` goes through `POST /api/open`**, not its own IPC channel. The person's folder lives with the server; asking it from main would need a request-and-reply message. Going through the route keeps one decision point and still leaves main as the last gate, because main checks the `personFolder` in the `open-path` message.
4. **Fail closed.** No `personFolder` in the message, a relative path, a missing path, or a path outside the folder: nothing is opened.
5. **Main opens the resolved real path**, so a link swapped in after the check does not change what opens.
6. **`window.open` of every http(s) link goes to the browser, even on the server's own origin.** The server's own pages need the token header, which a browser tab cannot send.
7. **No restart of a crashed server** (see above): one dialog, then exit.
8. **The whole environment goes to the server.** It needs `PATH` to find `claude` and the user folders; the two `JOBGOBLIN_*` folder variables are set last so they cannot be redirected.
9. **No workspace dependencies.** Messages from the server are checked by hand in `messages.ts` instead of with zod schemas, so the shell stays a few small files with no extra packages. They could move to `@jobgoblin/schemas` later.
10. **The tray icon is drawn in code** (a green dot, 32 px at 2x). Red and blue are equal so the colour is right whether the platform wants BGRA or RGBA. A real icon belongs with the installer work (PRD S1).
11. **The default menu is kept** (hidden until Alt on Windows). It gives developer tools in the developer preview and the Edit menu that copy and paste need on macOS.
12. **No permission request handler.** The window loads only the person's own server, so there is nothing foreign to ask for permissions; adding a deny-all handler could also block the dashboard's copy buttons.

## Known limits

- `window.open` of a `blob:` URL is denied. If the dashboard wants to show a draft PDF it fetched with the token, it needs another route (for example the server saving it and `open-path`, but drafts live outside the person's folder).
- `shell.openPath` starts whatever program the system associates with the file. The folder check is the only gate; an extension allow-list would be a next hardening step.
- Closing the window hides it to the tray with no message. On Windows the tray icon may be in the overflow area.
- Packaged builds (resources in `process.resourcesPath`) are outside the developer preview.
- The root `vitest.config.ts` lists the packages to test and does not include `apps/desktop`; run the desktop tests with the command above.
