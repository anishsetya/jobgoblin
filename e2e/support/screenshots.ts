// Optional pictures of a happy-path run, for people who want to see what the tests saw.
// Set E2E_SCREENSHOTS_DIR to a folder and run the stories; without it every call here does nothing.
// (Playwright's own failure screenshots are separate: they are always on.)
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

export async function snap(page: Page, name: string): Promise<void> {
  const folder = process.env.E2E_SCREENSHOTS_DIR;
  if (folder === undefined || folder === "") return;
  fs.mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, `${name}.png`), fullPage: true });
}
