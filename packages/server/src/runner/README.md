# The runner

Everything that turns a button press into one sealed Claude Code run, and everything that decides how that run ended. These modules are small, pure where they can be, and know nothing about HTTP or the queue. `launcher.ts` (written separately) calls them in the order below. Spec: [ARCHITECTURE.md](../../../../docs/poc/ARCHITECTURE.md) sections 2 (D3, D6, D21), 9, 10 and 14.

## How a run is launched and sealed

| # | Step | Module | What it does |
| --- | --- | --- | --- |
| 1 | Check Claude Code | [claudeCli.ts](claudeCli.ts) | `status()` finds the program, checks the version against `MINIMUM_CLAUDE_VERSION`, and reads `claude auth status`. Anything but `connected` blocks the run. |
| 2 | Write the playbook | [runDirectory.ts](runDirectory.ts) `buildPlaybook` | Line 1 `<!-- run-kind: ... -->`, line 2 `<!-- run-input: {...} -->` (D6), then `playbooks/<kind>.md`. |
| 3 | Make the run directory | [runDirectory.ts](runDirectory.ts) `createRunDirectory` | `<appData>/runs/<runId>/` with `PLAYBOOK.md`, `mcp.json`, `.claude/settings.json` and (hunt only) `.claude/agents/screener.md`. |
| 4 | Build the flags | [claudeArgs.ts](claudeArgs.ts) | `buildClaudeArgs(run, settings)` and `allowedToolsFor(kind, settings)`. |
| 5 | Build the environment | [runEnvironment.ts](runEnvironment.ts) | The person's environment without `ANTHROPIC_*` and `CLAUDE_CODE_USE_*`, plus `JOBGOBLIN_RUN_TOKEN`. |
| 6 | Start the process | [processes.ts](processes.ts) `spawnRun` | No shell; working directory is the run directory; playbook on stdin; stdout delivered line by line. |
| 7 | Read the stream | [streamJson.ts](streamJson.ts) | `parseStreamLine` for every line; `checkInitEvent` on the `init` line stops a run that is not sealed. |
| 8 | Classify the end | [outcome.ts](outcome.ts) | `classifyRunEnd` turns the facts into a status and a plain message. |
| 9 | Cancel or time out | [processes.ts](processes.ts) `killProcessTree` | `taskkill /T` then `/F` after 5 seconds (Windows), `SIGTERM` then `SIGKILL` elsewhere. |
| 10 | Recover at start | [recovery.ts](recovery.ts) | Marks leftover `running` and `waiting` runs interrupted, and stops a leftover Claude process only after checking its program name. |

### What launcher.ts must call, in order

```
status = await claudeCli.status()                       // not "connected" -> blocked
settings = RUN_KIND_SETTINGS[run.kind]
playbookText = buildPlaybook(run.kind, run.input, resourcesDir)
{ directory } = createRunDirectory({ appDataDir, resourcesDir, run, port, playbookText })
args = buildClaudeArgs(run, settings)                   // run.model is the model the queue chose
allowedTools = allowedToolsFor(run.kind, settings)      // for checkInitEvent
env = buildRunEnvironment(process.env, runToken)
command = await claudeCli.resolveCommand()
spawned = spawnRun({ command, args, cwd: directory, env, stdinText: playbookText, onStdoutLine })
  // save spawned.pid on the run; start the timeout (settings.timeoutMinutes)
  // each line: append to join(directory, TRANSCRIPT_FILE_NAME), then parseStreamLine(line)
  //   init   -> save sessionId; reason = checkInitEvent(init, allowedTools); if reason: kill, fail "This run was stopped for safety"
  //   result -> keep it
exit = await spawned.exit
end = classifyRunEnd({ exitCode: exit.exitCode, result, timedOut, cancelled, tasks })
  // mark tasksLeftPending(tasks) failed; save end.status, end.outcomeMessage, result.resultText (ask runs), end.resetsAt
// at server start, before the queue runs:
recoverLeftoverRuns({ db, isAlive: isProcessAlive, imageName: processImageName,
  kill: (pid) => killProcessTree(pid, { force: true }),
  expectedImageNames: imageNamesOfCommand(await claudeCli.resolveCommand()), now })
```

## Why each flag is there

| Flag | Why |
| --- | --- |
| `-p` | One non-interactive run. The playbook comes on stdin (D6), so there is no Windows quoting or length limit. |
| `--output-format stream-json --verbose` | One JSON object per line: the `init` line, a line per tool call, the `result` line. Print mode needs `--verbose` for this format. |
| `--model <tier>` | `haiku`, `sonnet` or `opus`, from the run record (the kind's default, or the queue's override for a tailor retry). |
| `--mcp-config mcp.json` | The run's only tool server: `http://127.0.0.1:<port>/mcp`. The path is relative because the run directory is the working directory. |
| `--strict-mcp-config` | Use only that file. The person's own MCP servers are never loaded. |
| `--tools <list>` | The built-in tools that exist at all. Empty (`""`) for every kind except hunt, so Bash, PowerShell, Read, Edit and Write are never available. |
| `--allowedTools <list>` | The permission rules: the kind's `mcp__jobgoblin__*` tools and its built-ins. For hunt, `WebFetch` appears only as `WebFetch(domain:<job board>)` rules. |
| `--setting-sources project` | Read only `<run directory>/.claude/settings.json`. The person's own settings, hooks and plugins are ignored. |
| `--permission-mode dontAsk` | Anything not allowed is refused, never asked about. A background run has nobody to ask. |
| `--max-turns <n>` | A runaway run stops. Reaching it ends the run as `error_max_turns`. |

