// One run from start to finish, with nothing replaced except Claude Code itself: the real fake claude is started
// through spawnRun, with the flags from buildClaudeArgs and the environment from buildRunEnvironment, inside a
// directory made by createRunDirectory, and it talks to a small stub of the server's /mcp endpoint.
// The run's lines are read with parseStreamLine, checked with checkInitEvent and classified with classifyRunEnd.
import fs from "node:fs";
import path from "node:path";
import { RUN_KIND_SETTINGS } from "@jobgoblin/schemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allowedToolsFor, buildClaudeArgs } from "./claudeArgs";
import { classifyRunEnd } from "./outcome";
import { spawnRun } from "./processes";
import { buildRunEnvironment } from "./runEnvironment";
import { buildPlaybook, createRunDirectory } from "./runDirectory";
import { startStubMcpServer } from "./stubMcpServer";
import type { StubMcpServer } from "./stubMcpServer";
import { checkInitEvent, parseStreamLine } from "./streamJson";
import type { InitEvent, ResultEvent, StreamEvent } from "./streamJson";
import { aRun, makeTempDir, removeTempDirs, REPOSITORY_ROOT } from "./testSupport";

const FAKE_CLAUDE_PATH = path.join(REPOSITORY_ROOT, "fixtures", "fake-claude", "dist", "cli.mjs");
const TAILOR_SETTINGS = RUN_KIND_SETTINGS.tailor;

let server: StubMcpServer;

beforeEach(async () => {
  if (!fs.existsSync(FAKE_CLAUDE_PATH)) {
    throw new Error("The fake claude is not built. Run: pnpm --filter @jobgoblin/fake-claude build");
  }
  server = await startStubMcpServer();
});

afterEach(async () => {
  await server.close();
  removeTempDirs();
});

// The environment of the person's shell: a billing variable that must be removed, and no leftover FAKE_CLAUDE_*
// switches from the machine running the tests.
function personsEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, ANTHROPIC_API_KEY: "sk-must-not-reach-the-run" };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("FAKE_CLAUDE_")) delete environment[name];
  }
  return { ...environment, ...extra };
}

type FinishedRun = {
  events: StreamEvent[];
  exitCode: number | null;
  directory: string;
  init: InitEvent;
  result: ResultEvent | null;
};

// Launches a tailor run the way launcher.ts will: directory, args, environment, spawn, read lines.
async function launchTailorRun(extraEnvironment: Record<string, string> = {}): Promise<FinishedRun> {
  const resourcesDir = REPOSITORY_ROOT;
  const run = aRun({ id: "run-integration", kind: "tailor", model: "haiku" });
  const playbookText = buildPlaybook(run.kind, run.input, resourcesDir);
  const { directory } = createRunDirectory({ appDataDir: makeTempDir(), resourcesDir, run, port: server.port, playbookText });

  const events: StreamEvent[] = [];
  const spawned = spawnRun({
    command: [process.execPath, FAKE_CLAUDE_PATH],
    args: buildClaudeArgs(run, TAILOR_SETTINGS),
    cwd: directory,
    env: buildRunEnvironment(personsEnvironment(extraEnvironment), server.token),
    stdinText: playbookText,
    onStdoutLine: (line) => events.push(parseStreamLine(line)),
  });
  const exit = await spawned.exit;

  const init = events.find((event): event is InitEvent => event.kind === "init");
  if (init === undefined) throw new Error(`The run printed no init line. stderr: ${exit.stderrTail}`);
  const result = events.find((event): event is ResultEvent => event.kind === "result") ?? null;
  return { events, exitCode: exit.exitCode, directory, init, result };
}

describe("a tailor run with the fake claude", () => {
  it("starts, passes the safety check on its init line, and ends classified as done", async () => {
    const run = await launchTailorRun();

    expect(checkInitEvent(run.init, allowedToolsFor("tailor", TAILOR_SETTINGS))).toBeNull();
    expect(run.init.sessionId).not.toBeNull();
    expect(run.result).toMatchObject({ subtype: "success", isError: false });
    expect(run.exitCode).toBe(0);
    expect(classifyRunEnd({ exitCode: run.exitCode, result: run.result, timedOut: false, cancelled: false, tasks: [] })).toEqual({
      status: "done",
      outcomeMessage: "Finished",
    });
  });

  it("reaches the server with the run token from the environment, and only there", async () => {
    const run = await launchTailorRun();

    expect(server.toolCalls).toEqual(["next_task"]);
    expect(new Set(server.authorizationHeaders)).toEqual(new Set([`Bearer ${server.token}`]));
    expect(fs.readFileSync(path.join(run.directory, "mcp.json"), "utf8")).not.toContain(server.token);
    expect(fs.readFileSync(path.join(run.directory, "PLAYBOOK.md"), "utf8")).not.toContain(server.token);
  });

  it("lists exactly the tools the run was allowed in its init line", async () => {
    const run = await launchTailorRun();

    expect(run.init.tools).toEqual(allowedToolsFor("tailor", TAILOR_SETTINGS));
    expect(run.init.mcpServers).toEqual([{ name: "jobgoblin", status: "connected" }]);
    expect(run.events.filter((event) => event.kind === "tool-use")).toEqual([
      { kind: "tool-use", toolNames: ["mcp__jobgoblin__next_task"] },
    ]);
  });

  it("is classified as blocked when the fake hits its usage limit", async () => {
    const run = await launchTailorRun({ FAKE_CLAUDE_MODE: "usage-limit" });

    const end = classifyRunEnd({ exitCode: run.exitCode, result: run.result, timedOut: false, cancelled: false, tasks: [] });

    expect(end.status).toBe("blocked");
    expect(end.resetsAt).toBeDefined();
  });

  it("is classified as failed when the fake crashes after its init line", async () => {
    const run = await launchTailorRun({ FAKE_CLAUDE_MODE: "crash" });

    expect(run.result).toBeNull();
    expect(classifyRunEnd({ exitCode: run.exitCode, result: run.result, timedOut: false, cancelled: false, tasks: [] }).status).toBe("failed");
  });

});

describe("a run that has a tool it must not have", () => {
  it("fails the init check when the fake lists Bash (FAKE_CLAUDE_MODE=extra-tools)", async () => {
    const run = await launchTailorRun({ FAKE_CLAUDE_MODE: "extra-tools" });

    const reason = checkInitEvent(run.init, allowedToolsFor("tailor", TAILOR_SETTINGS));

    expect(run.init.tools).toContain("Bash");
    expect(reason).toContain("Bash");
  });
});
