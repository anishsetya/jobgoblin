# Jobgoblin audit evidence, 2026-11-07

Evidence for the product audit tracked in the issue tracker. This branch shares no history with `main` and is not meant to be merged.

Every person, resume, email, phone number and job here is invented test data: Alex Rivera and the demo job board in `fixtures/`.

- `screens/`: screenshots attached to the issues. Red boxes were added by hand to point at the problem. Settings pages are cropped so local paths are not shown.
- `data/`: what each audit test recorded, with local paths and session tokens removed. `findings-summary.json` is the full list of findings.
- `data/real/`: excerpts from the one journey with real Claude Code.
- `specs/`: the Playwright specs that produced this. To run them, copy them to `e2e/audit/` and fix the two path constants (`paths.ts` and `CLAUDE` in `real.audit.spec.ts`).

The app was tested at commit `09245d7`.