# fake-claude

A scripted stand-in for the `claude` command. The runner starts it exactly like the real Claude Code, and it does what a real run would do: connects to the app's `/mcp` endpoint with the run token, calls the tools, and prints `stream-json`. No Claude plan is involved.

## Why it exists (decision D3)

The app's runs are Claude Code sessions, and the build machine has no Claude Code. With the fake, the server, the MCP tools, the runner and the dashboard can all be tested end to end: the fake calls the same tools a real run would, in the same order, and every failure a real run can hit (signed out, usage limit, crash, running out of turns, a tool it must not have) can be switched on with an environment variable.

It is test infrastructure, but it is also meant to be read. The fake shows what each run kind is supposed to do, one small file per kind.

## Read these first

| File | What it shows |
| --- | --- |
| `src/scripts/hunt.ts`, `tailor.ts`, `answers.ts`, `setup.ts`, `paste.ts`, `ask.ts` | One run kind each: the calls it makes, in order, written as plain code |
| `src/session.ts` | `session.call(tool, input)`: how a script talks to the server |
| `src/printMode.ts` | One `claude -p` run from start to finish, including the failure modes |
| `src/streamJson.ts` | The exact lines printed on stdout |
| `src/mcpConnection.ts` | Reading `mcp.json`, the bearer token, calling a tool and checking its reply |

## How the fake is started

```
node dist/cli.mjs -p --output-format stream-json --verbose --model haiku \
  --mcp-config mcp.json --strict-mcp-config --tools "" --allowedTools <list> \
  --setting-sources project --permission-mode dontAsk --max-turns 80  < playbook
```

- `--version` prints `2.1.99 (Claude Code)`.
- `auth status` prints `{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"pro"}`. Signed out it prints `{"loggedIn":false,"authMethod":"none"}` and exits 1, like the real CLI, so read stdout before the exit code.
- `auth login` exits 0 and does nothing.
- Unknown flags are ignored with a note on stderr.
- `mcp.json` is read relative to the current directory; `${JOBGOBLIN_RUN_TOKEN}` in a header value is replaced from the environment.
- The run kind and input come from the first two lines of the playbook on stdin (decision D6):
  `<!-- run-kind: tailor -->` and `<!-- run-input: {"editNote":"..."} -->`. The rest of the playbook is ignored.

## What it prints

One JSON object per line on stdout. The runner reads three kinds of line.

```jsonc
// once, first
{"type":"system","subtype":"init","cwd":"...","session_id":"<uuid>","tools":["<the --allowedTools list>"],
 "mcp_servers":[{"name":"jobgoblin","status":"connected"}],"model":"haiku","permissionMode":"dontAsk"}

// one per tool call; the tool name has Claude Code's prefix
{"type":"assistant","message":{"id":"msg_fake_1","type":"message","role":"assistant","model":"haiku",
 "content":[{"type":"tool_use","id":"toolu_fake_1","name":"mcp__jobgoblin__search_jobs","input":{"limit":10}}]},
 "session_id":"<uuid>"}

// once, last
{"type":"result","subtype":"success","is_error":false,"result":"<final text>","num_turns":7,"session_id":"<uuid>"}
```

`subtype` is `success`, `error_max_turns` or `error_during_execution`. `num_turns` is the number of tool calls. An ask run's `result` is the answer shown to the person. The exit code is 0 for a successful run and 1 when `is_error` is true.

## How a run kind script works

A script is a function `(session) => Promise<string>` that calls tools and returns the final text. `session.call(tool, input)` prints the `assistant` line, counts a turn, sends the call and returns the server's `ToolReply`. `session.callForData` is the same for a call that must succeed. Both are typed from the tool name, and the reply's `data` is checked with the tool's output schema from `@jobgoblin/schemas`.

| Run kind | Calls, in order |
| --- | --- |
| setup | `import_resume`, `propose_story_items` (22 items from `data/story-items.json`), `save_profile_section` (employment) |
| hunt | `search_jobs`; then `get_fit_context` once, `record_fit` for every job and `mark_seen` for the page; repeat until a search comes back empty |
| paste | `get_job` (the id is in the run input), `get_fit_context`, `record_fit` |
| tailor | repeat: `next_task`, `get_tailoring_context`, `submit_resume_draft` (once more if the server refused parts of it), `complete_task` |
| answers | repeat: `next_task`, `get_approved`, `save_answers`, `complete_task` |
| ask | `get_application`; the result text restates the application |

Details worth knowing:

