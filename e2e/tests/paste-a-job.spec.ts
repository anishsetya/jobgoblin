// Story 5 (PRD D2): "A friend sends me a job. I paste the link and it is scored like any other. If the
// site needs a login, Jobgoblin asks me to paste the text instead of pretending it read the page."
// The demo board has the posting behind boards.greenhouse.io/gridline/jobs/4100 (Gridline Energy, fake score 78).
import { expect, test } from "../support/fixtures";
import { goToPipeline, needsYouItem } from "../support/flows";

const GRIDLINE = "Backend Engineer at Gridline Energy";

test.describe("As a job seeker, I add a job I found myself", () => {
  test("a Greenhouse link is read, scored and shown for review", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);

    await page.getByRole("button", { name: "Add a job" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a job" });
    await dialog.getByLabel("Link to the job").fill("https://boards.greenhouse.io/gridline/jobs/4100");
    await dialog.getByRole("button", { name: "Add job" }).click();

    await test.step("Today confirms in the server's own words that the job was added", async () => {
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("status").filter({ hasText: /added/i }).first()).toBeVisible();
    });

    await test.step("it is scored, tailored and waiting for my review", async () => {
      await expect(needsYouItem(page, GRIDLINE)).toContainText("Ready to review", { timeout: 60_000 });
      await needsYouItem(page, GRIDLINE).getByRole("link", { name: "Review" }).click();
      await expect(page.getByLabel("Fit score 78 out of 100")).toBeVisible();
      await expect(page.getByText("Strong match", { exact: true }).first()).toBeVisible();
    });

    await test.step("it is in the Pipeline once, not twice, when I add the same link again", async () => {
      await page.goto(`${server.origin}/today`);
      await page.getByRole("button", { name: "Add a job" }).click();
      await page.getByRole("dialog", { name: "Add a job" }).getByLabel("Link to the job").fill("https://boards.greenhouse.io/gridline/jobs/4100");
      await page.getByRole("dialog", { name: "Add a job" }).getByRole("button", { name: "Add job" }).click();

      await goToPipeline(page);
      await expect(page.getByTestId("pipeline-card").filter({ hasText: "Gridline Energy" })).toHaveCount(1);
    });
  });

  test("a LinkedIn link cannot be read, so Jobgoblin asks for the company, the title and the text", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);

    await page.getByRole("button", { name: "Add a job" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a job" });
    await dialog.getByLabel("Link to the job").fill("https://www.linkedin.com/jobs/view/3912345678");
    await dialog.getByRole("button", { name: "Add job" }).click();

    await test.step("the dialog stays open and asks for the job's text", async () => {
      await expect(dialog.getByLabel("Company")).toBeVisible();
      await expect(dialog.getByLabel("Job title")).toBeVisible();
      await expect(dialog.getByLabel("Job description")).toBeVisible();
      await expect(dialog.getByRole("status")).toContainText(/sign in|paste|text/i);
    });

    await test.step("with the text pasted in, the job is added and scored", async () => {
      await dialog.getByLabel("Company").fill("Orbit Labs");
      await dialog.getByLabel("Job title").fill("Backend Engineer");
      await dialog
        .getByLabel("Job description")
        .fill("Build Python services on PostgreSQL, deploy with Docker and Kubernetes on AWS, 2+ years of experience.");
      await dialog.getByRole("button", { name: "Add job" }).click();
      await expect(dialog).toBeHidden();

      await goToPipeline(page);
      await expect(page.getByTestId("pipeline-card").filter({ hasText: "Orbit Labs" })).toHaveCount(1, { timeout: 60_000 });
    });
  });
});
