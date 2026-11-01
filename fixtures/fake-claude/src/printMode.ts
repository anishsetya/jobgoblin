// `claude -p`: one scripted run. Reads the playbook from stdin, connects to the server, prints the `init`
// line, plays the script for the run kind, and prints the `result` line. The FAKE_CLAUDE_MODE failures
// (signed out, usage limit, crash, ...) are decided here, before or instead of the script.
// Spec: ARCHITECTURE.md sections 10 (steps 4 to 7) and 14.
import { randomUUID } from "node:crypto";
import type { PrintOptions } from "./arguments";
import { connectToJobgoblin } from "./mcpConnection";
import type { McpConnection } from "./mcpConnection";
import { parsePlaybookHeader, readStandardInput } from "./playbook";
import type { PlaybookHeader } from "./playbook";
import { SCRIPTS } from "./scripts/registry";
import { createScriptSession, MaxTurnsReached } from "./session";
import { readFakeSettings } from "./settings";
import type { FakeSettings } from "./settings";
import { createStreamPrinter } from "./streamJson";
import type { StreamPrinter } from "./streamJson";
import { EXIT_FAILED, EXIT_OK } from "./versionAndAuth";

// The text of the real message. The dot between the two sentences is U+00B7.
const NOT_LOGGED_IN_TEXT = "Not logged in · Please run /login";
const USAGE_LIMIT_RESETS_IN_SECONDS = 60 * 60;
// In max-turns mode a run stops after this many tool calls, whatever --max-turns says.
const MAX_TURNS_IN_MAX_TURNS_MODE = 2;
// The extra tool that extra-tools mode lists: the runner must refuse a run that has it.
const FORBIDDEN_EXTRA_TOOL = "Bash";

export async function runPrintMode(options: PrintOptions, env: NodeJS.ProcessEnv): Promise<number> {
  const settings = readFakeSettings(env);
  const playbookText = await readStandardInput(); // read first, always: see readStandardInput
  const printer = createStreamPrinter({ sessionId: randomUUID(), model: options.model });

  if (settings.mode === "signed-out") {
    // Like the real CLI, a signed-out run prints only its result: it never gets as far as `init`.
    printer.printResult({ subtype: "success", isError: true, result: NOT_LOGGED_IN_TEXT, numTurns: 0 });
    return EXIT_FAILED;
  }

  const playbook = parsePlaybookHeader(playbookText);
  const connect = await tryToConnect(options, env);
  printer.printInit({
    cwd: process.cwd(),
    permissionMode: options.permissionMode ?? "default",
    tools: toolsToAnnounce(options, settings),
    mcpStatus: connect.connected ? "connected" : "failed",
  });

  if (!connect.connected) {
    // The reason goes to stderr; the result text stays neutral so the runner does not mistake it for a sign-in problem.
    process.stderr.write(`fake-claude: could not connect to the jobgoblin server: ${connect.reason}\n`);
    printer.printResult({
      subtype: "error_during_execution",
      isError: true,
      result: "Could not connect to the jobgoblin tool server.",
      numTurns: 0,
    });
    return EXIT_FAILED;
  }

  try {
    return await playTheRun({ options, settings, playbook, printer, connection: connect.connection });
  } finally {
    await closeQuietly(connect.connection);
  }
}

type ConnectResult = { connected: true; connection: McpConnection } | { connected: false; reason: string };

async function tryToConnect(options: PrintOptions, env: NodeJS.ProcessEnv): Promise<ConnectResult> {
  if (options.mcpConfigPath === null) return { connected: false, reason: "no --mcp-config was given" };

  try {
    return { connected: true, connection: await connectToJobgoblin(options.mcpConfigPath, env) };
  } catch (error) {
    return { connected: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

// `init` lists the tools the run was allowed. The runner checks this list, so extra-tools mode adds one.
function toolsToAnnounce(options: PrintOptions, settings: FakeSettings): string[] {
  if (settings.mode === "extra-tools") return [...options.allowedTools, FORBIDDEN_EXTRA_TOOL];
  return options.allowedTools;
}

type RunParts = {
  options: PrintOptions;
  settings: FakeSettings;
  playbook: PlaybookHeader;
  printer: StreamPrinter;
  connection: McpConnection;
};

async function playTheRun(parts: RunParts): Promise<number> {
  const { settings, printer } = parts;

  if (settings.mode === "usage-limit") {
    const resetsAtEpochSeconds = Math.floor(Date.now() / 1000) + USAGE_LIMIT_RESETS_IN_SECONDS;
    printer.printResult({
      subtype: "success",
      isError: true,
      result: `Claude AI usage limit reached|${resetsAtEpochSeconds}`,
      numTurns: 0,
    });
    return EXIT_FAILED;
  }

  if (settings.mode === "crash") {
    process.stderr.write("fake-claude: crashing on purpose (FAKE_CLAUDE_MODE=crash)\n");
    return EXIT_FAILED; // after `init`, with no `result` line
  }

  const session = createScriptSession({
    kind: parts.playbook.kind,
    input: parts.playbook.input,
    settings,
    connection: parts.connection,
    printer,
    maxTurns: effectiveMaxTurns(parts.options, settings),
  });

  try {
    const resultText = await SCRIPTS[parts.playbook.kind](session);
    printer.printResult({ subtype: "success", isError: false, result: resultText, numTurns: session.toolCallCount() });
    return EXIT_OK;
  } catch (error) {
    printFailure(printer, error, session.toolCallCount());
    return EXIT_FAILED;
  }
}

function effectiveMaxTurns(options: PrintOptions, settings: FakeSettings): number | null {
  if (settings.mode !== "max-turns") return options.maxTurns;
  return Math.min(options.maxTurns ?? MAX_TURNS_IN_MAX_TURNS_MODE, MAX_TURNS_IN_MAX_TURNS_MODE);
}

function printFailure(printer: StreamPrinter, error: unknown, numTurns: number): void {
  if (error instanceof MaxTurnsReached) {
    printer.printResult({ subtype: "error_max_turns", isError: true, result: error.message, numTurns });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  printer.printResult({ subtype: "error_during_execution", isError: true, result: message, numTurns });
}

// The run is already over; a failure to say goodbye to the server must not change its outcome.
async function closeQuietly(connection: McpConnection): Promise<void> {
  try {
    await connection.close();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`fake-claude: closing the server connection failed: ${reason}\n`);
  }
}
