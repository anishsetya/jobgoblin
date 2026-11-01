// Reads what `claude -p --output-format stream-json` prints, one line at a time, and keeps only the three kinds
// of line the runner needs: the `init` line (session id, tools, MCP servers), the tool calls, and the `result`.
// Everything else, and anything that is not JSON, becomes an "other" event: a strange line never stops a run.
// It also holds the safety check on the `init` line: a run that shows a tool it must not have is stopped.
// Spec: ARCHITECTURE.md section 10 (step 7) and section 14 (the shapes the fake prints).
import { z } from "zod";
import { MCP_SERVER_NAME } from "./runConstants";

export type McpServerStatus = { name: string; status: string };

export type InitEvent = {
  kind: "init";
  sessionId: string | null;
  tools: string[]; // every tool the session has, built-in and MCP
  mcpServers: McpServerStatus[];
};

// One assistant line can hold several tool calls; these are their names.
export type ToolUseEvent = { kind: "tool-use"; toolNames: string[] };

export type ResultEvent = {
  kind: "result";
  subtype: string; // "success", "error_max_turns", "error_during_execution", ...
  isError: boolean;
  resultText: string; // the final answer, or the error message
  numTurns: number | null;
  sessionId: string | null;
};

export type OtherEvent = { kind: "other" };

export type StreamEvent = InitEvent | ToolUseEvent | ResultEvent | OtherEvent;

// The schemas are lenient on purpose: they name only the fields the runner uses, and give a default to any
// field a newer Claude Code might leave out. They are not a contract with Claude Code; they are a reader.
const InitLine = z.object({
  type: z.literal("system"),
  subtype: z.literal("init"),
  session_id: z.string().optional(),
  tools: z.array(z.string()).default([]),
  mcp_servers: z.array(z.object({ name: z.string(), status: z.string() })).default([]),
});

const AssistantLine = z.object({
  type: z.literal("assistant"),
  message: z.object({ content: z.array(z.unknown()).default([]) }),
});

const ToolUseBlock = z.object({ type: z.literal("tool_use"), name: z.string() });

const ResultLine = z.object({
  type: z.literal("result"),
  subtype: z.string().default("success"),
  is_error: z.boolean().default(false),
  result: z.string().default(""),
  num_turns: z.number().optional(),
  session_id: z.string().optional(),
});

const OTHER: OtherEvent = { kind: "other" };

// Never throws. A blank line, text that is not JSON, JSON that is not one of the known lines: all "other".
export function parseStreamLine(line: string): StreamEvent {
  const json = parseJsonOrNull(line);
  if (typeof json !== "object" || json === null) return OTHER;

  const type = "type" in json ? json.type : undefined;
  if (type === "system") return readInit(json);
  if (type === "assistant") return readToolUses(json);
  if (type === "result") return readResult(json);
  return OTHER;
}

function parseJsonOrNull(line: string): unknown {
  if (line.trim() === "") return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function readInit(json: object): StreamEvent {
  const parsed = InitLine.safeParse(json);
  if (!parsed.success) return OTHER; // other `system` lines, such as status notes, are not the init
  return {
    kind: "init",
    sessionId: parsed.data.session_id ?? null,
    tools: parsed.data.tools,
    mcpServers: parsed.data.mcp_servers,
  };
}

function readToolUses(json: object): StreamEvent {
  const parsed = AssistantLine.safeParse(json);
  if (!parsed.success) return OTHER;

  const toolNames: string[] = [];
  for (const block of parsed.data.message.content) {
    const toolUse = ToolUseBlock.safeParse(block);
    if (toolUse.success) toolNames.push(toolUse.data.name);
  }
  return toolNames.length === 0 ? OTHER : { kind: "tool-use", toolNames };
}

function readResult(json: object): StreamEvent {
  const parsed = ResultLine.safeParse(json);
  if (!parsed.success) return OTHER;
  return {
    kind: "result",
    subtype: parsed.data.subtype,
    isError: parsed.data.is_error,
    resultText: parsed.data.result,
    numTurns: parsed.data.num_turns ?? null,
    sessionId: parsed.data.session_id ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// The safety check on the init line
// ---------------------------------------------------------------------------------------------

// A permission rule such as "WebFetch(domain:jobs.lever.co)" names the tool "WebFetch". Claude Code's init line
// lists the tool by that plain name, while --allowedTools holds the rules.
function toolNameOfRule(rule: string): string {
  const bracketAt = rule.indexOf("(");
  const name = bracketAt === -1 ? rule : rule.slice(0, bracketAt);
  return SAME_TOOL_OLDER_NAME[name] ?? name;
}

// The subagent tool is "Agent" in newer Claude Code and "Task" in older versions (2.1.316 still lists "Task").
// Both names mean the same tool, so the check compares them as one.
const SAME_TOOL_OLDER_NAME: Readonly<Record<string, string>> = { Task: "Agent" };

// Returns null when the run is safe to continue, or a plain reason to stop it. The launcher stops the run
// ("This run was stopped for safety") on any reason, because the launch flags did not seal the run as intended:
// for example a Claude Code version that ignores --tools, or a personal setting that adds a tool.
export function checkInitEvent(init: InitEvent, allowedTools: readonly string[]): string | null {
  const allowedNames = new Set(allowedTools.map(toolNameOfRule));
  const unexpectedTools = init.tools.filter((tool) => !allowedNames.has(toolNameOfRule(tool)));
  if (unexpectedTools.length > 0) {
    return `The run has tools it was not allowed to have: ${unexpectedTools.join(", ")}.`;
  }

  const server = init.mcpServers.find((candidate) => candidate.name === MCP_SERVER_NAME);
  if (server === undefined) return `The ${MCP_SERVER_NAME} tool server is missing from the run.`;
  if (server.status !== "connected") return `The ${MCP_SERVER_NAME} tool server is ${server.status}, not connected.`;

  return null;
}
