// Story 9 (PRD R1, R2, R3, R4 and S2/S3): "When a run does not go well, I am told in plain words what happened and
// what I can do about it."
// Each outcome is made by one switch of the fake claude: slow (so there is time to cancel), usage-limit,
// signed-out, crash, max-turns and extra-tools. The runner turns each into a status the run card explains
// (ARCHITECTURE.md section 10, outcomes), and Needs you offers the one step that helps.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";

const SEEDED = { seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } } as const;

type TodayJson = { running: { id: string; kind: string; status: string; retryOf: string | null }[] };

async function huntsOnToday(server: { api<T>(path: string): Promise<T> }): Promise<TodayJson["running"]> {
  return (await server.api<TodayJson>("/api/today")).running.filter((run) => run.kind === "hunt");
}

// A run's card, by its name (the card's label), so a card that only mentions the run is never matched.
function runCard(page: Page, runTitle: string): Locator {
  return page.getByRole("article", { name: runTitle });
}

// The Needs you item for a run that stopped.
function attentionItem(page: Page, runTitle: string): Locator {
  return page
    .getByRole("region", { name: "Needs you" })
    .getByTestId("needs-you-item")
    .filter({ hasText: "Needs attention" })
    .filter({ has: page.getByRole("heading", { name: runTitle, exact: true }) });
}

// Items for strong matches that have no resume and that nothing is working on.
function noResumeYetItems(page: Page): Locator {
  return page.getByRole("region", { name: "Needs you" }).getByTestId("needs-you-item").filter({ hasText: "No resume yet" });
}

