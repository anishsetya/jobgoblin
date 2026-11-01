// The commands the "Connect Claude" screen runs: --version, auth status and auth login.
import { beforeAll, describe, expect, it } from "vitest";
import { assertBuiltCliIsCurrent } from "./builtCli";
import { runFakeClaudeCommand } from "./runFakeClaude";

describe("the fake claude's version and sign-in commands", () => {
  beforeAll(assertBuiltCliIsCurrent);

  it("prints the version the runner accepts", async () => {
    const outcome = await runFakeClaudeCommand(["--version"]);

    expect(outcome.stdout.trim()).toBe("2.1.99 (Claude Code)");
    expect(outcome.exitCode).toBe(0);
  });

  it("reports a signed-in Claude plan from auth status", async () => {
    const outcome = await runFakeClaudeCommand(["auth", "status"]);

    expect(JSON.parse(outcome.stdout)).toEqual({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro" });
    expect(outcome.exitCode).toBe(0);
  });

  it("reports signed out, with exit code 1, when FAKE_CLAUDE_MODE is signed-out", async () => {
    const outcome = await runFakeClaudeCommand(["auth", "status"], { FAKE_CLAUDE_MODE: "signed-out" });

    expect(JSON.parse(outcome.stdout)).toMatchObject({ loggedIn: false });
    expect(outcome.exitCode).toBe(1);
  });

  it("accepts auth login without doing anything", async () => {
    const outcome = await runFakeClaudeCommand(["auth", "login"]);

    expect(outcome.exitCode).toBe(0);
  });

  it("refuses an auth command it does not know", async () => {
    const outcome = await runFakeClaudeCommand(["auth", "logout"]);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain("auth status");
  });

  it("refuses to start the interactive screen", async () => {
    const outcome = await runFakeClaudeCommand([]);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain("only `-p`");
  });

  it("stops with a clear message when FAKE_CLAUDE_MODE is a typo", async () => {
    const outcome = await runFakeClaudeCommand(["auth", "status"], { FAKE_CLAUDE_MODE: "signedout" });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain("FAKE_CLAUDE_MODE must be one of");
  });
});
