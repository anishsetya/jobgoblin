// Steps that several user stories start with, written the way a person does them in the dashboard.
// Each helper uses roles and visible text, never ids, so the stories keep reading like the stories they are.
import { expect, type Locator, type Page } from "@playwright/test";

export const ACME = "Backend Engineer at Acme Cloud";
export const BRIGHTPATH = "Platform Engineer at Brightpath";
export const COPPERLEAF = "Software Engineer, Applied AI at Copperleaf AI";

// Today, with Alex already set up: press Find jobs and wait until Acme Cloud and Brightpath wait for review.
// (The usage notice must already be marked as read, see SeedOptions.usageNoticeSeen.)
export async function findJobsAndWaitForReview(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Find jobs" }).click();
  await expect(needsYouItem(page, ACME)).toContainText("Ready to review");
  await expect(needsYouItem(page, BRIGHTPATH)).toContainText("Ready to review");
  await expect(needsYouItem(page, COPPERLEAF)).toContainText("Long shot");
}

// One entry of the Needs you list, found by its title ("Backend Engineer at Acme Cloud").
export function needsYouItem(page: Page, title: string): Locator {
  return page.getByRole("region", { name: "Needs you" }).getByTestId("needs-you-item").filter({ hasText: title });
}

export async function openReview(page: Page, title: string): Promise<string> {
  await needsYouItem(page, title).getByRole("link", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/review\/[\w-]+$/);
  return applicationIdFromUrl(page);
}

// The id in /review/<id>, /apply/<id> or /apps/<id>.
export function applicationIdFromUrl(page: Page): string {
  const match = /\/(?:review|apply|apps)\/([\w-]+)$/.exec(new URL(page.url()).pathname);
  if (match?.[1] === undefined) throw new Error(`There is no application id in ${page.url()}`);
  return match[1];
}

export async function goToToday(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Today" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
}

export async function goToPipeline(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pipeline" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pipeline" })).toBeVisible();
}
