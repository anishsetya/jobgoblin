// Launches ONE claimed run from start to finish and returns it with its final status. Each step is a building
// block from this folder, called in the order runner/README.md lists: check Claude Code, write the playbook and
// the run directory, build the flags and the environment, start the process with the playbook on stdin, read the
// stream line by line, wait for the end, classify it and record it.
// The queue (which run, how many at once, pausing) is launcher.ts; what happens after a run is afterRun.ts.
// Spec: ARCHITECTURE.md section 10 (Launch, Outcome).
import path from "node:path";
import { appendFileSync } from "node:fs";
import { STEP_CHECKING_JOB_BOARDS } from "@jobgoblin/core";
import { RUN_KIND_SETTINGS, type Run } from "@jobgoblin/schemas";
import { listRunTasks, updateRun } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { announceRun } from "../services/changes";
import { refreshFeeds } from "../services/feeds";
import { allowedToolsFor, buildClaudeArgs } from "./claudeArgs";
import type { ClaudeCli } from "./claudeCli";
import { finishRun } from "./finishRun";
import { classifyRunEnd, OUTCOME_MESSAGES, type RunEnd } from "./outcome";
import { spawnRun, type RunExit, type SpawnedRun } from "./processes";
import { buildPlaybook, createRunDirectory } from "./runDirectory";
import { buildRunEnvironment } from "./runEnvironment";
import { TRANSCRIPT_FILE_NAME } from "./runConstants";
import { stopProcessTree } from "./stopRun";
import { checkInitEvent, parseStreamLine, type ResultEvent, type StreamEvent } from "./streamJson";

const STOPPED_FOR_SAFETY: RunEnd = { status: "failed", outcomeMessage: "This run was stopped for safety" };
const CANCELLED: RunEnd = { status: "cancelled", outcomeMessage: OUTCOME_MESSAGES.cancelled };
const MILLISECONDS_PER_MINUTE = 60_000;

// What the launcher keeps for a run it started, so cancel can reach it.
export type RunHandle = {
  cancelRequested: boolean;
  // Set once the process exists: stops it (politely, then for good). Null before that.
  stop: (() => Promise<void>) | null;
};

export type LaunchDeps = { ctx: ServerContext; claudeCli: ClaudeCli };

export async function launchRun(deps: LaunchDeps, run: Run, handle: RunHandle): Promise<Run> {
  try {
    return await launchSteps(deps, run, handle);
  } catch (error) {
    // Never swallowed: the full error is in the log, and the person sees the calm "stopped before finishing".
    deps.ctx.logger.error({ err: error, runId: run.id, kind: run.kind }, "A run could not be launched.");
    await handle.stop?.();
    return finishRun(deps.ctx, run, { end: { status: "failed", outcomeMessage: OUTCOME_MESSAGES.stopped }, resultText: null });
  }
}

async function launchSteps(deps: LaunchDeps, run: Run, handle: RunHandle): Promise<Run> {
  const { ctx, claudeCli } = deps;
  const endWithout = (end: RunEnd): Run => finishRun(ctx, run, { end, resultText: null });

  if (run.kind === "hunt") await fetchJobBoards(ctx, run);
  if (handle.cancelRequested) return endWithout(CANCELLED);

  const blockedMessage = await whyClaudeIsBlocked(claudeCli);
  if (blockedMessage !== null) return endWithout({ status: "blocked", outcomeMessage: blockedMessage });

  const command = await claudeCli.resolveCommand();
  if (command === null) return endWithout({ status: "blocked", outcomeMessage: BLOCKED_MESSAGES["not-installed"] });
  if (handle.cancelRequested) return endWithout(CANCELLED);

  return superviseProcess(deps, run, handle, command);
}

// Hunt runs read only the database (search_jobs), so the feeds are fetched by code first.
async function fetchJobBoards(ctx: ServerContext, run: Run): Promise<void> {
  const checking = updateRun(ctx.db, run.id, { step: STEP_CHECKING_JOB_BOARDS });
  if (checking !== null) announceRun(ctx, checking);
  await refreshFeeds(ctx);
}

// ---------------------------------------------------------------------------------------------
// Step 1: is Claude Code ready?
// ---------------------------------------------------------------------------------------------

const BLOCKED_MESSAGES = {
  "not-installed": "Claude Code is not installed",
  "update-needed": "Claude Code needs an update",
  "signed-out": OUTCOME_MESSAGES.signedOut,
} as const;

async function whyClaudeIsBlocked(claudeCli: ClaudeCli): Promise<string | null> {
  const status = await claudeCli.status();
  return status.state === "connected" ? null : BLOCKED_MESSAGES[status.state];
}

