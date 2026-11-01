// Story 10 (PRD R4, ARCHITECTURE.md section 10 "Recovery"): "If Jobgoblin dies in the middle of a run, nothing is
// lost and nothing keeps running behind my back. When I open it again it tells me the run was interrupted and
// lets me try again."
// The server process is killed the hard way (no shutdown message, no cleanup), which leaves the Claude process
// it started behind. The new server on the SAME app data folder must stop that process if it is still alive and
// mark the run. (The fake also gives up by itself at its next call to the dead server, so the test checks the end
// state: no Claude process anywhere, whichever of the two ended it.)
import { expect, test } from "../support/fixtures";
import { isProcessAlive, runningFakeClaudeProcesses } from "../support/processes";

type TodayRun = { id: string; status: string; pid: number | null };

test.describe("As a job seeker, a crash does not leave anything running or lost", () => {
  test("the interrupted run is explained, the Claude process is gone, and Try again works", async ({ page, startServer }) => {
    const first = await startServer({
      seed: "alex-rivera",
      seedOptions: { usageNoticeSeen: true },
      fakeClaudeEnv: { FAKE_CLAUDE_MODE: "slow" },
    });
    await page.goto(first.url);
    await page.getByRole("button", { name: "Find jobs" }).click();

    let claudePid = 0;
    await test.step("a slow hunt is under way, with a Claude process behind it", async () => {
      await expect(page.getByTestId("run-card").filter({ hasText: "Finding jobs" }).getByRole("button", { name: /^Cancel/ })).toBeVisible();
      await expect
        .poll(async () => (await first.api<{ running: TodayRun[] }>("/api/today")).running.find((run) => run.pid !== null)?.pid ?? 0)
        .toBeGreaterThan(0);
      claudePid = (await first.api<{ running: TodayRun[] }>("/api/today")).running.find((run) => run.pid !== null)?.pid ?? 0;
      expect(isProcessAlive(claudePid)).toBe(true);
    });

    await test.step("the server is killed with no warning", async () => {
      await first.crash();
    });

    // The new server has no slow switch, so Try again can finish. Same folders, a new port and a new key.
    const second = await startServer({ reuseDataOf: first });

    await test.step("the Claude process the crash left behind is stopped", async () => {
      await expect.poll(() => isProcessAlive(claudePid), { timeout: 20_000 }).toBe(false);
      await expect.poll(() => runningFakeClaudeProcesses(), { timeout: 20_000 }).toEqual([]);
    });

    await test.step("Today says the run was interrupted and offers Try again", async () => {
      await page.goto(second.url);
      const runCard = page.getByTestId("run-card").filter({ hasText: "Finding jobs" });
      await expect(runCard.getByRole("status")).toHaveText("This run was interrupted");
      await expect(runCard.getByRole("button", { name: "Try again: Finding jobs" })).toBeVisible();

      const attention = page.getByRole("region", { name: "Needs you" }).getByTestId("needs-you-item").filter({ hasText: "Needs attention" });
      await expect(attention).toContainText("This run was interrupted");
    });

    await test.step("my setup survived the crash: I am not sent back to the wizard", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Welcome to Jobgoblin" })).toHaveCount(0);
    });

    await test.step("Try again runs the hunt to the end", async () => {
      await page.getByTestId("run-card").filter({ hasText: "Finding jobs" }).getByRole("button", { name: "Try again: Finding jobs" }).click();
      const review = page.getByRole("region", { name: "Needs you" }).getByTestId("needs-you-item").filter({ hasText: "Ready to review" });
      await expect(review).toHaveCount(2, { timeout: 60_000 });
    });
  });
});
