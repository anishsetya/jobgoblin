// Drives the setup wizard through the UI as Maya would, so a journey can start from an empty app (seed "none")
// without skipping setup. Chooses the United States only (so the three demo jobs are reachable) and answers
// every question the screen asks. Returns when Today is open.
import { expect, type Page } from "@playwright/test";
import type { TestServer } from "../support/server";
import { RESUME_PDF } from "../support/seed";

export type WizardOptions = {
  regions?: ("United States" | "India" | "Remote")[]; // default: United States only
  phone?: string;
  pay?: string;
};

export async function completeWizardViaUi(page: Page, server: TestServer, options: WizardOptions = {}): Promise<void> {
  const regions = options.regions ?? ["United States"];
  await page.goto(server.url);
  await expect(page.getByRole("heading", { level: 1, name: "Welcome to Jobgoblin" })).toBeVisible();
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("button", { name: "Continue" }).click(); // Connect
  await page.getByLabel("Folder", { exact: true }).fill(server.personFolder);
  await page.getByRole("button", { name: "Use this folder" }).click();
  await expect(page.getByText(server.personFolder)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Your resume", { exact: true }).setInputFiles(RESUME_PDF);
  await page.getByRole("button", { name: "Read my resume" }).click();
  await page.getByRole("dialog", { name: "Before your first run" }).getByRole("button", { name: "I understand, continue" }).click();
  await expect(page.getByText("Your resume has been read. Next, check what we found.")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Continue" }).click();

  const everyConfirm = page.getByRole("button", { name: /^Confirm/ });
  await expect(everyConfirm.first()).toBeVisible({ timeout: 30_000 }); // the story has loaded
  for (let guard = 0; guard < 80; guard += 1) {
    const before = await everyConfirm.count();
    if (before === 0) break;
    const groupButton = page.getByRole("button", { name: /^Confirm all/ });
    await ((await groupButton.count()) > 0 ? groupButton.first() : everyConfirm.first()).click();
    await expect.poll(() => everyConfirm.count()).toBeLessThan(before);
  }  await expect(page.getByText(/^All done\. You confirmed \d+ items\.$/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Form answers" })).toBeVisible();
  if (options.phone !== undefined) await page.getByLabel("Phone number").fill(options.phone);
  await page.getByLabel("Notice period").fill("2 weeks");
  await page.getByLabel("Earliest start date").fill("2026-12-01");
  await page.getByLabel("Expected yearly pay").fill(options.pay ?? "120000");
  const us = page.getByRole("group", { name: "United States" });
  await us.getByLabel("Allowed to work here").selectOption("yes");
  await us.getByLabel("Needs sponsorship").selectOption("no");
  await us.getByLabel("Willing to relocate").selectOption("yes");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Your targets" })).toBeVisible();
  await page.getByLabel("Job titles you want").fill("Backend Engineer\nPlatform Engineer\nSoftware Engineer");
  for (const region of regions) await page.getByRole("checkbox", { name: region }).check();
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "You are ready" })).toBeVisible();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
}

