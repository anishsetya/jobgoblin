// Story 15 (PRD P3, P4 and D1; issues #20, #5 and #2): "I say once where I can work, and Find jobs looks there."
// Where you can work is answered on Form answers, above the questions it decides. Remote is a way of working, not
// a place: a remote job is done from where the person lives, so Remote asks that country's questions, and a
// "Remote - US" job counts for a person who wants only remote work. A change reaches the jobs found before, too.
// The demo board has one remote role (Acme Cloud, "Remote - US", also posted on HN) and on-site roles in New York
// (Brightpath) and San Francisco (Copperleaf). Alex lives in Austin and answered the United States questions.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { ACME, BRIGHTPATH, COPPERLEAF, findJobsAndWaitForReview, goToToday, needsYouItem, openReview } from "../support/flows";

const SEEDED = { seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } } as const;

test.describe("As a job seeker, I say where I can work and Find jobs looks there", () => {
  test("with only Remote jobs, the remote job is found and the on-site ones are not, and I can apply to it", async ({ page, startServer }) => {
    const server = await startServer(SEEDED);
    await page.goto(server.url);

    await test.step("Form answers: I keep only Remote jobs, and the questions are those of where I live", async () => {
      await openFormAnswers(page);
      await expect(placeChoices(page).getByRole("checkbox", { name: "Remote jobs" })).toBeChecked();
      await placeChoices(page).getByRole("checkbox", { name: "United States" }).uncheck();
      await expect(page.getByRole("group", { name: "United States (where you live)" })).toBeVisible();
      await saveAnswers(page);
    });

    await test.step("Find jobs: the remote job is ready to review, and the jobs in New York and San Francisco are left out", async () => {
      await goToToday(page);
      await page.getByRole("button", { name: "Find jobs" }).click();
      await expect(needsYouItem(page, ACME)).toContainText("Ready to review");
      await expect(huntCard(page).getByRole("status")).toHaveText("Finished");
      await expect(needsYouItem(page, BRIGHTPATH)).toHaveCount(0);
      await expect(needsYouItem(page, COPPERLEAF)).toHaveCount(0);
    });

    await test.step("Review: the data sheet has my answers for working in the United States", async () => {
      await openReview(page, ACME);
      const dataSheet = page.getByRole("table", { name: "Every value that will be sent with this application" });
      await expect(dataSheet.getByRole("row", { name: /Authorized to work here Yes/ })).toBeVisible();
      await expect(dataSheet.getByRole("row", { name: /Needs visa sponsorship No/ })).toBeVisible();
    });

    await test.step("I approve it, and it is ready to send once its answers are written", async () => {
      await page.getByRole("button", { name: "Approve" }).click();
      await expect(page).toHaveURL(/\/today$/); // it was the only job to review
      const ready = needsYouItem(page, ACME);
      await expect(ready).toContainText("Ready to send");
      await ready.getByRole("link", { name: "Open application" }).click();
    });

    await test.step("I say I submitted it, with the confirmation page, and it is Applied", async () => {
      await page.getByRole("button", { name: "I submitted" }).click();
      const dialog = page.getByRole("dialog", { name: "Record that you applied" });
      await dialog.getByLabel("Web address of the confirmation page").fill("https://boards.greenhouse.io/acmecloud/confirmation");
      await dialog.getByRole("button", { name: "Record as applied" }).click();
      await expect(page).toHaveURL(/\/apps\/[\w-]+$/);
      await expect(page.getByText("Applied", { exact: true }).first()).toBeVisible();
    });
  });

  test("with only India, Find jobs finds nothing; once I add the United States, the jobs it left out come back", async ({ page, startServer }) => {
    const server = await startServer(SEEDED);
    await page.goto(server.url);

    await test.step("Form answers: I choose only India, and India's questions are now the ones to answer", async () => {
      await openFormAnswers(page);
      await placeChoices(page).getByRole("checkbox", { name: "United States" }).uncheck();
      await placeChoices(page).getByRole("checkbox", { name: "Remote jobs" }).uncheck();
      await placeChoices(page).getByRole("checkbox", { name: "India" }).check();
      await expect(page.getByRole("group", { name: "India" })).toBeVisible();
      await expect(page.getByRole("group", { name: /United States/ })).toHaveCount(0);
      await saveAnswers(page);
      await expect(page.getByText(/still needed: .*Authorized to work \(India\)/)).toBeVisible();
    });

    await test.step("Find jobs: every demo job is in the United States, so none reaches me", async () => {
      await goToToday(page);
      await page.getByRole("button", { name: "Find jobs" }).click();
      await expect(huntCard(page).getByRole("status")).toHaveText("Finished");
      await expect(page.getByTestId("needs-you-item")).toHaveCount(0);
      expect(await server.api<unknown[]>("/api/pipeline")).toHaveLength(0);

      await huntCard(page).getByRole("button", { name: "Dismiss: Finding jobs" }).click();
      await expect(huntCard(page)).toHaveCount(0);
    });

    await test.step("Form answers: I add the United States, which I answered before", async () => {
      await openFormAnswers(page);
      await placeChoices(page).getByRole("checkbox", { name: "United States" }).check();
      await expect(page.getByRole("group", { name: "United States (where you live)" })).toBeVisible();
      await saveAnswers(page);
    });

    await test.step("Find jobs again: the same jobs come back, and the role posted twice is shown once", async () => {
      await goToToday(page);
      await findJobsAndWaitForReview(page);
      const rows = await server.api<{ title: string }[]>("/api/pipeline");
      expect(rows.map((row) => row.title).sort()).toEqual(
        ["Backend Engineer", "Data Analyst", "Platform Engineer", "Software Engineer, Applied AI"],
      );
    });
  });
});

async function openFormAnswers(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Profile" }).click();
  await page.getByRole("tab", { name: "Form answers" }).click();
  await expect(page.getByLabel("Full name")).toHaveValue("Alex Rivera");
}

// The checkboxes of "Where you can work".
function placeChoices(page: Page): Locator {
  return page.getByRole("group", { name: "Tick every place that fits" });
}

async function saveAnswers(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

function huntCard(page: Page): Locator {
  return page.getByTestId("run-card").filter({ hasText: "Finding jobs" });
}
