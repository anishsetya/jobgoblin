import { describe, expect, it } from "vitest";
import { parseArguments, UsageError } from "./arguments";
import type { PrintOptions } from "./arguments";

// The flags the runner passes (ARCHITECTURE.md section 10, step 4), in the order it passes them.
const RUNNER_ARGUMENTS = [
  "-p",
  "--output-format", "stream-json",
  "--verbose",
  "--model", "haiku",
  "--mcp-config", "mcp.json",
  "--strict-mcp-config",
  "--tools", "",
  "--allowedTools", "mcp__jobgoblin__next_task", "mcp__jobgoblin__complete_task",
  "--setting-sources", "project",
  "--permission-mode", "dontAsk",
  "--max-turns", "80",
];

function printOptionsOf(args: string[]): PrintOptions {
  const { command } = parseArguments(args);
  if (command.kind !== "print") throw new Error(`Expected a print command, got ${command.kind}`);
  return command.options;
}

describe("parsing the command line", () => {
  it("reads every flag the runner passes", () => {
    expect(printOptionsOf(RUNNER_ARGUMENTS)).toEqual({
      outputFormat: "stream-json",
      verbose: true,
      model: "haiku",
      mcpConfigPath: "mcp.json",
      strictMcpConfig: true,
      tools: [],
      allowedTools: ["mcp__jobgoblin__next_task", "mcp__jobgoblin__complete_task"],
      settingSources: "project",
      permissionMode: "dontAsk",
      maxTurns: 80,
    });
  });

  it("treats --tools with an empty string as 'no built-in tools', and leaves --tools unset as null", () => {
    expect(printOptionsOf(["-p", "--tools", ""]).tools).toEqual([]);
    expect(printOptionsOf(["-p"]).tools).toBeNull();
  });

  it("accepts a comma-separated tool list as well as separate arguments", () => {
    const options = printOptionsOf(["-p", "--allowedTools", "WebSearch,Agent", "WebFetch(domain:boards.greenhouse.io)"]);

    expect(options.allowedTools).toEqual(["WebSearch", "Agent", "WebFetch(domain:boards.greenhouse.io)"]);
  });

  it("accepts --flag=value", () => {
    const options = printOptionsOf(["-p", "--max-turns=5", "--model=sonnet"]);

    expect(options.maxTurns).toBe(5);
    expect(options.model).toBe("sonnet");
  });

  it("ignores unknown flags with a note, and keeps going", () => {
    const { command, notes } = parseArguments(["-p", "--some-future-flag", "--model", "opus"]);

    expect(notes).toEqual(["ignoring unknown flag --some-future-flag"]);
    expect(command).toMatchObject({ kind: "print", options: { model: "opus" } });
  });

  it("ignores a prompt given as an argument, because the playbook is on stdin", () => {
    const { notes } = parseArguments(["-p", "do the thing"]);

    expect(notes).toEqual(['ignoring the argument "do the thing"']);
  });

  it("recognises --version and the auth commands", () => {
    expect(parseArguments(["--version"]).command).toEqual({ kind: "version" });
    expect(parseArguments(["auth", "status"]).command).toEqual({ kind: "auth", action: "status" });
    expect(parseArguments(["auth", "login"]).command).toEqual({ kind: "auth", action: "login" });
  });

  it("does not support starting the interactive screen", () => {
    expect(parseArguments([]).command).toEqual({ kind: "unsupported" });
  });

  it("refuses a flag that is missing its value, or a --max-turns that is not a number", () => {
    expect(() => parseArguments(["-p", "--model"])).toThrow(UsageError);
    expect(() => parseArguments(["-p", "--max-turns", "many"])).toThrow(UsageError);
    expect(() => parseArguments(["-p", "--max-turns", "0"])).toThrow(UsageError);
  });
});
