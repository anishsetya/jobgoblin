// /api/claude/status and /sign-in, answered by the real fake claude (build it first:
// pnpm --filter @jobgoblin/fake-claude build). The Claude command is read when the app is made, so the fake's
// FAKE_CLAUDE_MODE is set before createTestApp.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeStatus } from "@jobgoblin/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { REPOSITORY_ROOT } from "../../runner/testSupport";
import { closeTestContexts, createTestApp } from "../testSupport";

const FAKE_CLAUDE_COMMAND = [process.execPath, path.join(REPOSITORY_ROOT, "fixtures", "fake-claude", "dist", "cli.mjs")];

afterEach(() => {
  delete process.env.FAKE_CLAUDE_MODE;
  closeTestContexts();
});

async function statusFrom(claudeCommand: string[]): Promise<ClaudeStatus> {
  if (!fs.existsSync(FAKE_CLAUDE_COMMAND[1] ?? "")) throw new Error("The fake claude is not built. Run: pnpm --filter @jobgoblin/fake-claude build");
  const { call } = createTestApp({ claudeCommand });
  const response = await call("/api/claude/status");
  expect(response.status).toBe(200);
  return ClaudeStatus.parse(await response.json());
}

describe("GET /api/claude/status", () => {
  it("says connected, with the version and plan, when Claude Code is signed in", async () => {
    const status = await statusFrom(FAKE_CLAUDE_COMMAND);

    expect(status).toMatchObject({ state: "connected", version: "2.1.99", plan: "pro" });
  });

  it("says signed-out when Claude Code is installed but not signed in", async () => {
    process.env.FAKE_CLAUDE_MODE = "signed-out";

    const status = await statusFrom(FAKE_CLAUDE_COMMAND);

    expect(status).toMatchObject({ state: "signed-out", signInCommand: "claude auth login" });
  });

  it("says not-installed when the program is not where the start option says", async () => {
    const missing = path.join(os.tmpdir(), "jobgoblin-no-such-folder", process.platform === "win32" ? "claude.exe" : "claude");

    const status = await statusFrom([missing]);

    expect(status.state).toBe("not-installed");
  });
});

describe("POST /api/claude/sign-in", () => {
  it("answers with the status after sign-in and starts a queue that was paused", async () => {
    const { ctx, call } = createTestApp({ claudeCommand: FAKE_CLAUDE_COMMAND });
    let resumed = 0;
    ctx.launcher = { wake: () => undefined, cancel: async () => undefined, resume: () => (resumed += 1) };

    const response = await call("/api/claude/sign-in", { method: "POST" });

    expect(ClaudeStatus.parse(await response.json()).state).toBe("connected");
    expect(resumed).toBe(1);
  });
});
