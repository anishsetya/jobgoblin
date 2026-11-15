// Story 14 (PRD S2): "When Claude Code doesn't install, I'm told what happened and what to do next."
// The fake claude plays a program that is missing (FAKE_CLAUDE_MODE=not-installed) or too old (outdated), and
// the install command always fails, so nothing is ever installed and winget never runs.
import { expect, test } from "../support/fixtures";
import { FAILING_INSTALLER } from "../support/server";

test.describe("As a first-time user, I'm told when Claude Code didn't install", () => {
  test("a failed install on the Connect step says what happened and shows the command to run myself", async ({ page, startServer }) => {
    const server = await startServer({
      seed: "none",
      fakeClaudeEnv: { FAKE_CLAUDE_MODE: "not-installed" },
      claudeInstallCommand: FAILING_INSTALLER,
    });
    await page.goto(server.url);
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Connect Claude" })).toBeVisible();
    await expect(page.getByText("Not installed", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Install Claude Code" }).click();

    const problem = page.getByRole("alert").filter({ hasText: "install" });
    await expect(problem).toContainText("The Claude Code install stopped with an error (code 1).");
    await expect(problem).toContainText("Press Install Claude Code to try again.");
    await expect(page.locator("code")).toContainText("process.exit(1)"); // the command is open, not folded away
    await expect(page.locator("code")).toBeVisible();
    await expect(page.getByRole("button", { name: "Install Claude Code" })).toBeEnabled(); // I can try again
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  test("a failed update in Settings says so in the same way", async ({ page, startServer }) => {
    const server = await startServer({
      seed: "alex-rivera",
      seedOptions: { usageNoticeSeen: true },
      fakeClaudeEnv: { FAKE_CLAUDE_MODE: "outdated" },
      claudeInstallCommand: FAILING_INSTALLER,
    });
    await page.goto(server.url);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
    const connection = page.getByRole("region", { name: "Claude connection" });
    await expect(connection.getByText("Needs an update", { exact: true })).toBeVisible();
    await expect(connection.getByText("Version 2.0.0")).toBeVisible();

    await connection.getByRole("button", { name: "Update Claude Code" }).click();

    const problem = connection.getByRole("alert");
    await expect(problem).toContainText("The Claude Code update stopped with an error (code 1).");
    await expect(problem).toContainText("Press Update Claude Code to try again.");
    await expect(connection.locator("code")).toBeVisible();
    await expect(connection.getByRole("button", { name: "Update Claude Code" })).toBeEnabled();
  });
});
