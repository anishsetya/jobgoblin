// Story 2 (PRD journey steps 3 and 4): "I press Find jobs and, a little later, the good jobs wait for my review."
// Covers D1 (find jobs), D3 (never show a job twice), F1/F2 (fit and bands), R1 and R3 (live progress, usage notice).
// The fake claude scores the demo board from fixtures/fake-claude/data/scores.json, so the outcome is fixed:
// Acme Cloud 86 and Brightpath 68 are tailored for review, Copperleaf Applied AI (55) is a long shot,
// the Data Analyst is skipped, and the QA, Senior Staff and repeated HN postings never get this far.
import { expect, test } from "../support/fixtures";
import { recordedRunCardTexts, startRecordingRunCards } from "../support/pageProbes";
import { snap } from "../support/screenshots";

test.describe("As a job seeker, I find jobs and see which ones need me", () => {
  test("the usage notice comes first, then Find jobs shows live progress and ends with jobs to review", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera" });
    await startRecordingRunCards(page);
    await page.goto(server.url);

    await test.step("Today invites me to find my first jobs", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Find your first jobs" })).toBeVisible();
      await snap(page, "10-today-first-run");
    });

    await test.step("before the first run I am told that it uses my own Claude plan", async () => {
      await page.getByRole("button", { name: "Find jobs" }).click();

      const notice = page.getByRole("dialog", { name: "Before your first run" });
      await expect(notice).toContainText("your own Claude plan");
      await expect(notice).toContainText("share the same limits as your chats");
      await snap(page, "11-usage-notice");
      await expect(page.getByTestId("run-card")).toHaveCount(0);

      await notice.getByRole("button", { name: "I understand, continue" }).click();
    });

    await test.step("a run card appears and tells me in plain words what is happening", async () => {
      const runCard = page.getByTestId("run-card").first();
      await expect(runCard).toBeVisible();
      await expect(runCard.getByRole("heading", { name: "Finding jobs" })).toBeVisible();
    });

    await test.step("Needs you ends up with two jobs to review and one long shot", async () => {
      const needsYou = page.getByRole("region", { name: "Needs you" });
      const toReview = needsYou.getByTestId("needs-you-item").filter({ hasText: "Ready to review" });
      await expect(toReview).toHaveCount(2);
      await expect(toReview.filter({ hasText: "Backend Engineer at Acme Cloud" })).toHaveCount(1);
      await expect(toReview.filter({ hasText: "Platform Engineer at Brightpath" })).toHaveCount(1);

      const longShots = needsYou.getByTestId("needs-you-item").filter({ hasText: "Long shot" });
      await expect(longShots).toHaveCount(1);
      await expect(longShots).toContainText("Software Engineer, Applied AI at Copperleaf AI");
      await snap(page, "12-today-needs-you");
    });

    await test.step("the progress I saw was written for people, not for computers", async () => {
      const seen = (await recordedRunCardTexts(page)).join("\n");
      // The fake claude is fast, so which steps the page catches depends on timing: ask for any of the plain
      // sentences the steps are written in, not one in particular.
      const plainSteps = [
        "Checking job boards",
        "Looking through new jobs",
        "Getting Your story and targets ready",
        "Scoring how well a job fits",
        "Picking the next application",
        "Getting the job and Your story ready for a resume",
        "Checking every bullet against your profile",
      ];
      expect(plainSteps.filter((step) => seen.includes(step)).length).toBeGreaterThanOrEqual(1);
      expect(seen).toMatch(/\d+ of \d+ done/);
      expect(seen).not.toMatch(/mcp__|record_fit|search_jobs|submit_resume_draft/);
    });
  });

  test("the postings that should not be shown never reach the pipeline", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);
    await page.getByRole("button", { name: "Find jobs" }).click();
    await expect(page.getByTestId("needs-you-item").filter({ hasText: "Ready to review" })).toHaveCount(2);

    await page.getByRole("link", { name: "Pipeline" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Pipeline" })).toBeVisible();

    await test.step("the four real roles are on the board", async () => {
      const cards = page.getByTestId("pipeline-card");
      await expect(cards.filter({ hasText: "Backend Engineer" })).toHaveCount(1); // Acme Cloud: its HN repeat is not a second card
      await expect(cards.filter({ hasText: "Platform Engineer" })).toHaveCount(1);
      await expect(cards.filter({ hasText: "Software Engineer, Applied AI" })).toHaveCount(1);
      await expect(cards.filter({ hasText: "Data Analyst" })).toHaveCount(1); // scored 20: listed, as Skipped (low fit)
      await expect(cards).toHaveCount(4);
    });

    await test.step("the QA role, the Senior Staff role and the repeated HN posting are nowhere", async () => {
      const board = page.getByRole("main");
      await expect(board).not.toContainText("QA Automation Engineer");
      await expect(board).not.toContainText("Senior Staff");
    });
  });
});