The run token is never on the command line or in a file. `mcp.json` holds `Bearer ${JOBGOBLIN_RUN_TOKEN}` and Claude Code fills it in from the environment.

## Files

| File | Idea |
| --- | --- |
| [runConstants.ts](runConstants.ts) | The MCP server name, token variable name and file names, in one place |
| [claudeCli.ts](claudeCli.ts) | Find, check, install and sign in the person's Claude Code |
| [claudeArgs.ts](claudeArgs.ts) | The flags, the job-board domain list, the allowed tool rules |
| [runEnvironment.ts](runEnvironment.ts) | The scrubbed environment |
| [runDirectory.ts](runDirectory.ts) | The playbook text and the run directory's files |
| [streamJson.ts](streamJson.ts) | Reading the stream; the init safety check |
| [outcome.ts](outcome.ts) | How a run ended |
| [processes.ts](processes.ts) | The only file that imports `node:child_process` |
| [recovery.ts](recovery.ts) | Leftover runs after a crash or restart |
| `testSupport.ts`, `stubMcpServer.ts` | Test helpers only |

## How it is tested

`pnpm exec vitest run packages/server/src/runner`. Unit tests inject their dependencies: `claudeCli` takes a `CommandRunner`, `recovery` takes the process functions, so those never start a process. `processes.test.ts` starts small `node -e` programs. `integration.test.ts` runs the real fake claude (`pnpm --filter @jobgoblin/fake-claude build` first) through `spawnRun` against `stubMcpServer.ts`. `playbooks.test.ts` checks the real files in `playbooks/`: short, only their kind's tools, every tool of the kind mentioned.

## Decisions

1. **`WebFetch` is never a bare allow rule.** Section 10 says `--allowedTools` holds the kind's built-ins plus the domain rules. A bare `WebFetch` would allow every site, so for hunt it is replaced by `WebFetch(domain:<d>)` rules. `--tools` still lists `WebFetch` so the tool exists. `.claude/settings.json` mirrors this and denies every built-in tool the kind does not have.
2. **`--tools` and `--allowedTools` are one comma-joined argument each.** Both are variadic in Claude Code, and one value per flag is unambiguous. `--tools ""` is an empty argument.
3. **The environment is scrubbed case-insensitively on every system,** and the same scrub is applied to `claude --version`, `auth status`, `auth login` and the installer, so the sign-in check describes how a run will really authenticate.
4. **The init check compares tool names, not rules.** `WebFetch(domain:x)` and `WebFetch` are the same tool. The check is strict as the spec says: any tool outside the kind's list stops the run. If a real Claude Code lists a harmless helper tool, REAL_CLAUDE_CHECKLIST check 3 will show it, and the fix is one named exception here.
5. **The usage-limit message has no time in it.** `classifyRunEnd` returns `resetsAt` (ISO) next to the constant message; the dashboard formats it in the person's time zone.
6. **`exitCode` is accepted but does not change the answer.** A success `result` means every result was already saved through tools, so the run is done even if the process was killed afterwards. No `result` is always failed. Any other `is_error` result is failed too, so an error can never become "done".
7. **Pending tasks count as failed.** `classifyRunEnd` calls a run waiting when at least one task waits; `tasksLeftPending` lists the tasks the launcher must mark failed.
8. **Recovery interrupts every `running` or `waiting` run,** with or without a saved pid, and clears the pid. It stops a process only when it is alive and its program name matches the Claude command (`node` when the command is node, for the fake). On macOS the native installer may run a versioned binary whose `ps` name is not `claude`; recovery then leaves it alone, which is the safe direction.
9. **`claudeCommand` must be absolute paths,** all of them, and `createClaudeCli` throws otherwise. Detection never returns `claude.cmd`. Besides PATH and `~/.local/bin`, Windows also looks in `%LOCALAPPDATA%\Microsoft\WinGet\Links`, because winget installs there and the running server's PATH does not know it yet.
10. **`signIn()` waits up to 5 minutes** for `claude auth login` to end, then returns the status. The dashboard polls `GET /api/claude/status` meanwhile. `authMethod` must be `claude.ai`; other methods count as signed out. Only the login state, the method and the plan are kept; the e-mail address in the JSON is dropped.
11. **`spawnRun` takes a line callback, not a stream.** The listener exists before any output can arrive, so no line is ever lost.
12. **Playbook line endings are normalised to `\n`** so line 1 and 2 are the same on every system.
13. **There is no `index.ts`.** `launcher.ts` and the services import the module they need.
14. **`playbooks/rubric.md` starts with `<!-- rubric-version: 1 -->`.** The server can read that for `Fit.rubricVersion`.
15. **Run directory clean-up (transcripts kept 14 days) is not here.** It belongs to the launcher.
