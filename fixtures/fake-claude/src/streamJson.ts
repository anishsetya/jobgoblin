// Prints what `claude -p --output-format stream-json` prints: one JSON object per line on stdout.
// The runner reads exactly these three kinds of line: `system`/`init` once at the start, an `assistant`
// line for every tool call, and one `result` line at the end. The real CLI prints more (such as `user`
// lines with tool results); the runner ignores those, so the fake leaves them out.
// Spec: ARCHITECTURE.md sections 10 (step 7, parseStreamLine) and 14.

// Claude Code names a tool from an MCP server "mcp__<server>__<tool>". The server here is "jobgoblin".
export const JOBGOBLIN_SERVER_NAME = "jobgoblin";

export function mcpToolName(tool: string): string {
  return `mcp__${JOBGOBLIN_SERVER_NAME}__${tool}`;
}

export type InitInfo = {
  cwd: string;
  permissionMode: string;
  tools: string[]; // what the run says it can use; the runner checks this against its own list
  mcpStatus: "connected" | "failed";
};

export type ResultSubtype = "success" | "error_max_turns" | "error_during_execution";

export type ResultInfo = {
  subtype: ResultSubtype;
  isError: boolean;
  result: string; // the final text, or the error message
  numTurns: number;
};

export type StreamPrinter = {
  printInit(info: InitInfo): void;
  printToolUse(toolName: string, input: unknown): void;
  printResult(info: ResultInfo): void;
};

export function createStreamPrinter(identity: { sessionId: string; model: string }): StreamPrinter {
  let toolUseCount = 0;

  function printLine(line: object): void {
    process.stdout.write(`${JSON.stringify(line)}\n`);
  }

  return {
    printInit(info) {
      printLine({
        type: "system",
        subtype: "init",
        cwd: info.cwd,
        session_id: identity.sessionId,
        tools: info.tools,
        mcp_servers: [{ name: JOBGOBLIN_SERVER_NAME, status: info.mcpStatus }],
        model: identity.model,
        permissionMode: info.permissionMode,
      });
    },

    printToolUse(toolName, input) {
      toolUseCount += 1;
      printLine({
        type: "assistant",
        message: {
          id: `msg_fake_${toolUseCount}`,
          type: "message",
          role: "assistant",
          model: identity.model,
          content: [{ type: "tool_use", id: `toolu_fake_${toolUseCount}`, name: toolName, input }],
        },
        session_id: identity.sessionId,
      });
    },

    printResult(info) {
      printLine({
        type: "result",
        subtype: info.subtype,
        is_error: info.isError,
        result: info.result,
        num_turns: info.numTurns,
        session_id: identity.sessionId,
      });
    },
  };
}
