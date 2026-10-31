import { describe, expect, it } from "vitest";
import { checkInitEvent, parseStreamLine } from "./streamJson";
import type { InitEvent } from "./streamJson";

// The lines below have the exact shapes the fake claude prints (fixtures/fake-claude/src/streamJson.ts).
const FAKE_INIT_LINE = JSON.stringify({
  type: "system",
  subtype: "init",
  cwd: "C:\\runs\\run-1",
  session_id: "session-1",
  tools: ["mcp__jobgoblin__next_task", "mcp__jobgoblin__complete_task"],
  mcp_servers: [{ name: "jobgoblin", status: "connected" }],
  model: "haiku",
  permissionMode: "dontAsk",
});

const FAKE_TOOL_USE_LINE = JSON.stringify({
  type: "assistant",
  message: {
    id: "msg_fake_1",
    type: "message",
    role: "assistant",
    model: "haiku",
    content: [{ type: "tool_use", id: "toolu_fake_1", name: "mcp__jobgoblin__search_jobs", input: { limit: 10 } }],
  },
  session_id: "session-1",
});

const FAKE_RESULT_LINE = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "3 resumes tailored, 0 waiting for an answer, 0 failed.",
  num_turns: 7,
  session_id: "session-1",
});

function anInit(overrides: Partial<InitEvent> = {}): InitEvent {
  return {
    kind: "init",
    sessionId: "session-1",
    tools: ["mcp__jobgoblin__next_task"],
    mcpServers: [{ name: "jobgoblin", status: "connected" }],
    ...overrides,
  };
}

describe("parseStreamLine", () => {
  it("reads the init line: session id, tools and MCP servers", () => {
    expect(parseStreamLine(FAKE_INIT_LINE)).toEqual({
      kind: "init",
      sessionId: "session-1",
      tools: ["mcp__jobgoblin__next_task", "mcp__jobgoblin__complete_task"],
      mcpServers: [{ name: "jobgoblin", status: "connected" }],
    });
  });

  it("reads the tool names of an assistant line", () => {
    expect(parseStreamLine(FAKE_TOOL_USE_LINE)).toEqual({ kind: "tool-use", toolNames: ["mcp__jobgoblin__search_jobs"] });
  });

  it("reads every tool call of an assistant line that has several, and skips text blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Looking at two jobs." },
          { type: "tool_use", id: "a", name: "mcp__jobgoblin__get_job", input: {} },
          { type: "tool_use", id: "b", name: "mcp__jobgoblin__get_job", input: {} },
        ],
      },
    });

    expect(parseStreamLine(line)).toEqual({
      kind: "tool-use",
      toolNames: ["mcp__jobgoblin__get_job", "mcp__jobgoblin__get_job"],
    });
  });

  it("reads the result line", () => {
    expect(parseStreamLine(FAKE_RESULT_LINE)).toEqual({
      kind: "result",
      subtype: "success",
      isError: false,
      resultText: "3 resumes tailored, 0 waiting for an answer, 0 failed.",
      numTurns: 7,
      sessionId: "session-1",
    });
  });

  it("reads an error result, including one that has no result text", () => {
    const withText = parseStreamLine('{"type":"result","subtype":"success","is_error":true,"result":"Claude AI usage limit reached|1760000000"}');
    const withoutText = parseStreamLine('{"type":"result","subtype":"error_max_turns","is_error":true}');

    expect(withText).toMatchObject({ kind: "result", isError: true, resultText: "Claude AI usage limit reached|1760000000" });
    expect(withoutText).toMatchObject({ kind: "result", subtype: "error_max_turns", isError: true, resultText: "" });
  });

  it("accepts the extra fields the real Claude Code prints", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "abc",
      tools: ["mcp__jobgoblin__get_job"],
      mcp_servers: [{ name: "jobgoblin", status: "connected" }],
      slash_commands: ["compact"],
      apiKeySource: "none",
    });

    expect(parseStreamLine(line)).toMatchObject({ kind: "init", sessionId: "abc" });
  });

  it.each([
    ["an empty line", ""],
    ["a blank line", "   "],
    ["plain text", "Welcome to Claude Code"],
    ["half a JSON object", '{"type":"result","subtype":'],
    ["a JSON number", "42"],
    ["a JSON array", "[1,2,3]"],
    ["JSON null", "null"],
    ["a user line carrying a tool result", '{"type":"user","message":{"role":"user","content":[]}}'],
    ["a system line that is not init", '{"type":"system","subtype":"status","status":"compacting"}'],
    ["an assistant line with only text", '{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}'],
    ["an assistant line with no message", '{"type":"assistant"}'],
    ["an init line whose tools are not a list", '{"type":"system","subtype":"init","tools":"Bash"}'],
    ["a result line with a wrong field type", '{"type":"result","is_error":"yes"}'],
    ["an object with no type", '{"hello":"world"}'],
  ])("turns %s into an other event instead of throwing", (_description, line) => {
    expect(parseStreamLine(line)).toEqual({ kind: "other" });
  });
});

describe("checkInitEvent", () => {
  const ALLOWED = ["mcp__jobgoblin__next_task", "mcp__jobgoblin__complete_task"];

  it("accepts a run whose tools are all allowed and whose jobgoblin server is connected", () => {
    expect(checkInitEvent(anInit(), ALLOWED)).toBeNull();
  });

  it("accepts a run that has fewer tools than it was allowed", () => {
    expect(checkInitEvent(anInit({ tools: [] }), ALLOWED)).toBeNull();
  });

  it("rejects a run that lists Bash", () => {
    const reason = checkInitEvent(anInit({ tools: ["mcp__jobgoblin__next_task", "Bash"] }), ALLOWED);

    expect(reason).toContain("Bash");
  });

  it.each(["PowerShell", "Read", "Edit", "Write", "mcp__other__tool"])("rejects a run that lists %s", (tool) => {
    expect(checkInitEvent(anInit({ tools: [tool] }), ALLOWED)).toContain(tool);
  });

  it("names every unexpected tool in the reason", () => {
    const reason = checkInitEvent(anInit({ tools: ["Bash", "Write"] }), ALLOWED);

    expect(reason).toContain("Bash");
    expect(reason).toContain("Write");
  });

  it("matches a domain rule such as WebFetch(domain:...) to the tool name WebFetch, in either direction", () => {
    const allowed = ["WebSearch", "WebFetch(domain:jobs.lever.co)", "Agent"];

    expect(checkInitEvent(anInit({ tools: ["WebSearch", "WebFetch", "Agent"] }), allowed)).toBeNull();
    expect(checkInitEvent(anInit({ tools: ["WebFetch(domain:jobs.lever.co)"] }), allowed)).toBeNull();
    expect(checkInitEvent(anInit({ tools: ["Task"] }), allowed)).toContain("Task");
  });

  it("rejects a run whose jobgoblin server is not connected", () => {
    const reason = checkInitEvent(anInit({ mcpServers: [{ name: "jobgoblin", status: "failed" }] }), ALLOWED);

    expect(reason).toContain("failed");
  });

  it("rejects a run with no jobgoblin server at all, even when another server is connected", () => {
    const reason = checkInitEvent(anInit({ mcpServers: [{ name: "other", status: "connected" }] }), ALLOWED);

    expect(reason).toContain("missing");
  });
});
