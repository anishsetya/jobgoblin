// Starts the built fake the way the runner will: `node dist/cli.mjs` with the real flags, the playbook on
// stdin, and a run directory that holds mcp.json, which is NOT the folder the tests run from.
// Returns what the runner would see: the exit code, stdout parsed into stream-json lines, and stderr.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { BUILT_CLI_PATH } from "./builtCli";
import type { StubServer } from "./stubJobgoblinServer";

const RUN_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------------------------
// The lines the runner reads. Parsing them with strict schemas also checks their exact shape.
// ---------------------------------------------------------------------------------------------

const InitLine = z.object({
  type: z.literal("system"),
  subtype: z.literal("init"),
  cwd: z.string(),
  session_id: z.string(),
  tools: z.array(z.string()),
  mcp_servers: z.array(z.object({ name: z.string(), status: z.string() })),
  model: z.string(),
  permissionMode: z.string(),
});

const AssistantLine = z.object({
  type: z.literal("assistant"),
  session_id: z.string(),
  message: z.object({
    role: z.literal("assistant"),
    content: z.array(z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() })),
  }),
});

const ResultLine = z.object({
  type: z.literal("result"),
  subtype: z.enum(["success", "error_max_turns", "error_during_execution"]),
  is_error: z.boolean(),
  result: z.string(),
  num_turns: z.number(),
  session_id: z.string(),
});

export type InitLine = z.infer<typeof InitLine>;
export type ResultLine = z.infer<typeof ResultLine>;

export type ToolUse = { name: string; input: unknown };

export type CommandOutcome = { exitCode: number | null; stdout: string; stderr: string; elapsedMs: number };

export type ScriptedRun = CommandOutcome & {
  init: InitLine | undefined;
  result: ResultLine | undefined;
  toolUses: ToolUse[]; // the `assistant` lines, in order, with the mcp__jobgoblin__ prefix removed
};

// ---------------------------------------------------------------------------------------------
// Running the fake
// ---------------------------------------------------------------------------------------------

// For `--version` and `auth ...`: no playbook, no server.
export function runFakeClaudeCommand(args: string[], env: Record<string, string> = {}): Promise<CommandOutcome> {
  return spawnFakeClaude({ args, stdin: "", env, cwd: mkdtempSync(join(tmpdir(), "fake-claude-cmd-")) });
}

export type ScriptedRunOptions = {
  playbook: string;
  server: StubServer;
  env?: Record<string, string>;
  allowedTools?: string[];
  maxTurns?: number;
  extraArguments?: string[];
  runToken?: string | null; // what JOBGOBLIN_RUN_TOKEN is; null leaves it unset
};

export async function runScriptedRun(options: ScriptedRunOptions): Promise<ScriptedRun> {
  const runDirectory = createRunDirectory(options.server.url);
  const allowedTools = options.allowedTools ?? ["mcp__jobgoblin__next_task"];

  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--model", "haiku",
    "--mcp-config", "mcp.json",
    "--strict-mcp-config",
    "--tools", "",
    "--allowedTools", ...allowedTools,
    "--setting-sources", "project",
    "--permission-mode", "dontAsk",
    "--max-turns", String(options.maxTurns ?? 80),
    ...(options.extraArguments ?? []),
  ];

  const token = options.runToken === undefined ? options.server.token : options.runToken;
  const tokenEnv: Record<string, string> = token === null ? {} : { JOBGOBLIN_RUN_TOKEN: token };

  const outcome = await spawnFakeClaude({
    args,
    stdin: options.playbook,
    env: { ...tokenEnv, ...options.env },
    cwd: runDirectory,
  });
  return { ...outcome, ...readStreamLines(outcome.stdout) };
}

// The playbook the runner writes: line 1 is the run kind, line 2 the run input (decision D6).
export function aPlaybook(kind: string, input: Record<string, unknown> = {}): string {
  return `<!-- run-kind: ${kind} -->\n<!-- run-input: ${JSON.stringify(input)} -->\n\n# Playbook\n\nDo the work.\n`;
}

// A run directory like the one the runner makes: a mcp.json that names the token only through an
// environment variable, so the file itself never holds the secret.
function createRunDirectory(serverUrl: string): string {
  const runDirectory = mkdtempSync(join(tmpdir(), "fake-claude-run-"));
  mkdirSync(runDirectory, { recursive: true });

  const mcpConfig = {
    mcpServers: {
      jobgoblin: {
        type: "http",
        url: serverUrl,
        headers: { Authorization: "Bearer ${JOBGOBLIN_RUN_TOKEN}" },
      },
    },
  };
  writeFileSync(join(runDirectory, "mcp.json"), JSON.stringify(mcpConfig));
  return runDirectory;
}

type SpawnOptions = { args: string[]; stdin: string; env: Record<string, string>; cwd: string };

function spawnFakeClaude(options: SpawnOptions): Promise<CommandOutcome> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [BUILT_CLI_PATH, ...options.args], {
      cwd: options.cwd,
      env: cleanEnvironment(options.env),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`The fake claude did not finish in ${RUN_TIMEOUT_MS} ms.\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, RUN_TIMEOUT_MS);

    child.on("error", reject);
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, elapsedMs: Date.now() - startedAt });
    });

    child.stdin.on("error", () => undefined); // a run that ends before reading everything is a result, not a crash
    child.stdin.end(options.stdin);
  });
}

// The machine's own FAKE_CLAUDE_* switches must never leak into a test.
function cleanEnvironment(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("FAKE_CLAUDE_") && name !== "JOBGOBLIN_RUN_TOKEN") env[name] = value;
  }
  return { ...env, ...extra };
}

function readStreamLines(stdout: string): Pick<ScriptedRun, "init" | "result" | "toolUses"> {
  let init: InitLine | undefined;
  let result: ResultLine | undefined;
  const toolUses: ToolUse[] = [];

  for (const text of stdout.split("\n").filter((line) => line.trim() !== "")) {
    const line: unknown = JSON.parse(text); // one JSON object per line, or the test fails here
    const type = z.object({ type: z.string() }).parse(line).type;

    if (type === "system") init = InitLine.parse(line);
    else if (type === "result") result = ResultLine.parse(line);
    else if (type === "assistant") {
      for (const block of AssistantLine.parse(line).message.content) {
        toolUses.push({ name: block.name.replace(/^mcp__jobgoblin__/, ""), input: block.input });
      }
    }
  }
  return { init, result, toolUses };
}
