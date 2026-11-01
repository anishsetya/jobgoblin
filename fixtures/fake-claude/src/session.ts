// What a run kind script works with: the run's kind and input, the switches, and `call`, which calls one
// MCP tool the way Claude would. Every call is printed as an `assistant` line, counted as a turn (so
// --max-turns is honoured), and slowed down when the run is in slow mode.
// Spec: ARCHITECTURE.md section 14.
import type { RunInput, RunKind, ToolError, ToolReply } from "@jobgoblin/schemas";
import type { McpConnection } from "./mcpConnection";
import type { FakeSettings } from "./settings";
import { mcpToolName } from "./streamJson";
import type { StreamPrinter } from "./streamJson";
import type { ToolInput, ToolName, ToolOutput } from "./toolSchemas";

// A run kind script does the run's work and returns the final text for the `result` line.
export type RunScript = (session: ScriptSession) => Promise<string>;

export type ScriptSession = {
  kind: RunKind;
  input: RunInput;
  settings: FakeSettings;
  // Calls a tool and returns the whole reply, for the scripts that handle `ok: false` themselves.
  call<Name extends ToolName>(tool: Name, input: ToolInput<Name>): Promise<ToolReply<ToolOutput<Name>>>;
  // Calls a tool that must succeed and returns its data. A refusal ends the run with an error.
  callForData<Name extends ToolName>(tool: Name, input: ToolInput<Name>): Promise<ToolOutput<Name>>;
  toolCallCount(): number;
};

// Slow mode gives a cancel test time to press Cancel while the run is still going.
export const SLOW_MODE_PAUSE_MS = 2000;

// Thrown when the next tool call would be one more than --max-turns allows.
export class MaxTurnsReached extends Error {
  readonly maxTurns: number;

  constructor(maxTurns: number) {
    super(`Reached the maximum number of turns (${maxTurns}).`);
    this.maxTurns = maxTurns;
  }
}

// Thrown by callForData when the server answered `ok: false`.
export class ToolRefused extends Error {
  constructor(tool: string, errors: ToolError[]) {
    const reasons = errors.map((error) => `${error.code}: ${error.message}`).join("; ");
    super(`${tool} was refused. ${reasons}`);
  }
}

type SessionParts = {
  kind: RunKind;
  input: RunInput;
  settings: FakeSettings;
  connection: McpConnection;
  printer: StreamPrinter;
  maxTurns: number | null; // null: no limit
};

export function createScriptSession(parts: SessionParts): ScriptSession {
  let toolCalls = 0;

  async function call<Name extends ToolName>(
    tool: Name,
    input: ToolInput<Name>,
  ): Promise<ToolReply<ToolOutput<Name>>> {
    if (parts.maxTurns !== null && toolCalls >= parts.maxTurns) throw new MaxTurnsReached(parts.maxTurns);

    // The pause comes before every call, the first one included, so there is always time after `init`.
    if (parts.settings.mode === "slow") await sleep(SLOW_MODE_PAUSE_MS);

    toolCalls += 1;
    parts.printer.printToolUse(mcpToolName(tool), input);
    return parts.connection.callTool(tool, input);
  }

  async function callForData<Name extends ToolName>(tool: Name, input: ToolInput<Name>): Promise<ToolOutput<Name>> {
    const reply = await call(tool, input);
    if (!reply.ok) throw new ToolRefused(tool, reply.errors);
    return reply.data;
  }

  return {
    kind: parts.kind,
    input: parts.input,
    settings: parts.settings,
    call,
    callForData,
    toolCallCount: () => toolCalls,
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
