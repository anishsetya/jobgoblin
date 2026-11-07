// Phase 4, checklist check 1 only: the Connect step and Settings with the real claude.exe. Starts NO model run
// (it only makes the server run `claude --version` and `claude auth status`).
import path from "node:path";
import { test, expect } from "./auditFixtures";
import { startTestServer } from "../support/server";
import { progress, REAL_DIR, writeReal } from "./realHelpers";

test("R0 check 1: Connected and the plan name, no model run", async ({ page }) => {
  test.setTimeout(120_000);
  for (const name of Object.keys(process.env)) if (name === "CLAUDECODE" || name.startsWith("CLAUDE_CODE_")) delete process.env[name];
  const server = await startTestServer({ seed: "none", fakeClaudeEnv: { JOBGOBLIN_CLAUDE_COMMAND: JSON.stringify(["<home>\\.local\\bin\\claude.exe"]) } });
  try {
    progress("check-1 spec: server started, NO model run will be started");
    await page.goto(server.url);
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Connect Claude" })).toBeVisible();
    await expect(page.getByText("Loading...")).toHaveCount(0, { timeout: 30_000 });
    writeReal("text/wizard-2-connect-loaded.txt", await page.locator("main").innerText());
    await page.screenshot({ path: path.join(REAL_DIR, "screens", "wizard-2-connect-loaded.png"), fullPage: true });
    writeReal("claude-status-api.json", await server.api("/api/claude/status").catch(async () => server.api("/api/status")));
    await page.goto(`${server.origin}/settings`);
    await expect(page.getByText("Loading...")).toHaveCount(0, { timeout: 30_000 });
    writeReal("text/settings-loaded.txt", await page.locator("main").innerText());
    await page.screenshot({ path: path.join(REAL_DIR, "screens", "settings-loaded.png"), fullPage: true });
  } finally {
    await server.stop();
  }
});