async function addTheGridlineJob(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Add a job" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a job" });
  await dialog.getByLabel("Link to the job").fill("https://boards.greenhouse.io/gridline/jobs/4100");
  await dialog.getByRole("button", { name: "Add job" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("As a job seeker, I understand why a run stopped", () => {
  test("I can cancel a run that is taking long, and the card says it was cancelled", async ({ page, startServer }) => {
    const server = await startServer({ ...SEEDED, fakeClaudeEnv: { FAKE_CLAUDE_MODE: "slow" } });
    await page.goto(server.url);
    await page.getByRole("button", { name: "Find jobs" }).click();

    const card = page.getByTestId("run-card").filter({ hasText: "Finding jobs" });
    await test.step("the run is going, so Cancel is offered and Find jobs is not available twice", async () => {
      await expect(card.getByRole("button", { name: "Cancel: Finding jobs" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Find jobs" })).toBeDisabled();
    });

    await test.step("Cancel stops it, and the card says Cancelled with a way to dismiss it", async () => {
      await card.getByRole("button", { name: "Cancel: Finding jobs" }).click();
      await expect(card.getByRole("status")).toHaveText(/cancel/i);
      await expect(card.getByRole("button", { name: "Cancel: Finding jobs" })).toHaveCount(0);
      await expect(card.getByRole("button", { name: "Dismiss: Finding jobs" })).toBeVisible();
    });

    await test.step("nothing was tailored from a cancelled run, and I can start again", async () => {
      await expect(page.getByRole("button", { name: "Find jobs" })).toBeEnabled();
      await expect(card.getByRole("button", { name: "Try again: Finding jobs" })).toBeVisible();
      await expect(page.getByTestId("run-card").filter({ hasText: "Tailoring resumes" })).toHaveCount(0);
      const rows = await server.api<unknown[]>("/api/pipeline");
      expect(rows.filter((row) => (row as { status: string }).status === "Awaiting approval")).toHaveLength(0);
    });

    await test.step("Dismiss clears the card from Today", async () => {
      await card.getByRole("button", { name: "Dismiss: Finding jobs" }).click();
      await expect(card).toHaveCount(0);
    });
  });

  test("after I cancel tailoring, Today keeps the jobs left without a resume, and Try again picks them up", async ({ page, startServer }) => {
    const server = await startServer({ ...SEEDED, fakeClaudeEnv: { FAKE_CLAUDE_MODE: "slow" } });
    await page.goto(server.url);
    await page.getByRole("button", { name: "Find jobs" }).click();

    const tailoring = runCard(page, "Tailoring resumes");
    await test.step("I cancel the tailoring that follows the search", async () => {
      await tailoring.getByRole("button", { name: "Cancel: Tailoring resumes" }).click({ timeout: 100_000 });
      await expect(tailoring.getByRole("status")).toHaveText(/cancel/i);
    });

    await test.step("the strong matches without a resume stay on Today, each with a way to make one", async () => {
      await expect(noResumeYetItems(page)).not.toHaveCount(0);
      await expect(noResumeYetItems(page).first().getByRole("link", { name: "See details" })).toBeVisible();
    });

    await test.step("Try again on the cancelled card picks them all up in one step", async () => {
      await tailoring.getByRole("button", { name: "Try again: Tailoring resumes" }).click();
      await expect(noResumeYetItems(page)).toHaveCount(0);
      await expect(tailoring.getByRole("button", { name: "Cancel: Tailoring resumes" })).toBeVisible();
      const tailorRuns = (await server.api<TodayJson>("/api/today")).running.filter((run) => run.kind === "tailor");
      expect(tailorRuns).toMatchObject([{ retryOf: expect.any(String) }]);
    });
  });

  test("when my Claude plan limit is reached, I am told when it resets and can try again", async ({ page, startServer }) => {
    const server = await startServer({ ...SEEDED, fakeClaudeEnv: { FAKE_CLAUDE_MODE: "usage-limit" } });
    await page.goto(server.url);
    await page.getByRole("button", { name: "Find jobs" }).click();

    const card = runCard(page, "Finding jobs");
    await test.step("the card says it in plain words, not as an error code", async () => {
      await expect(card.getByRole("status")).toContainText("Your Claude plan limit is reached");
      await expect(card.getByRole("status")).toContainText("It resets at");
      await expect(card).not.toContainText(/usage limit reached\||is_error|exit code/i);
    });

    await test.step("Needs you offers Try again, because Settings can't lift a plan limit", async () => {
      const attention = attentionItem(page, "Finding jobs");
      await expect(attention).toContainText("Your Claude plan limit is reached");
      await expect(attention.getByRole("button", { name: "Try again: Finding jobs" })).toBeVisible();
      await expect(attention.getByRole("link", { name: "Check settings" })).toHaveCount(0);
    });

    await test.step("pressing Find jobs again tries the same search again, so no second search waits behind it", async () => {
      await page.getByRole("button", { name: "Find jobs" }).click();
      await expect.poll(() => huntsOnToday(server)).toMatchObject([{ status: "blocked", retryOf: expect.any(String) }]);
      await expect(card).toHaveCount(1);
      await expect(card.getByRole("status")).toContainText("Your Claude plan limit is reached");
    });

    await test.step("Try again starts a new run (here the limit is still reached, so it says so again)", async () => {
      const [tried] = await huntsOnToday(server);
      await card.getByRole("button", { name: "Try again: Finding jobs" }).click();
      await expect.poll(() => huntsOnToday(server)).toMatchObject([{ status: "blocked", retryOf: tried?.id }]);
      await expect(card).toHaveCount(1);
      await expect(card.getByRole("status")).toContainText("Your Claude plan limit is reached");
    });
  });

  test("a run started while a plan limit holds the queue says what it waits for, and goes once I try again", async ({ page, startServer }) => {
    const server = await startServer({ ...SEEDED, fakeClaudeEnv: { FAKE_CLAUDE_MODE: "usage-limit" } });
    await page.goto(server.url);
    await page.getByRole("button", { name: "Find jobs" }).click();
    await expect(runCard(page, "Finding jobs").getByRole("status")).toContainText("Your Claude plan limit is reached");

    const pasteCard = runCard(page, "Reading a job you added");
    await test.step("a job I add waits, and its card says for what, with no moving bar", async () => {
      await addTheGridlineJob(page);
      await expect(pasteCard.getByRole("status")).toHaveText(
        /^Waiting for Finding jobs, which stopped: Your Claude plan limit is reached\. It resets .+\. Try that run again to go on\.$/,
      );
      await expect(pasteCard.getByRole("progressbar")).toHaveCount(0);
    });

    await test.step("Try again in Needs you lets the queue go on: the job's run says the limit itself, and the search is tried too", async () => {
      await attentionItem(page, "Finding jobs").getByRole("button", { name: "Try again: Finding jobs" }).click();
      await expect(pasteCard.getByRole("status")).toHaveText(/^Your Claude plan limit is reached\. It resets /);
      await expect(
        attentionItem(page, "Reading a job you added").getByRole("button", { name: "Try again: Reading a job you added" }),
      ).toBeVisible();
      // The search I asked for again is tried, not left waiting behind the job's run.
      await expect.poll(() => huntsOnToday(server)).toMatchObject([{ status: "blocked", retryOf: expect.any(String) }]);
      await expect(page.getByTestId("run-card").filter({ hasText: "Waiting for" })).toHaveCount(0);
    });
  });

  for (const [mode, message] of [
    ["crash", "This run stopped before finishing"],
    ["max-turns", "This run stopped before finishing"],
    ["extra-tools", "This run was stopped for safety"],
  ] as const) {
    test(`when a run ends with ${mode}, Needs you says so and offers Try again, not Settings`, async ({ page, startServer }) => {
      const server = await startServer({ ...SEEDED, fakeClaudeEnv: { FAKE_CLAUDE_MODE: mode } });
      await page.goto(server.url);
      await page.getByRole("button", { name: "Find jobs" }).click();

      const attention = attentionItem(page, "Finding jobs");
      await expect(attention).toContainText(message);
      await expect(attention.getByRole("link", { name: "Check settings" })).toHaveCount(0);

      await attention.getByRole("button", { name: "Try again: Finding jobs" }).click();
      // A retry is a new run: it stops the same way here, and its own item replaces the old one.
      await expect.poll(async () => (await server.api<TodayJson>("/api/today")).running.some((run) => run.kind === "hunt" && run.retryOf !== null)).toBe(true);
      await expect(attention).toContainText(message);
      await expect(attention).toHaveCount(1);
    });
  }

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
      const card = runCard(page, "Finding jobs");
      await expect(card.getByRole("status")).toContainText(/sign in/i);
      await expect(card.getByRole("button", { name: "Try again: Finding jobs" })).toBeVisible();
    });

    await test.step("Needs you sends me to Settings, the one place that can fix it", async () => {
      const attention = attentionItem(page, "Finding jobs");
      await expect(attention).toContainText("Sign in with Claude again");
      await expect(attention.getByRole("button", { name: "Try again: Finding jobs" })).toHaveCount(0);
      await attention.getByRole("link", { name: "Check settings" }).click();
      await expect(page.getByRole("region", { name: "Claude connection" })).toBeVisible();
    });
  });
});
