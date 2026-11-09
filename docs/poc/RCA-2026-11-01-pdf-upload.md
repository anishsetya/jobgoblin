# RCA: every PDF resume failed to upload in the desktop app

| | |
| --- | --- |
| Date | 2026-11-01 |
| Found by | The owner, on the first real use of the desktop app (setup wizard, step 4) |
| Impact | Every PDF upload failed in the desktop app. No one could finish setup with a PDF resume. Word files and the browser version (`pnpm dev`) were not affected. No data was lost or exposed. |
| Severity | High for the desktop app: it blocked onboarding, the first step of the PRD journey |
| Fixed in | `01ae8c0` fix(render): read PDFs inside the Electron desktop app |
| Regression test | `e2e/tests/electron-smoke.spec.ts`, "my resume PDF is read on the wizard's resume step inside the desktop app" |

## What the person saw

On "Add your resume", after choosing `AnishSetya_Resume.pdf` and clicking Read my resume:

> Jobgoblin could not read "AnishSetya_Resume.pdf". It may be damaged or protected with a password.

The file was neither damaged nor password-protected.

## Timeline

1. The person started the app with `pnpm dev:desktop` and uploaded a valid one-page PDF.
2. The upload failed with the message above.
3. Reading the same file with the same import code in plain Node worked (2,668 characters).
4. Uploading the same file to the built server in plain Node worked (HTTP 200).
5. Running pdf.js inside a real Electron utility process failed: `No "GlobalWorkerOptions.workerSrc" specified`.
6. Telling pdf.js where its worker file is made the same check pass. The built server, started inside Electron the way the desktop app starts it, then accepted the upload (HTTP 200, setup run started).

## Root cause

The desktop app runs the server inside an Electron **utility process** (tech spec, "Processes and startup"). Electron sets `process.type = "utility"` there.

pdf.js decides whether it runs in Node by checking for Electron: if `process.versions.electron` is set and `process.type` is anything other than `"browser"`, it assumes it is in a web page. In that mode it refuses to open a document unless `GlobalWorkerOptions.workerSrc` names its worker file. Jobgoblin never set it, because in plain Node pdf.js does not need it.

So inside the desktop app, `getDocument` threw before reading a single byte, for every PDF.

## Why the message blamed the person's file

`extractResumeText` turns any failure while reading a PDF into one error, `unreadable`, whose message guesses the most common causes: "damaged or protected with a password". The real cause was kept only as `error.cause` and never logged. The message was therefore wrong, and the log had nothing in it to show why.

## Why the tests did not catch it

| Layer | What it did | Why it missed this |
| --- | --- | --- |
| Unit tests (render) | Read PDFs with pdf.js | Vitest runs in plain Node, where pdf.js works |
| Server tests | Upload through the HTTP API | The server ran in plain Node |
| Browser e2e (37 tests) | Uploaded `alex-rivera.pdf` in the wizard | The test server is started with `node packages/server/dist/server.mjs`: plain Node again |
| Electron smoke test | Launched the real desktop app | It checked the window, the bridge and quitting, but never uploaded a file |

Only one test ran the server in the process where it actually runs for the person, and that test did not exercise any library that behaves differently there. The spec's own open question ("confirm `typst-ts-node-compiler` renders on Windows and macOS", "confirm `better-sqlite3` builds for Electron") was asked of the two native modules but not of pdf.js, which is plain JavaScript yet still checks its environment.

## Fix

1. `packages/render/src/withOpenPdf.ts` sets `GlobalWorkerOptions.workerSrc` to pdf.js's own worker file, using `import.meta.resolve`. Inside Electron, pdf.js loads it as its fallback worker on the same thread; in plain Node the setting is ignored.
2. `packages/server/src/services/setup.ts` logs the underlying cause (code and error text, never the file's contents) when a resume cannot be read.

## Verification

- The fix was tested with the built server inside a real Electron utility process, uploading the person's own resume: HTTP 200 and the setup run started.
- The new e2e test uploads a PDF through the wizard inside the real desktop app.
  - With the fix removed it fails: the success message never appears.
  - With the fix in place it passes.
- The render and server unit tests (221) pass.

## Follow-ups

| # | Action | Why |
| --- | --- | --- |
| 1 | Done: the Electron e2e test now uploads a resume | It is the only layer where the server runs as the person runs it |
| 2 | Run one flow per server feature that touches a third-party library (render a PDF, export xlsx, back up) in the Electron test, not only upload | Any library may check its environment the way pdf.js does |
| 3 | Give the upload error distinct messages: "this is not a PDF", "this PDF is password-protected" (pdf.js reports `PasswordException`), and "something went wrong on our side, try again" for everything else | A guess presented as fact sent the person looking for a problem in their own file |
| 4 | Rework the resume step's layout (raw file inputs, a separate "Read my resume" button, Continue disabled with no reason given) | Raised by the owner at the same time |

### Outcome

Follow-ups 2, 3 and 4 are done.

| # | What changed | Commit-ready description |
| --- | --- | --- |
| 2 | `e2e/tests/electron-smoke.spec.ts` has a second test inside the real desktop app. It finishes setup with Alex Rivera through the page's own API, runs Find jobs (Typst draws each resume, pdf.js reads it back), approves one application (the final PDF is in the folder and matches its hash), downloads the tracker as a real `.xlsx` and makes a backup. | `test(e2e): exercise render, read-back, xlsx export and backup inside Electron` |
| 3 | `extractResumeText` throws `ResumeFileError` with a code, a message and an action. Codes: `unsupported-type`, `password-protected` (pdf.js `PasswordException`), `damaged` (`InvalidPDFException`, `FormatError`, or a broken Word file), `read-failed` (anything else, worded as our fault and sent as HTTP 500). `no-readable-text` (a scan) stays in the server. The server logs the code and the reader's error text on every failure, never the file's contents. Fixtures in `fixtures/resumes/broken/` include a real password-protected PDF made with `node:crypto`, and the Electron test checks the password message end to end. | `fix(render): say honestly why a resume file cannot be read` |
| 4 | The resume step has one drop zone per file (a styled box over a hidden, keyboard-reachable file input, drag and drop, the chosen name with Change and Remove), one "Read my resume" button under the resume box, a progress card while Claude reads, the success line when done, errors beside the file they are about (cleared when another file is chosen), and a hint under Continue that says what is missing. | `feat(dashboard): clearer resume step with drop zones and honest upload errors` |