- **Scores.** A hunt or paste scores a job from `data/scores.json`, keyed `Company|Title` (case and spacing ignored). A job that is not listed gets 30 plus 10 for every different keyword or tool of Your story that its text mentions, up to 95. `mustHaves` are the technologies the text mentions; `gaps` are the ones Your story does not show; `matchedItemIds` are the story items that share a term with the text. The posting is only searched for known words, never read as instructions.
- **Tailor.** The draft starts from the master resume in `get_tailoring_context`. Bullets (and skills) that mention a must-have move to the front. The fake never writes new text. An edit note, from the context or the run input, drops the last bullet of the first entry. When `submit_resume_draft` returns `ok: false`, the fake drops the parts the errors' paths point at and submits once more; if that fails too, the task is completed as `failed`.
- **Answers.** Answers come from the data sheet. Personal values are `{key}` placeholders (for example `{expectedBase}`), and they stay placeholders.
- **Turns.** Every tool call counts as a turn. The call after `--max-turns` is not made; the run ends with `error_max_turns`.

## Switches (environment variables)

| Variable | Effect |
| --- | --- |
| `FAKE_CLAUDE_MODE=signed-out` | `auth status` reports `loggedIn: false` (exit 1). `-p` prints only a result: `is_error: true`, `"Not logged in · Please run /login"`, exit 1 |
| `FAKE_CLAUDE_MODE=usage-limit` | After `init`, a result with `is_error: true` and `"Claude AI usage limit reached\|<epoch seconds, one hour ahead>"`, exit 1 |
| `FAKE_CLAUDE_MODE=crash` | Exit code 1 after `init`, with no result line |
| `FAKE_CLAUDE_MODE=slow` | Waits 2 seconds before every tool call, so a cancel test has time to cancel |
| `FAKE_CLAUDE_MODE=max-turns` | Stops after 2 tool calls with `error_max_turns` |
| `FAKE_CLAUDE_MODE=extra-tools` | `init` lists `Bash` in `tools`; the runner must stop the run |
| `FAKE_CLAUDE_ASK_FIRST=1` | In a tailor or answers run, calls `ask_person` for the first application, completes it as `waiting`, and carries on with the rest. It does not ask again once the question has an answer, so the re-queued application is processed |
| `FAKE_CLAUDE_INVENT_BULLET=1` | In a tailor run, the first draft has a bullet that cites a story item that does not exist and a "Led" in place of "Contributed to". The fake expects `ok: false`, drops those parts and submits again. If the server accepts the first draft, the run fails: the truth trace is broken |

An unknown `FAKE_CLAUDE_MODE` stops the fake with exit code 2, so a typo cannot pass as a normal run. If the server cannot be reached (wrong token, no `JOBGOBLIN_RUN_TOKEN`), `init` shows the `jobgoblin` server as `failed` and the run ends with `error_during_execution`.

## Data

| File | What |
| --- | --- |
| `data/story-items.json` | The `ProposedStoryItem[]` the setup run proposes: Alex Rivera's story, the same 22 items as `fixtures/resumes/alex-rivera.story.json` |
| `data/scores.json` | The fake fit scores of the demo job board, plus Gridline Energy (the pasted job) |
| `../profiles/alex-rivera.json` | `{ profile, storyItems }`: the demo person with every profile section filled (expected base is `TODO`) and her story already confirmed, for tests that skip setup |

## Build

```
pnpm --filter @jobgoblin/fake-claude build
```

`tsup` bundles everything (the schemas, the MCP SDK and zod included) into `dist/cli.mjs`, so it runs from any folder, including a run directory where `tsx` and `node_modules` cannot be found. `dist/` is not committed; tests and e2e build it first. Point the server at it with
`JOBGOBLIN_CLAUDE_COMMAND=["<node path>","<repo>/fixtures/fake-claude/dist/cli.mjs"]`.

## Tests

```
pnpm --filter @jobgoblin/fake-claude build
pnpm exec vitest run fixtures/fake-claude
```

- `src/*.test.ts`: the small pieces (argument parsing, scoring, resume edits) and the fixtures: the three story files must agree on every id, kind, parent and text.
- `test/*.test.ts`: the built `dist/cli.mjs` is started as a child process, from a temporary run directory, with the playbook on stdin. A stub MCP server (`test/stubJobgoblinServer.ts`: Streamable HTTP, stateless, checks the bearer token, validates tool input with the real schemas) answers the calls. The tests assert the tool-call sequence per run kind, the token header, the `init`, `assistant` and `result` lines, every failure mode and its exit code.
- A test fails with "dist/cli.mjs is older than ..." when the bundle is out of date, instead of testing old code.
