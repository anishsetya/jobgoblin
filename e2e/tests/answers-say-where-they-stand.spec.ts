// Story 17 (PRD A4 and U1, issue #26): "The answers part of each screen tells me where things stand. A job
// that asks nothing extra says so instead of 'still being written' forever, and I submitted is where I land."
// The fake follows playbooks/answers.md for a job with no screening questions (FAKE_CLAUDE_NO_QUESTIONS=1): it
// saves nothing and ends the task as done. Acme Cloud's posting has no custom questions.
import { expect, test } from "../support/fixtures";
import { ACME, findJobsAndWaitForReview, needsYouItem } from "../support/flows";
import { approveThroughApi, findApplicationId } from "../support/seed";
import { waitUntilNoRunIsActive } from "../support/waits";

const NO_QUESTIONS = "No extra questions were found for this job, so there is nothing to answer here.";
const NOT_APPROVED_YET = "Answers are written after you approve the application.";
// From the main area: the posting link in the header, then I submitted. Before the fix it came after every copy button.
const MAX_TAB_PRESSES_TO_I_SUBMITTED = 4;

test.describe("As a job seeker, I always know where the answers to a job's questions stand", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a job with no extra questions says so on both screens, and I submitted is in view when I arrive", async ({ page, startServer }) => {
    const server = await startServer({
      seed: "alex-rivera",
      seedOptions: { usageNoticeSeen: true },
      fakeClaudeEnv: { FAKE_CLAUDE_NO_QUESTIONS: "1" },
    });
    await page.goto(server.url);
    await findJobsAndWaitForReview(page);
    const acmeId = await findApplicationId(server, "Acme Cloud", "Backend Engineer");
    const brightpathId = await findApplicationId(server, "Brightpath", "Platform Engineer");

    await test.step("before I approve, the application page says when answers are written", async () => {
      await page.goto(`${server.origin}/apps/${brightpathId}`);
      await expect(page.getByRole("region", { name: "Answers" })).toContainText(NOT_APPROVED_YET);
    });

    await test.step("I approve Acme Cloud, and its answers run ends with nothing to answer", async () => {
      await approveThroughApi(server, acmeId);
      await waitUntilNoRunIsActive(server);
    });

    await test.step("Open application says there is nothing to answer, and I submitted is in view", async () => {
      await page.goto(`${server.origin}/today`);
      await needsYouItem(page, ACME).getByRole("link", { name: "Open application" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Backend Engineer" })).toBeVisible();

      await expect(page.getByRole("region", { name: "Answers" })).toContainText(NO_QUESTIONS);
      await expect(page.getByRole("button", { name: "I submitted" })).toBeInViewport();
    });

    await test.step("a few presses of Tab take me from the top of the screen to I submitted", async () => {
      await expect(page.getByRole("main")).toBeFocused(); // where the screen puts focus after I arrive
      const iSubmitted = page.getByRole("button", { name: "I submitted" });

      for (let presses = 1; presses <= MAX_TAB_PRESSES_TO_I_SUBMITTED; presses += 1) {
        await page.keyboard.press("Tab");
        if (await iSubmitted.evaluate((button) => button === document.activeElement)) break;
      }

      await expect(iSubmitted).toBeFocused();
    });

    await test.step("the application page says the same about the answers", async () => {
      await page.goto(`${server.origin}/apps/${acmeId}`);
      await expect(page.getByRole("region", { name: "Answers" })).toContainText(NO_QUESTIONS);
    });
  });
});
