import { describe, expect, it } from "vitest";
import { MCP_TOOL_NAMES } from "@jobgoblin/schemas";
import { STEP_CHECKING_JOB_BOARDS, stepForTool } from "./stepText";

describe("stepForTool", () => {
  it("describes checking a draft in plain words", () => {
    expect(stepForTool("submit_resume_draft")).toBe("Checking every bullet against your profile");
  });

  it("has a line for every MCP tool, none of them a tool name", () => {
    for (const toolName of MCP_TOOL_NAMES) {
      const step = stepForTool(toolName);

      expect(step).not.toBe(stepForTool("not_a_tool"));
      expect(step).not.toContain("_");
      expect(step).toMatch(/^[A-Z]/);
    }
  });

  it("understands the name Claude Code reports for a tool", () => {
    expect(stepForTool("mcp__jobgoblin__record_fit")).toBe(stepForTool("record_fit"));
  });

  it("falls back to a neutral line for a tool it does not know, including names that exist on every object", () => {
    expect(stepForTool("something_new")).toBe("Working on it");
    expect(stepForTool("toString")).toBe("Working on it");
  });

  it("has a line for the job board check that runs before a hunt", () => {
    expect(STEP_CHECKING_JOB_BOARDS).toBe("Checking job boards");
  });
});
