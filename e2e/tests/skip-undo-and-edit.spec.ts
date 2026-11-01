// Story 4 (PRD journey step 4, "approve, skip or ask for an edit"): "I can skip a job and change my mind,
// ask for a different resume, and spend effort on a long shot only when I choose to."
// Covers A2 (skip, undo skip, request edit with a note), T2 (every resume gets a version id) and F1 (long shot
// is tailored only on request).
import { expect, test } from "../support/fixtures";
import {
  ACME,
  BRIGHTPATH,
  COPPERLEAF,
  applicationIdFromUrl,
  findJobsAndWaitForReview,
  goToPipeline,
  needsYouItem,
  openReview,
} from "../support/flows";

test.describe("As a job seeker, I stay in charge of what gets prepared", () => {
  test("skipping a job is not final: I can undo it from the application page", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);
    await findJobsAndWaitForReview(page);

    await test.step("pressing S on Brightpath skips it and it leaves Needs you", async () => {
      await openReview(page, BRIGHTPATH);
      await page.getByRole("heading", { level: 1, name: "Platform Engineer" }).click(); // focus the page, not a field
      await page.keyboard.press("s");

      await page.goto(`${server.origin}/today`);
      await expect(needsYouItem(page, ACME)).toBeVisible();
      await expect(needsYouItem(page, BRIGHTPATH)).toHaveCount(0);
    });

    await test.step("the Pipeline lists it as Skipped, and its page offers Undo skip", async () => {
      await goToPipeline(page);
      await page.getByRole("link", { name: /Platform Engineer/ }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Platform Engineer" })).toBeVisible();
      await expect(page.getByText("Skipped", { exact: true }).first()).toBeVisible();
      await page.getByRole("button", { name: "Undo skip" }).click();
    });

    await test.step("it is back to Awaiting approval, and waiting for review again", async () => {
      await expect(page.getByText("Awaiting approval", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Undo skip" })).toHaveCount(0);

      await page.goto(`${server.origin}/today`);
      await expect(needsYouItem(page, BRIGHTPATH)).toContainText("Ready to review");
    });
  });

  test("J and K walk through the applications waiting for review, and E asks for an edit", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);
    await findJobsAndWaitForReview(page);

    await openReview(page, ACME);
    const title = page.getByRole("heading", { level: 1 });
    const position = page.getByText(/\d of 2 waiting for review/);
    await title.click(); // keys only work when the focus is not in a text box
    const firstTitle = await title.textContent();
    const firstPosition = await position.textContent();

    await test.step("J opens the next waiting application and K comes back", async () => {
      await page.keyboard.press("j");
      await expect(title).not.toHaveText(firstTitle ?? "");
      await expect(position).not.toHaveText(firstPosition ?? "");

      await page.keyboard.press("k");
      await expect(title).toHaveText(firstTitle ?? "");
      await expect(position).toHaveText(firstPosition ?? "");
    });

    await test.step("E opens the request-an-edit dialog, and typing a note does not trigger other keys", async () => {
      await page.keyboard.press("e");
      const dialog = page.getByRole("dialog", { name: "Request an edit" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("What should change?").fill("sa jk");  // contains the S, J and K keys
      await expect(dialog.getByLabel("What should change?")).toHaveValue("sa jk");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(title).toHaveText(firstTitle ?? ""); // still on the same application, nothing was skipped
    });
  });

  test("asking for an edit with a note gives me a new resume version to review", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);
    await findJobsAndWaitForReview(page);

    const applicationId = await openReview(page, ACME);
    const firstVersion = await currentResumeVersion(server, applicationId);
    await expect(page.getByRole("region", { name: "Resume", exact: true })).toContainText(`Version ${shortId(firstVersion)}`);

    await test.step("Request edit asks me what should change", async () => {
      await page.getByRole("button", { name: "Request edit" }).click();
      const dialog = page.getByRole("dialog", { name: "Request an edit" });
      await expect(dialog.getByRole("button", { name: "Send request" })).toBeDisabled(); // a note is required
      await dialog.getByLabel("What should change?").fill("Lead with the Python work, and keep it shorter.");
      await dialog.getByRole("button", { name: "Send request" }).click();
    });

    await test.step("a new version arrives and Acme Cloud waits for review again", async () => {
      await page.goto(`${server.origin}/today`);
      await expect(needsYouItem(page, ACME)).toContainText("Ready to review", { timeout: 60_000 });
      await expect.poll(() => currentResumeVersion(server, applicationId), { timeout: 60_000 }).not.toBe(firstVersion);
    });

    await test.step("the application page lists both versions, and the review shows what the edit left out", async () => {
      await page.goto(`${server.origin}/apps/${applicationId}`);
      const versions = page.getByRole("region", { name: "Resume versions" });
      await expect(versions.getByRole("listitem")).toHaveCount(2);
      await expect(versions.getByText("Current", { exact: true })).toHaveCount(1);

      await page.goto(`${server.origin}/review/${applicationId}`);
      const changes = page.getByRole("region", { name: "Changes from your main resume" });
      await expect(changes.getByRole("heading", { name: "Lines left out" })).toBeVisible();
    });
  });

  test("a long shot gets a tailored resume only when I ask for one", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);
    await findJobsAndWaitForReview(page);

    await test.step("Copperleaf has no resume yet, so it is only a suggestion", async () => {
      await needsYouItem(page, COPPERLEAF).getByRole("link", { name: "See details" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Software Engineer, Applied AI" })).toBeVisible();
      await expect(page.getByText("No resume has been made for this application yet.")).toBeVisible();
    });
    const applicationId = applicationIdFromUrl(page);

    await test.step("Tailor a resume starts a run, and the application reaches review", async () => {
      await page.getByRole("button", { name: "Tailor a resume" }).click();
      await page.goto(`${server.origin}/today`);
      await expect(needsYouItem(page, COPPERLEAF)).toContainText("Ready to review", { timeout: 60_000 });
      await needsYouItem(page, COPPERLEAF).getByRole("link", { name: "Review" }).click();
      await expect(page).toHaveURL(new RegExp(`/review/${applicationId}$`));
      await expect(page.getByRole("article", { name: "Resume preview" })).toContainText("Alex Rivera");
    });
  });
});

async function currentResumeVersion(server: { api<T>(route: string): Promise<T> }, applicationId: string): Promise<string> {
  const detail = await server.api<{ application: { resumeVersion: string | null } }>(`/api/apps/${applicationId}`);
  return detail.application.resumeVersion ?? "";
}

// "r-" and the first 8 hex digits: what the dashboard shows as the version.
function shortId(versionId: string): string {
  return versionId.slice(0, 10);
}
