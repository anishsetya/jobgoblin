// Story 13 (PRD T1 and P5, ARCHITECTURE.md section 8.2 and 8.4): "A resume never says more than my story does,
// and never uses a word I banned."
// The server checks every draft in code, whatever Claude wrote. Two switches make the fake claude misbehave:
// FAKE_CLAUDE_INVENT_BULLET=1 first submits a made-up bullet and an inflated verb ("Led" for "Contributed to").
// A banned word is set in Profile before the hunt.
import { expect, test } from "../support/fixtures";
import { ACME, findJobsAndWaitForReview, openReview } from "../support/flows";

test.describe("As a job seeker, my resume stays truthful", () => {
  test("a made-up bullet and an inflated verb never reach the resume I review", async ({ page, startServer }) => {
    const server = await startServer({
      seed: "alex-rivera",
      seedOptions: { usageNoticeSeen: true },
      fakeClaudeEnv: { FAKE_CLAUDE_INVENT_BULLET: "1" },
    });
    await page.goto(server.url);
    await findJobsAndWaitForReview(page); // both resumes were repaired and still reached review

    await openReview(page, ACME);
    const resume = page.getByRole("article", { name: "Resume preview" });
    await expect(resume).toContainText("Alex Rivera");

    await expect(resume).not.toContainText("Saved the company $1M"); // cites a story item that does not exist
    await expect(resume).not.toContainText("Led the on-call rotation"); // the story says "Contributed to"
    await expect(resume).toContainText("Led the migration of 12 services"); // a real "Led" is untouched
  });

  test("a word I banned is left out of the resume, even when my own story uses it", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);

    await test.step("I ban Redis in Profile", async () => {
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Profile" }).click();
      await page.getByRole("tab", { name: "Banned words" }).click();
      const banned = page.getByRole("textbox", { name: "Banned words" });
      await expect(banned).toHaveValue("rockstar\nninja");
      await banned.fill("rockstar\nninja\nRedis");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    });

    await test.step("the resumes that follow do not contain it", async () => {
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Today" }).click();
      await findJobsAndWaitForReview(page);
      await openReview(page, ACME);

      const resume = page.getByRole("article", { name: "Resume preview" });
      await expect(resume).toContainText("Alex Rivera");
      await expect(resume).not.toContainText(/redis/i);
      await expect(resume).toContainText("Kubernetes"); // only what was banned is gone
    });
  });
});
