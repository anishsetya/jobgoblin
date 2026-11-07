// B follow-up: the wizard's Back button on step 5 (Your story) seemed to leave the person where they were.
import { test, expect } from "./auditFixtures";
import { writeEvidence } from "./common";
import { auditPath } from "./paths";
import { check } from "./record";
import { uploadResumeAndChooseFolder } from "../support/seed";
import { waitUntilNoRunIsActive } from "../support/waits";

test("B wizard: Back on Your story goes to the resume step", async ({ page, startServer }) => {
  const server = await startServer({ seed: "none" });
  await uploadResumeAndChooseFolder(server);
  await waitUntilNoRunIsActive(server);
  const results: Record<string, unknown> = {};
  await page.goto(`${server.origin}/setup/5#token=${server.token}`);
  await expect(page.getByRole("heading", { level: 1, name: "Your story" })).toBeVisible();
  const backs = page.getByRole("button", { name: "Back", exact: true });
  results.backButtonsOnStep5 = await backs.count();
  await backs.last().click();
  await page.waitForTimeout(2000);
  results.afterBack = { url: new URL(page.url()).pathname, heading: await page.getByRole("heading", { level: 1 }).first().innerText() };
  await page.screenshot({ path: auditPath("screens", "b", "wizard-back-from-story.png"), fullPage: true });
  // Is the resume step reachable directly, and what does it show once the resume has been read?
  await page.goto(`${server.origin}/setup/4`);
  await page.waitForTimeout(1500);
  results.step4Direct = { url: new URL(page.url()).pathname, heading: await page.getByRole("heading", { level: 1 }).first().innerText(), text: (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 300) };
  const evidence = writeEvidence("b2-wizard-back-from-story.json", results);
  check((results.afterBack as { url: string }).url === "/setup/4", {
    id: "B-wizard-back-from-story", severity: "P2", title: "On 'Your story' the Back button does not take the person back to the resume step", persona: "Maya", area: "Setup step 5", prd: "S1",
    expected: "Back opens step 4", actual: JSON.stringify(results), evidence: [evidence, auditPath("screens", "b", "wizard-back-from-story.png")], wrong: "unclear",
  });
});
