// Story 9 (PRD R1, R3, R4 and S2/S3): "When a run does not go well, I am told in plain words what happened and
// what I can do about it."
// Each outcome is made by one switch of the fake claude: slow (so there is time to cancel), usage-limit and
// signed-out. The runner turns each into a status the run card explains (ARCHITECTURE.md section 10, outcomes).
import { expect, test } from "../support/fixtures";

const SEEDED = { seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } } as const;

test.describe("As a job seeker, I understand why a run stopped", () => {
  test("I can cancel a run that is taking long, and the card says it was cancelled", async ({ page, startServer }) => {
    const server = await startServer({ ...SEEDED, fakeClaudeEnv: { FAKE_CLAUDE_MODE: "slow" } });
    await page.goto(server.url);
    await page.getByRole("button", { name: "Find jobs" }).click();

    const runCard = page.getByTestId("run-card").filter({ hasText: "Finding jobs" });
    await test.step("the run is going, so Cancel is offered and Find jobs is not available twice", async () => {
      await expect(runCard.getByRole("button", { name: "Cancel: Finding jobs" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Find jobs" })).toBeDisabled();
    });

    await test.step("Cancel stops it, and the card says Cancelled with a way to dismiss it", async () => {
      await runCard.getByRole("button", { name: "Cancel: Finding jobs" }).click();
      await expect(runCard.getByRole("status")).toHaveText(/cancel/i);
      await expect(runCard.getByRole("button", { name: "Cancel: Finding jobs" })).toHaveCount(0);
      await expect(runCard.getByRole("button", { name: "Dismiss: Finding jobs" })).toBeVisible();
    });

    await test.step("nothing was tailored from a cancelled run, and I can start again", async () => {
      await expect(page.getByRole("button", { name: "Find jobs" })).toBeEnabled();
      await expect(page.getByTestId("run-card").filter({ hasText: "Tailoring resumes" })).toHaveCount(0);
      const rows = await server.api<unknown[]>("/api/pipeline");
      expect(rows.filter((row) => (row as { status: string }).status === "Awaiting approval")).toHaveLength(0);
    });

    await test.step("Dismiss clears the card from Today", async () => {
      await runCard.getByRole("button", { name: "Dismiss: Finding jobs" }).click();
      await expect(runCard).toHaveCount(0);
    });
  });

  test("when my Claude plan limit is reached, I am told so and can try again", async ({ page, startServer }) => {
    const server = await startServer({ ...SEEDED, fakeClaudeEnv: { FAKE_CLAUDE_MODE: "usage-limit" } });
    await page.goto(server.url);
    await page.getByRole("button", { name: "Find jobs" }).click();

    const runCard = page.getByTestId("run-card").filter({ hasText: "Finding jobs" });
    await test.step("the card says it in plain words, not as an error code", async () => {
      await expect(runCard.getByRole("status")).toContainText("Your Claude plan limit is reached");
      await expect(runCard.getByRole("status")).toContainText("It resets at");
      await expect(runCard).not.toContainText(/usage limit reached\||is_error|exit code/i);
    });

    await test.step("it also appears in Needs you as something that needs attention", async () => {
      const attention = page.getByRole("region", { name: "Needs you" }).getByTestId("needs-you-item").filter({ hasText: "Needs attention" });
      await expect(attention).toContainText("Your Claude plan limit is reached");
    });

    await test.step("Try again starts a new run (here the limit is still reached, so it says so again)", async () => {
      await runCard.getByRole("button", { name: "Try again: Finding jobs" }).click();
      await expect(page.getByTestId("run-card").filter({ hasText: "Finding jobs" }).getByRole("status")).toContainText(
        "Your Claude plan limit is reached",
      );
      const runs = (await server.api<{ running: { id: string }[] }>("/api/today")).running;
      expect(runs.length).toBeGreaterThanOrEqual(1);
    });
  });

  test("when Claude is signed out, Settings says sign-in is needed and offers the way to do it", async ({ page, startServer }) => {
    const server = await startServer({ ...SEEDED, fakeClaudeEnv: { FAKE_CLAUDE_MODE: "signed-out" } });
    await page.goto(server.url);

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
    const connection = page.getByRole("region", { name: "Claude connection" });

    await expect(connection.getByText("Not signed in")).toBeVisible();
    await expect(connection).toContainText("Sign in with your Claude account");
    await expect(connection.getByRole("button", { name: "Sign in with Claude" })).toBeEnabled();
    await expect(connection.getByRole("button", { name: "Check again" })).toBeVisible();

    await test.step("the person can see exactly what the button will run, before pressing it", async () => {
      await connection.getByText("See exactly what this does").click();
      await expect(connection).toContainText("Jobgoblin will run this on your computer:");
      await expect(connection.locator("code")).toContainText("auth login");
    });

    await test.step("a run started now is blocked with a request to sign in again, not a crash", async () => {
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Today" }).click();
      await page.getByRole("button", { name: "Find jobs" }).click();
      const runCard = page.getByTestId("run-card").filter({ hasText: "Finding jobs" });
      await expect(runCard.getByRole("status")).toContainText(/sign in/i);
      await expect(runCard.getByRole("button", { name: "Try again: Finding jobs" })).toBeVisible();
    });
  });
});
