// Story 16 (issue #28, PRD "User experience"): "A job with a very long name still fits my window. Nothing slides
// sideways, and I can see every Pipeline column."
// The names are the ones the audit used: a company that is one 151-letter word, and a title of about 280 characters.
// They come in through Add a job as pasted text, so the fake claude scores and tailors the job like any other.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { applicationIdFromUrl, goToPipeline, needsYouItem } from "../support/flows";

const WINDOW = { width: 1280, height: 800 };
const LONG_COMPANY = `Extraordinarily${"Longnamed".repeat(14)}Industries`;
const LONG_TITLE = "Senior Principal Distinguished Backend Platform Infrastructure Reliability Engineering Lead, ".repeat(3).trim();
const COLUMNS = ["To review", "Ready to apply", "Applied", "Interviewing", "Offer", "Closed"];

test.use({ viewport: WINDOW });

// How far something reaches past its own right edge, in pixels: 0 when nothing is hidden sideways.
async function sidewaysOverflowOfPage(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function sidewaysOverflowOf(element: Locator): Promise<number> {
  return element.evaluate((node) => node.scrollWidth - node.clientWidth);
}

test.describe("As a job seeker, long names stay inside my window", () => {
  test("a job with a very long company and title fits Today, Review, the application page and Pipeline", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);

    await test.step("I add the job by pasting its text, and it waits for my review", async () => {
      await page.getByRole("button", { name: "Add a job" }).click();
      const dialog = page.getByRole("dialog", { name: "Add a job" });
      await dialog.getByRole("button", { name: "Paste the job text instead" }).click();
      await dialog.getByLabel("Company").fill(LONG_COMPANY);
      await dialog.getByLabel("Job title").fill(LONG_TITLE);
      await dialog
        .getByLabel("Job description")
        .fill("Build Python services on PostgreSQL, deploy with Docker and Kubernetes on AWS, 2+ years of experience.");
      await dialog.getByRole("button", { name: "Add job" }).click();
      await expect(dialog).toBeHidden();
      await expect(needsYouItem(page, LONG_COMPANY)).toContainText("Ready to review", { timeout: 60_000 });
    });

    await test.step("Today does not slide sideways", async () => {
      expect(await sidewaysOverflowOfPage(page)).toBeLessThanOrEqual(0);
    });

    let applicationId = "";
    await test.step("nor does Review", async () => {
      await needsYouItem(page, LONG_COMPANY).getByRole("link", { name: "Review" }).click();
      await expect(page.getByRole("heading", { level: 1, name: LONG_TITLE })).toBeVisible();
      await expect(page.getByRole("main").getByText(LONG_COMPANY, { exact: true }).first()).toBeVisible();
      expect(await sidewaysOverflowOfPage(page)).toBeLessThanOrEqual(0);
      applicationId = applicationIdFromUrl(page);
    });

    await test.step("nor does the application page", async () => {
      await page.goto(`${server.origin}/apps/${applicationId}`);
      await expect(page.getByRole("heading", { level: 1, name: LONG_TITLE })).toBeVisible();
      expect(await sidewaysOverflowOfPage(page)).toBeLessThanOrEqual(0);
    });

    await test.step("the Pipeline board shows all six columns inside the window, in order", async () => {
      await goToPipeline(page);
      const toReview = page.getByRole("region", { name: /^To review/ });
      await expect(toReview.getByTestId("pipeline-card").filter({ hasText: LONG_COMPANY })).toHaveCount(1);
      for (const name of COLUMNS) {
        const column = page.getByRole("region", { name: new RegExp(`^${name}`) });
        const box = await column.boundingBox();
        expect(box).not.toBeNull();
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(WINDOW.width);
      }
      expect(await sidewaysOverflowOfPage(page)).toBeLessThanOrEqual(0);
    });

    await test.step("and so does the list, without a sideways scroll of its own", async () => {
      await page.getByRole("group", { name: "View" }).getByRole("button", { name: "List" }).click();
      const table = page.getByRole("table", { name: "Every application" });
      await expect(table.getByRole("cell", { name: LONG_COMPANY })).toBeVisible();
      expect(await sidewaysOverflowOf(table.locator(".."))).toBeLessThanOrEqual(0);
      expect(await sidewaysOverflowOfPage(page)).toBeLessThanOrEqual(0);
    });

    await test.step("in a narrow window (640 px) the board puts fewer columns in a row, and still hides none", async () => {
      await page.setViewportSize({ width: 640, height: 800 });
      await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Board" }).click();
      for (const name of COLUMNS) {
        const box = await page.getByRole("region", { name: new RegExp(`^${name}`) }).boundingBox();
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(640);
      }
      expect(await sidewaysOverflowOfPage(page)).toBeLessThanOrEqual(0);
    });
  });
});
