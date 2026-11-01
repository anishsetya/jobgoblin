// Story 6 (PRD R2): "Claude has a question about one job. Only that job waits; the others carry on, and
// when I answer, the job goes back to work by itself."
// FAKE_CLAUDE_ASK_FIRST=1 makes the first tailor task call ask_person and complete as "waiting".
import { expect, test } from "../support/fixtures";
import { ACME, BRIGHTPATH, needsYouItem } from "../support/flows";

test.describe("As a job seeker, a question about one job does not stop the rest", () => {
  test("I answer it and that job reaches review", async ({ page, startServer }) => {
    const server = await startServer({
      seed: "alex-rivera",
      seedOptions: { usageNoticeSeen: true },
      fakeClaudeEnv: { FAKE_CLAUDE_ASK_FIRST: "1" },
    });
    await page.goto(server.url);
    await page.getByRole("button", { name: "Find jobs" }).click();

    // Applications are tailored best score first, so the first one asked about is Acme Cloud (86).
    const question = page.getByRole("region", { name: "Needs you" }).getByTestId("needs-you-item").filter({ hasText: "Question" });

    await test.step("one application asks me a question", async () => {
      await expect(question).toHaveCount(1);
      await expect(question).toContainText(ACME);
      await expect(question.getByLabel("For Acme Cloud, should I lead with your infrastructure work or your API work?")).toBeVisible();
    });

    await test.step("the other application was not held up: it reaches review", async () => {
      await expect(needsYouItem(page, BRIGHTPATH)).toContainText("Ready to review");
      await expect(needsYouItem(page, ACME)).not.toContainText("Ready to review");
    });

    await test.step("the question stays on Today until I answer (nothing is guessed)", async () => {
      await page.reload();
      await expect(question).toHaveCount(1);
    });

    await test.step("answering puts that one application back to work, and it reaches review", async () => {
      await question.getByLabel(/should I lead with your infrastructure work/).fill("Lead with the API work.");
      await question.getByRole("button", { name: "Send answer" }).click();

      await expect(question).toHaveCount(0);
      await expect(needsYouItem(page, ACME)).toContainText("Ready to review", { timeout: 60_000 });
      await expect(needsYouItem(page, BRIGHTPATH)).toContainText("Ready to review");
    });
  });
});