// ---------------------------------------------------------------------------------------------
// Steps 2 to 8: the process
// ---------------------------------------------------------------------------------------------

// What the lines of the stream told us, filled in while the process runs.
type StreamFindings = { result: ResultEvent | null; unsafeReason: string | null; timedOut: boolean };

async function superviseProcess(deps: LaunchDeps, run: Run, handle: RunHandle, command: string[]): Promise<Run> {
  const { ctx } = deps;
  const settings = RUN_KIND_SETTINGS[run.kind];
  const allowedTools = allowedToolsFor(run.kind, settings);

  const playbookText = buildPlaybook(run.kind, run.input, ctx.resourcesDir);
  const { directory } = createRunDirectory({ appDataDir: ctx.appDataDir, resourcesDir: ctx.resourcesDir, run, port: ctx.port, playbookText });
  const environment = buildRunEnvironment(process.env, ctx.runTokens.issue(run.id));
  const transcriptPath = path.join(directory, TRANSCRIPT_FILE_NAME);

  const findings: StreamFindings = { result: null, unsafeReason: null, timedOut: false };
  let spawned: SpawnedRun | null = null; // set just below; no line can arrive before it is

  const stopProcess = (immediately: boolean): Promise<void> => {
    ctx.runTokens.revoke(run.id); // a process being stopped must not make more tool calls
    if (spawned === null || spawned.pid === null) return Promise.resolve();
    return stopProcessTree({ pid: spawned.pid, exited: spawned.exit, logger: ctx.logger, immediately });
  };

  const readLine = (line: string): void => {
    try {
      appendFileSync(transcriptPath, `${line}\n`);
      const event = parseStreamLine(line);
      const unsafeReason = noteStreamEvent(ctx, run, event, findings, allowedTools);
      if (unsafeReason !== null) {
        ctx.logger.warn({ runId: run.id, reason: unsafeReason }, "A run was stopped for safety.");
        void stopProcess(true);
      }
    } catch (error) {
      ctx.logger.error({ err: error, runId: run.id }, "A line of a run's output could not be handled.");
    }
  };

  spawned = spawnRun({
    command,
    args: buildClaudeArgs(run, settings),
    cwd: directory,
    env: environment,
    stdinText: playbookText,
    onStdoutLine: readLine,
  });
  handle.stop = () => stopProcess(false);
  updateRun(ctx.db, run.id, { pid: spawned.pid });

  const timer = setTimeout(() => {
    findings.timedOut = true;
    void stopProcess(false);
  }, settings.timeoutMinutes * MILLISECONDS_PER_MINUTE);
  const exit = await spawned.exit;
  clearTimeout(timer);

  return recordEnd(deps, run, handle, findings, exit);
}

// Remembers what a stream line says. Returns a reason to stop the run when the init line shows the run is not sealed.
function noteStreamEvent(
  ctx: ServerContext,
  run: Run,
  event: StreamEvent,
  findings: StreamFindings,
  allowedTools: readonly string[],
): string | null {
  if (event.kind === "result") findings.result = event;
  if (event.kind !== "init") return null;

  updateRun(ctx.db, run.id, { sessionId: event.sessionId });
  const reason = checkInitEvent(event, allowedTools);
  findings.unsafeReason = reason;
  return reason;
}

function recordEnd(deps: LaunchDeps, run: Run, handle: RunHandle, findings: StreamFindings, exit: RunExit): Run {
  const { ctx } = deps;
  if (exit.startError !== null) ctx.logger.error({ runId: run.id, reason: exit.startError }, "Claude Code could not be started.");

  // A cancel takes the token away first, so a run cancelled early can show a tool server that "failed" to connect.
  // That is the cancel's doing, not a safety problem, so the cancel is what gets recorded.
  const stoppedForSafety = findings.unsafeReason !== null && !handle.cancelRequested;
  const facts = {
    exitCode: exit.exitCode,
    result: findings.result,
    timedOut: findings.timedOut,
    cancelled: handle.cancelRequested,
    tasks: listRunTasks(ctx.db, run.id),
  };
  const end = stoppedForSafety ? STOPPED_FOR_SAFETY : classifyRunEnd(facts);
  if (end.status === "failed" && !stoppedForSafety) {
    ctx.logger.warn({ runId: run.id, kind: run.kind, exitCode: exit.exitCode, stderr: exit.stderrTail }, "A run stopped before finishing.");
  }
  return finishRun(ctx, run, { end, resultText: answerOfAskRun(run, findings.result) });
}

// An ask run's final text is the answer the person asked for; the other kinds report through tools.
function answerOfAskRun(run: Run, result: ResultEvent | null): string | null {
  if (run.kind !== "ask" || result === null || result.isError) return null;
  return result.resultText;
}
