// Story 11 (PRD "Accessibility", ARCHITECTURE.md section 12): "Everyone can use every screen: keyboard, screen
// reader and both color schemes."
// axe-core checks WCAG 2.1 A and AA on every screen, in the light and the dark color scheme, with real data on
// screen (a review waiting, an approved application, an applied one), not just empty states.
import { expectNoAccessibilityViolations } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { BRIGHTPATH, COPPERLEAF, findJobsAndWaitForReview, needsYouItem } from "../support/flows";
import { approveAndMarkApplied, approveThroughApi, findApplicationId, uploadResumeAndChooseFolder } from "../support/seed";
import { waitUntilNoRunIsActive } from "../support/waits";

const SCHEMES = ["light", "dark"] as const;

for (const colorScheme of SCHEMES) {
  test.describe(`In the ${colorScheme} color scheme`, () => {
    test.use({ colorScheme });

    test("every screen of the app has no WCAG 2.1 AA violations", async ({ page, startServer }) => {
      const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
      await page.goto(server.url);
      await expectNoAccessibilityViolations(page, "Today (before the first run)");

      await findJobsAndWaitForReview(page);

      // A paste adds Gridline Energy; it becomes Applied, so the Application page has its status form.
      await server.api("/api/jobs", { body: { url: "https://boards.greenhouse.io/gridline/jobs/4100" } });
      await waitUntilNoRunIsActive(server);
      const acmeId = await findApplicationId(server, "Acme Cloud", "Backend Engineer");
      const gridlineId = await findApplicationId(server, "Gridline Energy", "Backend Engineer");
      const brightpathId = await findApplicationId(server, "Brightpath", "Platform Engineer");
      const copperleafId = await findApplicationId(server, "Copperleaf AI", "Software Engineer, Applied AI");
      await approveThroughApi(server, acmeId);
      await approveAndMarkApplied(server, gridlineId);
      await waitUntilNoRunIsActive(server);

      const screens = [
        { name: "Today (with Needs you, Running and Done today)", path: "/today", ready: () => expect(needsYouItem(page, BRIGHTPATH)).toBeVisible() },
        { name: "Review", path: `/review/${brightpathId}`, ready: () => expect(page.getByRole("article", { name: "Resume preview" })).toBeVisible() },
        {
          name: "Open application",
          path: `/apply/${acmeId}`,
          ready: () => expect(page.getByRole("button", { name: "Copy Email address" })).toBeVisible(),
        },
        {
          name: "Pipeline (board)",
          path: "/pipeline",
          ready: () => expect(page.getByTestId("pipeline-card")).toHaveCount(5),
        },
        {
          name: "Pipeline (list)",
          path: "/pipeline?view=list",
          ready: () => expect(page.getByRole("table", { name: "Every application" })).toBeVisible(),
        },
        {
          name: "Application (applied, with the status form)",
          path: `/apps/${gridlineId}`,
          ready: () => expect(page.getByRole("button", { name: "Change status" })).toBeVisible(),
        },
        {
          name: "Application (a long shot)",
          path: `/apps/${copperleafId}`,
          ready: () => expect(page.getByRole("button", { name: "Tailor a resume" })).toBeVisible(),
        },
        { name: "Profile: Your story", path: "/profile/story", ready: () => expect(page.getByRole("tab", { name: "Your story", selected: true })).toBeVisible() },
        { name: "Profile: Form answers", path: "/profile/answers", ready: () => expect(page.getByLabel("Full name")).toBeVisible() },
        { name: "Profile: Targets", path: "/profile/targets", ready: () => expect(page.getByLabel("Job titles you want")).toBeVisible() },
        { name: "Profile: Banned words", path: "/profile/banned", ready: () => expect(page.getByRole("textbox", { name: "Banned words" })).toBeVisible() },
        { name: "Settings", path: "/settings", ready: () => expect(page.getByRole("button", { name: "Back up now" })).toBeVisible() },
      ];

      for (const screen of screens) {
        await test.step(screen.name, async () => {
          await page.goto(`${server.origin}${screen.path}`);
          await screen.ready();
          await expectNoAccessibilityViolations(page, screen.name);
        });
      }
    });

    test("every dialog of the app has no WCAG 2.1 AA violations", async ({ page, startServer }) => {
      const server = await startServer({ seed: "alex-rivera" }); // the usage notice is still to be read
      await page.goto(server.url);

      await test.step("the usage notice", async () => {
        await page.getByRole("button", { name: "Find jobs" }).click();
        await expect(page.getByRole("dialog", { name: "Before your first run" })).toBeVisible();
        await expectNoAccessibilityViolations(page, "Usage notice");
        await page.getByRole("button", { name: "Not now" }).click();
      });

      await test.step("Add a job, with its text fields shown", async () => {
        await server.api("/api/settings", { method: "PUT", body: { usageNoticeSeen: true } });
        await page.reload();
        await page.getByRole("button", { name: "Add a job" }).click();
        await page.getByRole("button", { name: "Paste the job text instead" }).click();
        await expect(page.getByLabel("Job description")).toBeVisible();
        await expectNoAccessibilityViolations(page, "Add a job");
      });
    });

    test("the dialogs that need an application have no WCAG 2.1 AA violations either", async ({ page, startServer }) => {
      const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
      await page.goto(server.url);
      await findJobsAndWaitForReview(page);
      const acmeId = await findApplicationId(server, "Acme Cloud", "Backend Engineer");
      const brightpathId = await findApplicationId(server, "Brightpath", "Platform Engineer");
      await approveThroughApi(server, acmeId);
      await waitUntilNoRunIsActive(server);

      async function checkDialog(openFrom: string, openWith: () => Promise<unknown>, dialogName: string): Promise<void> {
        await test.step(dialogName, async () => {
          await page.goto(`${server.origin}${openFrom}`);
          await openWith();
          await expect(page.getByRole("dialog", { name: dialogName })).toBeVisible();
          await expectNoAccessibilityViolations(page, dialogName);
          await page.keyboard.press("Escape");
          await expect(page.getByRole("dialog", { name: dialogName })).toBeHidden();
        });
      }

      await checkDialog("/review/" + brightpathId, () => page.getByRole("button", { name: "Request edit" }).click(), "Request an edit");
      await checkDialog("/apply/" + acmeId, () => page.getByRole("button", { name: "I submitted" }).click(), "Record that you applied");
      await checkDialog("/apps/" + acmeId, () => page.getByRole("button", { name: "Withdraw" }).click(), "Withdraw this application?");
      await checkDialog("/profile/story", () => page.getByRole("button", { name: "Add to your story" }).click(), "Add to your story");
      await checkDialog("/settings", async () => {
        await page.getByRole("button", { name: "Back up now" }).click();
        await page.getByRole("button", { name: /^Restore the backup from / }).first().click();
      }, "Restore this backup?");
    });

    test("every step of the setup wizard has no WCAG 2.1 AA violations", async ({ page, startServer }) => {
      const server = await startServer({ seed: "none" });
      await uploadResumeAndChooseFolder(server);
      await waitUntilNoRunIsActive(server);

      const steps = [
        { number: 1, title: "Welcome to Jobgoblin" },
        { number: 2, title: "Connect Claude" },
        { number: 3, title: "Choose your folder" },
        { number: 4, title: "Add your resume" },
        { number: 5, title: "Your story" },
        { number: 6, title: "Form answers" },
        { number: 7, title: "Your targets" },
        { number: 8, title: "You are ready" },
      ];

      await page.goto(server.url);
      for (const step of steps) {
        await test.step(`Step ${step.number}: ${step.title}`, async () => {
          await page.goto(`${server.origin}/setup/${step.number}`);
          await expect(page.getByRole("heading", { level: 1, name: step.title })).toBeVisible();
          if (step.number === 5) await expect(page.getByText("0 confirmed, 22 waiting for you.")).toBeVisible();
          await expectNoAccessibilityViolations(page, `Setup step ${step.number}`);
        });
      }
    });
  });
}
