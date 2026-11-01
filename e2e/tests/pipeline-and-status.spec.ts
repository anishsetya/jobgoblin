// Story 7 (PRD K1 and K2): "After I apply I keep the Pipeline honest: I record each step, I see which follow-ups
// are overdue, and I can find any application again."
// The two applications start as Applied (set up through the API, see approveAndMarkApplied); everything
// after that is done on the Application page and the Pipeline screen.
import { expect, test } from "../support/fixtures";
import { findJobsAndWaitForReview, goToPipeline } from "../support/flows";
import { approveAndMarkApplied, findApplicationId } from "../support/seed";
import { waitUntilNoRunIsActive } from "../support/waits";

test.describe("As a job seeker, I follow my applications through the Pipeline", () => {
  test("an application moves from Applied to Accepted using only the moves the app allows", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);
    await findJobsAndWaitForReview(page);
    const acmeId = await findApplicationId(server, "Acme Cloud", "Backend Engineer");
    await approveAndMarkApplied(server, acmeId);
    await waitUntilNoRunIsActive(server);

    await page.goto(`${server.origin}/apps/${acmeId}`);
    const statusCard = page.getByRole("region", { name: "Change status" });
    const newStatus = statusCard.getByLabel("New status");

    async function moveTo(label: string): Promise<void> {
      await newStatus.selectOption({ label });
      await statusCard.getByRole("button", { name: "Change status" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Backend Engineer" }).locator("..").getByText(label, { exact: true })).toBeVisible();
    }

    async function offeredMoves(): Promise<string[]> {
      return (await newStatus.locator("option").allTextContents()).filter((text) => text !== "Choose a status");
    }

    await test.step("from Applied I can only record what the company does next", async () => {
      await expect(newStatus).toBeVisible();
      await expect.poll(offeredMoves).toEqual(["Online assessment", "Phone screen", "Interview round", "Rejected", "No reply"]);
    });

    await test.step("Applied, then the online assessment, the phone screen, the interview round and the offer", async () => {
      await moveTo("Online assessment");
      await expect.poll(offeredMoves).toEqual(["Phone screen", "Interview round", "Rejected", "No reply"]);

      await moveTo("Phone screen");
      await expect.poll(offeredMoves).toEqual(["Interview round", "Rejected", "No reply"]);

      await moveTo("Interview round");
      await moveTo("Offer");
    });

    await test.step("from an offer I can only accept or decline it", async () => {
      await expect.poll(offeredMoves).toEqual(["Accepted", "Declined"]);
      await moveTo("Accepted");
      await expect(statusCard).toBeHidden(); // nothing more to change
    });

    await test.step("the history says each step in plain words", async () => {
      const history = page.getByRole("region", { name: "History" });
      await expect(history).toContainText("moved this from Offer to Accepted");
      await expect(history).toContainText("moved this from Applied to Online assessment");
    });

    await test.step("the Pipeline puts it in Closed", async () => {
      await goToPipeline(page);
      await expect(page.getByRole("region", { name: /^Closed/ }).getByTestId("pipeline-card").filter({ hasText: "Acme Cloud" })).toHaveCount(1);
    });
  });

  test("an overdue follow-up is highlighted, and withdrawing closes the application", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);
    await findJobsAndWaitForReview(page);
    const acmeId = await findApplicationId(server, "Acme Cloud", "Backend Engineer");
    const brightpathId = await findApplicationId(server, "Brightpath", "Platform Engineer");
    await approveAndMarkApplied(server, acmeId);
    await approveAndMarkApplied(server, brightpathId);
    await waitUntilNoRunIsActive(server);

    await test.step("I set Brightpath's follow-up to a day that has passed", async () => {
      await page.goto(`${server.origin}/apps/${brightpathId}`);
      const statusCard = page.getByRole("region", { name: "Change status" });
      await statusCard.getByLabel("New status").selectOption({ label: "Online assessment" });
      await statusCard.getByLabel("Follow up on").fill(daysFromToday(-3));
      await statusCard.getByRole("button", { name: "Change status" }).click();
      await expect(page.getByText(/^Follow up on /)).toBeVisible();
    });

    await test.step("on the board only that card is amber, and the other follow-up is not", async () => {
      await goToPipeline(page);
      const brightpathCard = page.getByTestId("pipeline-card").filter({ hasText: "Brightpath" });
      const acmeCard = page.getByTestId("pipeline-card").filter({ hasText: "Acme Cloud" });

      const overdueBadge = brightpathCard.getByText(/Follow-up overdue since/);
      const normalBadge = acmeCard.getByText(/^Follow up /);
      await expect(overdueBadge).toBeVisible();
      await expect(normalBadge).toBeVisible();
      await expect(acmeCard.getByText(/overdue/)).toHaveCount(0);

      const overdueBackground = await overdueBadge.evaluate((element) => getComputedStyle(element).backgroundColor);
      const normalBackground = await normalBadge.evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(overdueBackground).not.toBe(normalBackground);
    });

    await test.step("Today asks me to follow up on it", async () => {
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Today" }).click();
      const followUp = page.getByRole("region", { name: "Needs you" }).getByTestId("needs-you-item").filter({ hasText: "Follow up" });
      await expect(followUp).toHaveCount(1);
      await expect(followUp).toContainText("Platform Engineer at Brightpath");
    });

    await test.step("the overdue filter shows only that application", async () => {
      await goToPipeline(page);
      await page.getByLabel("Overdue follow-ups only").check();
      await expect(page.getByTestId("pipeline-card")).toHaveCount(1);
      await expect(page.getByTestId("pipeline-card")).toContainText("Brightpath");
    });

    await test.step("withdrawing it moves it to Closed and ends the overdue notice", async () => {
      await page.getByTestId("pipeline-card").getByRole("link").click();
      await page.getByRole("button", { name: "Withdraw" }).click();
      const dialog = page.getByRole("dialog", { name: "Withdraw this application?" });
      await dialog.getByLabel("Note (optional)").fill("Accepted another offer.");
      await dialog.getByRole("button", { name: "Withdraw" }).click();
      await expect(page.getByText("Withdrawn", { exact: true }).first()).toBeVisible();

      await goToPipeline(page);
      await expect(page.getByRole("region", { name: /^Closed/ }).getByTestId("pipeline-card").filter({ hasText: "Brightpath" })).toHaveCount(1);
      await page.getByLabel("Overdue follow-ups only").check();
      await expect(page.getByText("No applications match")).toBeVisible();
    });
  });

  test("from an application's page I can ask Claude about it and keep the answer", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);
    await findJobsAndWaitForReview(page);
    const acmeId = await findApplicationId(server, "Acme Cloud", "Backend Engineer");

    await page.goto(`${server.origin}/apps/${acmeId}`);
    const ask = page.getByRole("region", { name: "Ask about this application" });
    await expect(ask.getByRole("button", { name: "Ask", exact: true })).toBeDisabled(); // nothing typed yet
    await ask.getByLabel("Your question").fill("How strong is my fit?");
    await ask.getByRole("button", { name: "Ask", exact: true }).click();

    await expect(ask.getByRole("heading", { name: "How strong is my fit?" })).toBeVisible({ timeout: 60_000 });
    await expect(ask).toContainText("Acme Cloud, Backend Engineer");

    await page.reload();
    await expect(page.getByRole("region", { name: "Ask about this application" }).getByRole("heading", { name: "How strong is my fit?" })).toBeVisible();
  });

  test("search and filters find an application again", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);
    await findJobsAndWaitForReview(page);
    await goToPipeline(page);
    const cards = page.getByTestId("pipeline-card");
    await expect(cards).toHaveCount(4);

    await test.step("searching by company name", async () => {
      await page.getByLabel("Search").fill("brightpath");
      await expect(cards).toHaveCount(1);
      await expect(cards).toContainText("Platform Engineer");
      await expect(page).toHaveURL(/q=brightpath/);
    });

    await test.step("a search with no match says so and a cleared search brings everything back", async () => {
      await page.getByLabel("Search").fill("zzz-nothing");
      await expect(page.getByText("No applications match")).toBeVisible();
      await page.getByLabel("Search").fill("");
      await expect(cards).toHaveCount(4);
    });

    await test.step("filtering by status", async () => {
      await page.getByLabel("Status", { exact: true }).selectOption({ label: "Skipped (low fit)" });
      await expect(cards).toHaveCount(1);
      await expect(cards).toContainText("Data Analyst");
      await page.getByLabel("Status", { exact: true }).selectOption({ label: "All statuses" });
    });

    await test.step("filtering by fit", async () => {
      await page.getByLabel("Fit", { exact: true }).selectOption({ label: "Strong match" });
      await expect(cards).toHaveCount(1);
      await expect(cards).toContainText("Acme Cloud");
      await page.getByLabel("Fit", { exact: true }).selectOption({ label: "All fits" });
      await expect(cards).toHaveCount(4);
    });

    await test.step("the list view shows the same applications as a table, and keeps the search", async () => {
      await page.getByRole("button", { name: "List" }).click();
      const table = page.getByRole("table", { name: "Every application" });
      await expect(table.getByRole("row")).toHaveCount(5); // header + 4
      await page.getByLabel("Search").fill("copperleaf");
      await expect(table.getByRole("row")).toHaveCount(3); // header + the Applied AI role + the Data Analyst
      await expect(page).toHaveURL(/view=list/);
    });
  });
});

// A calendar day (YYYY-MM-DD) some days from today in this computer's time zone, like the server's own days.
function daysFromToday(days: number): string {
  const day = new Date();
  day.setDate(day.getDate() + days);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

