import { RUN_KIND_SETTINGS, RUN_KIND_TOOLS, RunKind } from "@jobgoblin/schemas";
import { describe, expect, it } from "vitest";
import { allowedToolsFor, buildClaudeArgs, JOB_BOARD_DOMAINS } from "./claudeArgs";

const NEVER_AVAILABLE = ["Bash", "PowerShell", "Read", "Edit", "Write"];

// The built-in tools (--tools) each run kind gets: only a hunt searches the web and starts the screener.
const BUILT_IN_TOOLS: Record<RunKind, string[]> = {
  setup: [],
  hunt: ["WebSearch", "WebFetch", "Agent"],
  paste: [],
  tailor: [],
  answers: [],
  ask: [],
};

function argsForKind(kind: RunKind, model = RUN_KIND_SETTINGS[kind].model): string[] {
  return buildClaudeArgs({ kind, model }, RUN_KIND_SETTINGS[kind]);
}

// The value after a flag, such as the list after --allowedTools.
function valueOf(args: string[], flag: string): string {
  const flagAt = args.indexOf(flag);
  const value = args[flagAt + 1];
  if (flagAt === -1 || value === undefined) throw new Error(`${flag} is missing from ${args.join(" ")}`);
  return value;
}

function listOf(args: string[], flag: string): string[] {
  return valueOf(args, flag).split(",").filter((entry) => entry !== "");
}

describe("buildClaudeArgs", () => {
  it("seals every run kind: strict MCP config, project settings only, dontAsk", () => {
    for (const kind of RunKind.options) {
      const args = argsForKind(kind);

      expect(args[0], kind).toBe("-p");
      expect(valueOf(args, "--output-format"), kind).toBe("stream-json");
      expect(args, kind).toContain("--verbose");
      expect(args, kind).toContain("--strict-mcp-config");
      expect(valueOf(args, "--mcp-config"), kind).toBe("mcp.json");
      expect(valueOf(args, "--setting-sources"), kind).toBe("project");
      expect(valueOf(args, "--permission-mode"), kind).toBe("dontAsk");
      expect(valueOf(args, "--max-turns"), kind).toBe(String(RUN_KIND_SETTINGS[kind].maxTurns));
    }
  });

  it("never offers or allows Bash, PowerShell, Read, Edit or Write in any run kind", () => {
    for (const kind of RunKind.options) {
      const args = argsForKind(kind);

      const everyListedTool = [...listOf(args, "--tools"), ...listOf(args, "--allowedTools")];
      const toolNames = everyListedTool.map((entry) => entry.split("(")[0]);
      for (const forbidden of NEVER_AVAILABLE) {
        expect(toolNames, `${kind} run lists ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("gives each run kind its own built-in tools and exactly the MCP tools listed for it", () => {
    for (const kind of RunKind.options) {
      const args = argsForKind(kind);
      const allowed = listOf(args, "--allowedTools");

      expect(listOf(args, "--tools"), `${kind} built-in tools`).toEqual(BUILT_IN_TOOLS[kind]);
      expect(allowed.filter((tool) => tool.startsWith("mcp__")), `${kind} MCP tools`).toEqual(
        RUN_KIND_TOOLS[kind].map((tool) => `mcp__jobgoblin__${tool}`),
      );
      if (BUILT_IN_TOOLS[kind].length === 0) {
        expect(allowed.every((tool) => tool.startsWith("mcp__jobgoblin__")), `${kind} allows only Jobgoblin tools`).toBe(true);
      }
    }
  });
  it("gives a hunt run WebSearch, WebFetch and Agent as tools, but fetches only from job-board domains", () => {
    const args = argsForKind("hunt");
    const allowed = listOf(args, "--allowedTools");

    expect(listOf(args, "--tools")).toEqual(["WebSearch", "WebFetch", "Agent"]);
    expect(allowed).toContain("WebSearch");
    expect(allowed).toContain("Agent");
    // A bare WebFetch rule would allow every site, so only the domain rules may be present.
    expect(allowed).not.toContain("WebFetch");
    const fetchRules = allowed.filter((tool) => tool.startsWith("WebFetch("));
    expect(fetchRules).toEqual(JOB_BOARD_DOMAINS.map((domain) => `WebFetch(domain:${domain})`));
  });

  it("uses the model the run was queued with, so a tailor retry can run on sonnet", () => {
    const retry = buildClaudeArgs({ kind: "tailor", model: "sonnet" }, RUN_KIND_SETTINGS.tailor);

    expect(valueOf(retry, "--model")).toBe("sonnet");
    expect(valueOf(argsForKind("tailor"), "--model")).toBe("haiku");
    expect(valueOf(argsForKind("hunt"), "--model")).toBe("sonnet");
  });

  it("holds each flag and its value as separate arguments, with no shell quoting", () => {
    const args = argsForKind("ask");

    expect(args.some((argument) => argument.includes('"'))).toBe(false);
    expect(args[args.indexOf("--tools") + 1]).toBe("");
  });
});

describe("allowedToolsFor", () => {
  it("lists the MCP tools first and then the built-in rules, the way the init check compares them", () => {
    const allowed = allowedToolsFor("hunt", RUN_KIND_SETTINGS.hunt);

    expect(allowed[0]).toBe("mcp__jobgoblin__get_profile");
    expect(allowed.indexOf("WebSearch")).toBeGreaterThan(allowed.indexOf("mcp__jobgoblin__record_fit"));
  });
});

describe("JOB_BOARD_DOMAINS", () => {
  it("holds plain host names only: no wildcards, schemes, paths or duplicates", () => {
    for (const domain of JOB_BOARD_DOMAINS) {
      expect(domain).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/);
    }
    expect(new Set(JOB_BOARD_DOMAINS).size).toBe(JOB_BOARD_DOMAINS.length);
  });
});
