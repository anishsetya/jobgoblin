---
name: resume-update
description: Change the user's canonical resume — add or edit achievements in the bullet bank, update master.yaml, re-render, verify, and commit with a conventional message. Use for "add this to my resume", "update my resume", "bullet bank interview", or when weekly-review proposes changes.
---

# Resume update ("git for resume")

Canonical files:
- `profile/bullet_bank.yaml`: all true achievements
- `resume/master.yaml`: the default one-page selection

## Adding or changing facts
1. **Interview first when facts are thin.** Ask the user targeted questions one topic at a time. Examples:
   - scale (users, requests/day, pipelines/day, data size)
   - latency and cost numbers
   - which MCP tools or endpoints the user built
   - technologies actually used (Go? Postgres? K8s?)
   - team and ownership scope
   - incidents fixed
   - launches
2. **Write to the bank first.**
   - Each entry gets: `id`, `section`, `tracks`, `keywords`, and 2–3 `variants`.
   - Set `verified: true` only after the user confirms the wording and numbers.
   - Never invent or round up metrics.
3. **Update `master.yaml`** only if the new bullet beats an existing one. The resume must stay one page.
4. **Render:** `scripts/render.ps1 resume/master.yaml -OutDir resume/out -Png`. It must report `pages: 1` and `OK`. Show the user the preview PNG.
5. **Commit:** `git add profile resume && git commit -m "feat(resume): <what changed>"` (or `fix(resume):`).
   - For a significant revision, also tag it: `git tag resume/v<N>-<short-desc>`. Check `git tag -l "resume/*"` for the next N.

## History questions
- "What changed?": `git log --oneline -- resume/master.yaml profile/bullet_bank.yaml`, plus `git diff <tag> -- resume/master.yaml`.
- "What did company X see?": `git tag -l "app/<company>*"`, then `git show <tag>:applications/<folder>/resume.yaml`.

Never use any term listed in `profile/rules.yaml` → `banned_terms`.
