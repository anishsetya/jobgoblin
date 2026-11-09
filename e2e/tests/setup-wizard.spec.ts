// Story 1 (PRD journey steps 1 and 2; S2, S3, S4, P1-P5): "I install Jobgoblin, set it up in a few minutes, and
// only what I confirmed is ever used."
// The app starts empty. The test walks every step of the wizard like a first-time user: Welcome, Connect
// Claude, folder, resume, Your story, Form answers, Targets, and Finish. The fake claude plays the setup run:
// it proposes the 22 items of Alex Rivera's story from her resume, as pending.
import { expect, test } from "../support/fixtures";
import { snap } from "../support/screenshots";
import { PASSWORD_PROTECTED_PDF, RESUME_PDF, brokenResume } from "../support/seed";

const PROPOSED_ITEMS = 22;

test.describe("As a first-time user, I set Jobgoblin up", () => {
  test("seven steps and a Finish button take me from an empty profile to Today", async ({ page, startServer }) => {
    const server = await startServer({ seed: "none" });
    await page.goto(server.url);

    await test.step("1. Welcome: the app starts at the wizard because setup is not finished", async () => {
      await expect(page).toHaveURL(/\/setup\/1$/);
      await expect(page.getByRole("heading", { level: 1, name: "Welcome to Jobgoblin" })).toBeVisible();
      await expect(page.getByText("Step 1 of 8")).toBeVisible();
      await snap(page, "01-setup-1-welcome");
      await page.getByRole("button", { name: "Get started" }).click();
    });

    await test.step("2. Connect Claude: the fake claude is installed and signed in", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Connect Claude" })).toBeVisible();
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();
      await expect(page.getByText("Version 2.1.99")).toBeVisible();
      await snap(page, "02-setup-2-connect");
      await page.getByRole("button", { name: "Continue" }).click();
    });

    await test.step("3. Your folder: I type the path, since a browser has no folder chooser", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Choose your folder" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled(); // not before a folder is chosen

      await page.getByLabel("Folder", { exact: true }).fill(server.personFolder);
      await page.getByRole("button", { name: "Use this folder" }).click();
      await expect(page.getByText(server.personFolder)).toBeVisible();
      await snap(page, "03-setup-3-folder");
      await page.getByRole("button", { name: "Continue" }).click();
    });

    await test.step("4. Your resume: I upload the PDF, accept the usage notice, and Claude reads it", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Add your resume" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Read my resume" })).toBeDisabled(); // no file yet
      await page.getByLabel("Your resume", { exact: true }).setInputFiles(RESUME_PDF);
      await page.getByRole("button", { name: "Read my resume" }).click();

      await page.getByRole("dialog", { name: "Before your first run" }).getByRole("button", { name: "I understand, continue" }).click();

      await expect(page.getByText("Your resume has been read. Next, check what we found.")).toBeVisible();
      await snap(page, "04-setup-4-resume");
      await page.getByRole("button", { name: "Continue" }).click();
    });

    await test.step("5. Your story: Claude proposed items, none is used until I confirm it", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Your story" })).toBeVisible();
      await expect(page.getByText(`0 confirmed, ${PROPOSED_ITEMS} waiting for you.`)).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
      await snap(page, "05-setup-5-story-proposed");
    });

    await test.step("5. Your story: I edit one item, which sends it back to be confirmed", async () => {
      const headline = "Backend engineer who builds reliable APIs and the platforms they run on";
      await page.getByRole("button", { name: `Edit: ${headline}` }).click();
      await page.getByLabel("Headline", { exact: true }).fill("Backend engineer who builds reliable, well-tested APIs and the platforms they run on");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("Backend engineer who builds reliable, well-tested APIs and the platforms they run on")).toBeVisible();
      await expect(page.getByText(`0 confirmed, ${PROPOSED_ITEMS} waiting for you.`)).toBeVisible();
    });

    await test.step("5. Your story: I drop one item that does not belong", async () => {
      await page.getByRole("button", { name: "Drop: React" }).click();
      await expect(page.getByRole("button", { name: "Drop: React" })).toHaveCount(0);
      await expect(page.getByText(`0 confirmed, ${PROPOSED_ITEMS - 1} waiting for you.`)).toBeVisible();
    });

    await test.step("5. Your story: I confirm everything else", async () => {
      const confirmButtons = page.getByRole("button", { name: /^Confirm/ });
      while ((await confirmButtons.count()) > 0) {
        const before = await confirmButtons.count();
        await confirmButtons.first().click();
        await expect.poll(() => confirmButtons.count()).toBeLessThan(before);
      }
      await expect(page.getByText(`All done. You confirmed ${PROPOSED_ITEMS - 1} items.`)).toBeVisible();
      await page.getByRole("button", { name: "Continue" }).click();
    });

    await test.step("6. Form answers: details from my resume are filled in; the pay I never gave is marked", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Form answers" })).toBeVisible();
      await expect(page.getByLabel("Full name")).toHaveValue("Alex Rivera");
      await expect(page.getByLabel("Email address")).toHaveValue("alex.rivera@example.com");
      await expect(page.getByLabel("Current employer (optional)")).toHaveValue("Northwind Logistics");

      await expect(page.getByText(/answers? (is|are) still needed: .*Expected base salary/)).toBeVisible();
      await snap(page, "06-setup-6-form-answers-missing-pay");
    });

    await test.step("6. Form answers: I answer what I can and leave the pay empty", async () => {
      await page.getByLabel("Notice period").fill("2 weeks");
      await page.getByLabel("Earliest start date").fill("2026-12-01");

      const unitedStates = page.getByRole("group", { name: "United States" });
      await unitedStates.getByLabel("Allowed to work here").selectOption("yes");
      await unitedStates.getByLabel("Needs sponsorship").selectOption("no");
      await unitedStates.getByLabel("Willing to relocate").selectOption("yes");
      const india = page.getByRole("group", { name: "India" });
      await india.getByLabel("Allowed to work here").selectOption("no");
      await india.getByLabel("Needs sponsorship").selectOption("yes");
      await india.getByLabel("Willing to relocate").selectOption("no");

      // Exactly one answer is still marked "Needs your answer", and it sits next to the pay.
      const stillNeeded = page.getByText("Needs your answer");
      await expect(stillNeeded).toHaveCount(1);
      await expect(stillNeeded.locator("xpath=preceding-sibling::label")).toHaveText("Expected yearly pay");
      await page.getByRole("button", { name: "Save and continue" }).click();
    });

    await test.step("7. Targets: I say what I am looking for", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Your targets" })).toBeVisible();
      await page.getByLabel("Job titles you want").fill("Backend Engineer\nPlatform Engineer\nSoftware Engineer");
      await page.getByRole("checkbox", { name: "United States" }).check();
      await page.getByRole("checkbox", { name: "Remote" }).check();
      await page.getByLabel("Most years of experience a job may ask for").fill("4");
      await page.getByLabel("Roles to avoid").fill("QA\nSDET\nTest Engineer\nQuality Engineer");
      await page.getByRole("button", { name: "Save and continue" }).click();
    });

    await test.step("8. Finish: the summary is honest about the one answer still missing", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "You are ready" })).toBeVisible();
      await snap(page, "07-setup-8-finish");
      await expect(page.getByText(`${PROPOSED_ITEMS - 1} items in your story are confirmed.`)).toBeVisible();
      await expect(page.getByText("1 answer is still missing. You can add it later in Profile.")).toBeVisible();
      await page.getByRole("button", { name: "Finish setup" }).click();
    });

    await test.step("Today: setup is done and Find jobs is waiting", async () => {
      await expect(page).toHaveURL(/\/today$/);
      await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Find jobs" })).toBeEnabled();
    });

    await test.step("what I set up works: Find jobs uses my targets and my confirmed story", async () => {
      await page.getByRole("button", { name: "Find jobs" }).click(); // the usage notice was read in step 4
      const review = page.getByRole("region", { name: "Needs you" }).getByTestId("needs-you-item").filter({ hasText: "Ready to review" });
      await expect(review).toHaveCount(2);

      await review.filter({ hasText: "Acme Cloud" }).getByRole("link", { name: "Review" }).click();
      const resume = page.getByRole("article", { name: "Resume preview" });
      await expect(resume).toContainText("Backend engineer who builds reliable, well-tested APIs"); // my edit
      await expect(resume).toContainText("Python, TypeScript, Go, PostgreSQL, Redis, Docker, Kubernetes, AWS, Terraform");
      await expect(resume).not.toContainText("React"); // the item I dropped
    });
  });

  test("on the resume step, a file that cannot be read is explained next to it, and choosing another file clears it", async ({ page, startServer }) => {
    const server = await startServer({ seed: "none" });
    await server.api("/api/settings/folder", { body: { path: server.personFolder } });
    await server.api("/api/settings", { method: "PUT", body: { usageNoticeSeen: true } });
    await page.goto(`${server.origin}/setup/4#token=${server.token}`);
    const resumeInput = page.getByLabel("Your resume", { exact: true });
    const readButton = page.getByRole("button", { name: "Read my resume" });
    const problem = page.getByRole("alert");

    await test.step("with no file yet, Read my resume and Continue are off, and Continue says why", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Add your resume" })).toBeVisible();
      await expect(readButton).toBeDisabled();
      await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
      await expect(page.getByText("Add your resume and read it to continue.")).toBeVisible();
    });

    await test.step("a chosen file shows its name with Change and Remove, and Read my resume turns on", async () => {
      await resumeInput.setInputFiles(brokenResume("truncated.pdf"));
      await expect(page.getByText("truncated.pdf")).toBeVisible();
      await expect(page.getByRole("button", { name: "Change truncated.pdf" })).toBeVisible();
      await expect(readButton).toBeEnabled();
      await expect(page.getByText("Choose Read my resume to continue.")).toBeVisible();
    });

    await test.step("a damaged file is called damaged, with what to do about it", async () => {
      await readButton.click();
      await expect(problem).toContainText("This file looks damaged or incomplete.");
      await expect(problem).toContainText("Export your resume again as a PDF and choose the new file.");
      await snap(page, "04b-setup-4-resume-damaged");
    });

    await test.step("Remove puts the empty box back and clears the message", async () => {
      await page.getByRole("button", { name: "Remove truncated.pdf" }).click();
      await expect(problem).toHaveCount(0);
      await expect(readButton).toBeDisabled();
    });

    await test.step("a password-protected PDF is called protected, and choosing another file clears the message", async () => {
      await resumeInput.setInputFiles(PASSWORD_PROTECTED_PDF);
      await readButton.click();
      await expect(problem).toContainText("This PDF is protected with a password.");

      await resumeInput.setInputFiles(RESUME_PDF);
      await expect(problem).toHaveCount(0);
    });

    await test.step("a text file named .png is not a PDF or a Word file", async () => {
      await resumeInput.setInputFiles(brokenResume("text-file.png"));
      await readButton.click();
      await expect(problem).toContainText("This file is not a PDF or a Word file.");
      await expect(problem).toContainText("Choose a PDF or a Word (.docx) file.");
    });

    await test.step("a good file is read, the success line shows, and Continue opens", async () => {
      await resumeInput.setInputFiles(RESUME_PDF);
      await readButton.click();
      await expect(page.getByText("Your resume has been read. Next, check what we found.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
      await expect(page.getByText("Add your resume and read it to continue.")).toHaveCount(0);
    });
  });

  test("if I skip ahead before setup is finished, Today asks me to finish setting up", async ({ page, startServer }) => {
    const server = await startServer({ seed: "none" });
    await page.goto(`${server.origin}/today#token=${server.token}`);

    await expect(page.getByRole("heading", { name: "Finish setting up" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Find jobs" })).toHaveCount(0);
    await page.getByRole("link", { name: "Continue setup" }).click();
    await expect(page).toHaveURL(/\/setup\/1$/);
    await expect(page.getByRole("heading", { level: 1, name: "Welcome to Jobgoblin" })).toBeVisible();
  });

  test("what I confirmed is what the app knows: Profile shows the story, the answers and the targets", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera" });
    await page.goto(server.url);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Profile" }).click();

    await test.step("Your story lists the confirmed items", async () => {
      await expect(page.getByRole("tab", { name: "Your story", selected: true })).toBeVisible();
      await expect(page.getByText("Software Engineer", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Northwind Logistics").first()).toBeVisible();
    });

    await test.step("Form answers marks the pay that is still missing", async () => {
      await page.getByRole("tab", { name: "Form answers" }).click();
      await expect(page.getByText(/1 answer is still needed: .*Expected base salary/)).toBeVisible();
      await expect(page.getByLabel("Full name")).toHaveValue("Alex Rivera");
    });

    await test.step("Targets keep the roles to avoid", async () => {
      await page.getByRole("tab", { name: "Targets" }).click();
      await expect(page.getByLabel("Roles to avoid")).toHaveValue(/QA\nSDET/);
    });

    await test.step("a number that makes no sense is explained in plain words, and nothing is saved", async () => {
      await page.getByLabel("Most years of experience a job may ask for").fill("-1");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("Enter a whole number, zero or more.")).toBeVisible();
      await expect(page.getByText("Saved", { exact: true })).toHaveCount(0);
    });
  });
});
