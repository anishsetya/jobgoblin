// Story 18 (issue #24; PRD "Errors say what happened and what to do"): "If Jobgoblin stops while a screen is
// open, every screen tells me so without a click, keeps the sidebar, and says what to do. After a restart, an
// old tab says how to get back in."
// This is the browser build, which `pnpm dev` and every story use. The desktop app closes with its server.
import type { Page } from "@playwright/test";
import { expectNoAccessibilityViolations } from "../support/axe";
import { expect, test } from "../support/fixtures";

const COULD_NOT_BE_REACHED = "Jobgoblin could not be reached.";
const KEEPS_TRYING = "This page keeps trying, and updates by itself when Jobgoblin is back.";
const OUT_OF_DATE = "This page is out of date.";
const OPEN_THE_NEW_LINK = "Open Jobgoblin again from the link it printed when it started.";
// Where the dashboard keeps this tab's key (apps/dashboard/src/api/token.ts).
const SESSION_STORAGE_KEY = "jobgoblin.session";
// The stream waits longer after each failed try, up to 30 seconds.
const LONGEST_WAIT_BETWEEN_TRIES_MS = 35_000;

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Main" });
}

function connectionBanner(page: Page) {
  return page.getByTestId("connection-banner");
}

// The error of a screen that could not open: the alert in the main area that offers Try again.
function screenError(page: Page) {
  return page.getByRole("main").getByRole("alert").filter({ has: page.getByRole("button", { name: "Try again" }) });
}

async function openToday(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
}

test.describe("As a job seeker, I am told when Jobgoblin cannot be reached, and what to do", () => {
  test("when Jobgoblin stops, Today says so by itself, and another screen keeps the sidebar and says the same", async ({
    page,
    startServer,
  }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await openToday(page, server.url);
    await expect(connectionBanner(page)).toHaveCount(0);

    await test.step("Jobgoblin stops while Today is open", async () => {
      await server.crash();
    });

    await test.step("Today says so without a click", async () => {
      await expect(connectionBanner(page)).toContainText(COULD_NOT_BE_REACHED);
      await expect(connectionBanner(page)).toContainText(KEEPS_TRYING);
    });

    await test.step("another screen keeps the sidebar and says Jobgoblin could not be reached", async () => {
      await sidebar(page).getByRole("link", { name: "Pipeline" }).click();

      await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "This screen could not open" })).toBeVisible();
      await expect(screenError(page)).toContainText(COULD_NOT_BE_REACHED);
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
      await expect(sidebar(page)).toBeVisible();
      await expect(connectionBanner(page)).toContainText(COULD_NOT_BE_REACHED);
      await expectNoAccessibilityViolations(page, "Pipeline after Jobgoblin stopped");
    });
  });

  test("after a short break, the banner goes by itself, and a screen that could not open opens again", async ({
    page,
    startServer,
  }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    // A break the page cannot tell from Jobgoblin stopping: its live updates and its screens' files get no answer.
    const blockLiveUpdates = () => page.route("**/api/events", (route) => route.abort("connectionrefused"));
    const blockScreenFiles = () => page.route("**/assets/**", (route) => route.abort("connectionrefused"));

    await test.step("while the live updates get no answer, Today says Jobgoblin could not be reached", async () => {
      await blockLiveUpdates();
      await openToday(page, server.url);
      await expect(connectionBanner(page)).toContainText(COULD_NOT_BE_REACHED);
    });

    await test.step("a screen whose file cannot be fetched says why, inside the frame", async () => {
      await blockScreenFiles();
      await sidebar(page).getByRole("link", { name: "Settings" }).click();
      await expect(screenError(page)).toContainText(COULD_NOT_BE_REACHED);
      await expect(sidebar(page)).toBeVisible();
    });

    await test.step("once Jobgoblin answers again, the banner goes by itself", async () => {
      await page.unrouteAll();
      await expect(connectionBanner(page)).toHaveCount(0, { timeout: LONGEST_WAIT_BETWEEN_TRIES_MS });
    });

    await test.step("Try again opens the screen", async () => {
      await screenError(page).getByRole("button", { name: "Try again" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    });

    await test.step("a screen I left while it could not open, opens when I come back to it", async () => {
      await blockScreenFiles();
      await sidebar(page).getByRole("link", { name: "Pipeline" }).click();
      await expect(screenError(page)).toContainText(COULD_NOT_BE_REACHED);

      await page.unrouteAll();
      await sidebar(page).getByRole("link", { name: "Today" }).click();
      await sidebar(page).getByRole("link", { name: "Pipeline" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Pipeline" })).toBeVisible();
    });
  });

  test("after a restart, an old tab says it is out of date, and the new link gets back in", async ({ page, startServer }) => {
    const first = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await openToday(page, first.url);
    await first.crash();
    const second = await startServer({ reuseDataOf: first });

    await test.step("the old tab is reloaded, still holding the key of the Jobgoblin that stopped", async () => {
      // Every start makes a new key; a test server also gets a new port. So the old key goes into a tab on the new
      // address, which is what reloading an old tab on the same address amounts to.
      await page.goto(`${second.origin}/today`);
      await page.evaluate(({ key, oldToken }) => window.sessionStorage.setItem(key, oldToken), {
        key: SESSION_STORAGE_KEY,
        oldToken: first.token,
      });
      await page.reload();
    });

    await test.step("it says the page is out of date, and how to get back in", async () => {
      await expect(connectionBanner(page)).toContainText(OUT_OF_DATE);
      await expect(connectionBanner(page)).toContainText(OPEN_THE_NEW_LINK);
      await expect(sidebar(page)).toBeVisible();
    });

    await test.step("the link the new Jobgoblin printed gets back in", async () => {
      await openToday(page, second.url);
      await expect(connectionBanner(page)).toHaveCount(0);
    });
  });
});
