// Story 3 (PRD journey steps 4, 5 and 6): "I review the best job, approve it with one key, copy what the form
// needs, and tell Jobgoblin I applied."
// Covers F1/F2 (fit, band, reason, gaps), T1/T2 (tailored resume, frozen approved file), A1-A4 (review,
// data sheet, answers after approval), U1/U4 (copy buttons, "I submitted" with proof) and K1 (Pipeline).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { snap } from "../support/screenshots";
import { ACME, applicationIdFromUrl, findJobsAndWaitForReview, goToPipeline, needsYouItem, openReview } from "../support/flows";

type ApplicationJson = {
  application: { status: string; followUpOn: string | null; folder: string | null };
  approval: { pdfSha256: string } | null;
};

test.describe("As a job seeker, I review, approve and apply to the best job", () => {
  test("from the review screen to Applied, with every file where I can find it", async ({ page, context, startServer }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const server = await startServer({
      seed: "alex-rivera",
      seedOptions: { usageNoticeSeen: true },
      fakeClaudeEnv: { FAKE_CLAUDE_REWORD: "1" },
    });
    await page.goto(server.url);
    await findJobsAndWaitForReview(page);

    await test.step("the review screen tells me how well Acme Cloud fits and why", async () => {
      await openReview(page, ACME);

      await expect(page.getByRole("heading", { level: 1, name: "Backend Engineer" })).toBeVisible();
      await expect(page.getByText("2 of 2 waiting for review").or(page.getByText("1 of 2 waiting for review"))).toBeVisible();

      const fit = page.getByRole("region", { name: "Fit", exact: true });
      await expect(fit.getByLabel("Fit score 86 out of 100")).toBeVisible();
      await expect(fit.getByText("Strong match", { exact: true })).toBeVisible(); // the band
      await expect(fit).toContainText("Strong match: Your story shows"); // the one-line reason
      await expect(fit.getByRole("heading", { name: "Not shown in your story" })).toBeVisible(); // the gaps
      await expect(fit.getByRole("heading", { name: "From your story" })).toBeVisible(); // what supports the fit
    });

    await test.step("the resume preview highlights the line that was reworded for this job", async () => {
      const changes = page.getByRole("region", { name: "Changes from your main resume" });
      await expect(changes.getByRole("heading", { name: "Lines reworded" })).toBeVisible();
      await expect(changes).toContainText("Before:");
      await expect(changes).toContainText(", which serves 2M requests a day");

      const preview = page.getByRole("article", { name: "Resume preview" });
      await expect(preview).toContainText("Alex Rivera");
      const rewordedLines = preview.getByRole("listitem").filter({ hasText: "Reworded:" });
      await expect(rewordedLines).toHaveCount(1);
      await expect(rewordedLines).toContainText("which serves 2M requests a day");
      // The highlight is a bar and a tint, not color alone.
      await expect(rewordedLines.locator("span").first()).toHaveCSS("border-left-width", "2px");
      await snap(page, "20-review-acme-cloud");
    });

    await test.step("the data sheet lists every value that will be sent, and marks the one that is missing", async () => {
      const dataSheet = page.getByRole("table", { name: "Every value that will be sent with this application" });
      await expect(dataSheet.getByRole("row", { name: /Full name Alex Rivera/ })).toBeVisible();
      await expect(dataSheet.getByRole("row", { name: /Email address alex.rivera@example.com/ })).toBeVisible();
      await expect(dataSheet.getByRole("row", { name: /Expected base salary Missing/ })).toBeVisible();
      await expect(dataSheet.getByRole("row", { name: /Resume file name Alex Rivera - Resume.pdf/ })).toBeVisible();
    });

    await test.step("pressing A approves it (the only accent button is Approve)", async () => {
      await page.getByRole("heading", { level: 1, name: "Backend Engineer" }).click(); // focus on the page, not in a field
      await page.keyboard.press("a");
      // The next waiting application (Brightpath) opens, so Acme Cloud has left the review list.
      await expect(page.getByRole("heading", { level: 1, name: "Platform Engineer" })).toBeVisible();
    });

    await test.step("the answers run finishes and Acme Cloud is ready to send", async () => {
      await page.goto(`${server.origin}/today`);
      const ready = needsYouItem(page, ACME);
      await expect(ready).toContainText("Ready to send");
      await ready.getByRole("link", { name: "Open application" }).click();
      await expect(page.getByRole("heading", { name: "Why are you interested in this role?" })).toBeVisible();
      await snap(page, "21-open-application");
    });

    const applicationId = applicationIdFromUrl(page);

    await test.step("Open application has a copy button for every value I approved", async () => {
      const dataSheet = page.getByRole("table", { name: "Every value that will be sent with this application" });
      const valueRows = dataSheet.locator("tbody tr");
      const missingRows = valueRows.filter({ hasText: "Missing" });
      const copyButtons = dataSheet.getByRole("button", { name: /^Copy / });
      expect(await copyButtons.count()).toBe((await valueRows.count()) - (await missingRows.count()));

      await dataSheet.getByRole("button", { name: "Copy Email address" }).click();
      await expect(dataSheet.getByText("Copied")).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("alex.rivera@example.com");
    });

    await test.step("every answer has a copy button too, and holds my real name, not a placeholder", async () => {
      const answers = page.getByRole("region", { name: "Answers" });
      await expect(answers.getByRole("button", { name: "Copy Why are you interested in this role?" })).toBeVisible();
      await answers.getByRole("button", { name: "Copy Why are you interested in this role?" }).click();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toContain("Alex");
      expect(copied).not.toMatch(/[{}]/);
    });

    await test.step("the resume file is easy to find: a browser cannot open it, so the page shows where it is", async () => {
      await page.getByRole("button", { name: "Open resume file" }).click();
      const notOpened = page.getByRole("status").filter({ hasText: "The file could not be opened from here" });
      await expect(notOpened).toBeVisible();
      const shownPath = ((await notOpened.textContent()) ?? "").split("You can find it at")[1]?.trim() ?? "";
      expect(shownPath).toBe(path.join(server.personFolder, ...(await applicationFolderOf(server, applicationId)).split("/"), "Alex Rivera - Resume.pdf"));
      expect(fs.existsSync(shownPath)).toBe(true);
    });

    await test.step("Download a copy saves the same approved PDF", async () => {
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download a copy" }).click()]);
      expect(download.suggestedFilename()).toBe("Alex Rivera - Resume.pdf");
      const approvedSha256 = (await server.api<ApplicationJson>(`/api/apps/${applicationId}`)).approval?.pdfSha256;
      expect(sha256Of(await download.path())).toBe(approvedSha256);
    });

    await test.step("I say I submitted it, with proof that I saw the confirmation page", async () => {
      await page.getByRole("button", { name: "I submitted" }).click();
      const dialog = page.getByRole("dialog", { name: "Record that you applied" });
      await expect(dialog.getByRole("radio", { name: "I saw the confirmation page" })).toBeChecked();
      await dialog.getByLabel("Web address of the confirmation page").fill("https://boards.greenhouse.io/acmecloud/confirmation");
      await dialog.getByRole("button", { name: "Record as applied" }).click();

      await expect(page).toHaveURL(new RegExp(`/apps/${applicationId}$`));
      await expect(page.getByText("Applied", { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/^Follow up on /)).toBeVisible();
      await snap(page, "22-application-applied");
    });

    await test.step("the follow-up day is a week after I applied", async () => {
      const detail = await server.api<ApplicationJson>(`/api/apps/${applicationId}`);
      expect(detail.application.status).toBe("Applied");
      expect(detail.application.followUpOn).toBe(localDayPlus(7));
    });

    await test.step("Pipeline shows it under Applied", async () => {
      await goToPipeline(page);
      const appliedColumn = page.getByRole("region", { name: /^Applied/ });
      await expect(appliedColumn.getByTestId("pipeline-card")).toHaveCount(1);
      await expect(appliedColumn).toContainText("Backend Engineer");
      await expect(appliedColumn).toContainText("Acme Cloud");
      await snap(page, "23-pipeline-applied");
    });

    await test.step("the PDF and Answers.md are in my folder, and the PDF is exactly the approved file", async () => {
      const detail = await server.api<ApplicationJson>(`/api/apps/${applicationId}`);
      const applicationFolder = path.join(server.personFolder, ...(detail.application.folder ?? "").split("/"));

      const resumePdf = path.join(applicationFolder, "Alex Rivera - Resume.pdf");
      expect(fs.existsSync(resumePdf)).toBe(true);
      expect(fs.readFileSync(resumePdf).subarray(0, 5).toString()).toBe("%PDF-");
      expect(sha256Of(resumePdf)).toBe(detail.approval?.pdfSha256);

      const answersText = fs.readFileSync(path.join(applicationFolder, "Answers.md"), "utf8");
      expect(answersText).toContain("Why are you interested in this role?");
      expect(answersText).toContain("Alex");
      expect(answersText).not.toMatch(/[{}]/);

      expect(fs.existsSync(path.join(applicationFolder, "Job description.md"))).toBe(true);
      expect(fs.readdirSync(path.join(server.personFolder, "Resumes")).filter((name) => name.endsWith(".pdf"))).toHaveLength(1);
    });
  });
});

test.describe("As a job seeker, an approval only counts for the details I approved", () => {
  test("changing my phone number after approving cancels the approval until I review it again", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);
    await findJobsAndWaitForReview(page);

    const applicationId = await openReview(page, ACME);
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Platform Engineer" })).toBeVisible();

    await test.step("I correct my phone number in Profile", async () => {
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Profile" }).click();
      await page.getByRole("tab", { name: "Form answers" }).click();
      await page.getByLabel("Phone number").fill("+1 555 0199");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    });

    await test.step("Open application refuses to hand out details I never approved", async () => {
      await page.goto(`${server.origin}/apply/${applicationId}`);
      await expect(page.getByText("Your details changed since you approved. Review it again.")).toBeVisible();
      await expect(page.getByRole("button", { name: "I submitted" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Copy / })).toHaveCount(0);
    });

    await test.step("Today asks me to review it again", async () => {
      await page.goto(`${server.origin}/today`);
      await expect(needsYouItem(page, ACME)).toContainText("Your details changed since you approved this. Review it again.");
    });

    await test.step("after I approve again, the new number is in the frozen data sheet", async () => {
      await page.getByRole("link", { name: "Review again" }).or(needsYouItem(page, ACME).getByRole("link", { name: "Review" })).first().click();
      await page.getByRole("button", { name: "Approve" }).click();
      await page.goto(`${server.origin}/apply/${applicationId}`);
      await expect(page.getByRole("row", { name: /Phone number \+1 555 0199/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "I submitted" })).toBeEnabled();
    });
  });
});

async function applicationFolderOf(server: { api<T>(route: string): Promise<T> }, applicationId: string): Promise<string> {
  const detail = await server.api<ApplicationJson>(`/api/apps/${applicationId}`);
  return detail.application.folder ?? "";
}

function localDayPlus(days: number): string {
  const day = new Date();
  day.setDate(day.getDate() + days);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

function sha256Of(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
