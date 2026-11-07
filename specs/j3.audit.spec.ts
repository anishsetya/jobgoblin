// J3: changing my mind. Skip and undo; request an edit; press A by accident; mark "I submitted" by mistake; withdraw.
// For each: can it be undone, and is the way back findable? The app is set up through the wizard UI (US only).
import type { Page } from "@playwright/test";
import { test, expect } from "./auditFixtures";
import { writeEvidence } from "./common";
import { auditPath } from "./paths";
import { finding } from "./record";
import { completeWizardViaUi } from "./wizard";
import { ACME, BRIGHTPATH, COPPERLEAF, findJobsAndWaitForReview, goToPipeline, needsYouItem, openReview } from "../support/flows";
import { findApplicationId } from "../support/seed";
import { waitUntilNoRunIsActive } from "../support/waits";

async function whatCanIDo(page: Page): Promise<{ buttons: string[]; links: string[]; statusOptions: string[]; text: string }> {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Loading...")).toHaveCount(0);
  await page.waitForTimeout(500);
  const buttons = (await page.getByRole("button").allTextContents()).map((t) => t.trim()).filter(Boolean);
  const links = (await page.locator("main").getByRole("link").allTextContents()).map((t) => t.trim()).filter(Boolean);
  const select = page.getByLabel("New status");
  const statusOptions = (await select.count()) > 0 ? (await select.locator("option").allTextContents()).filter((t) => t !== "Choose a status") : [];
  const text = (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 700);
  return { buttons, links, statusOptions, text };
}

test("J3: changing my mind", async ({ page, startServer }) => {
  const server = await startServer({ seed: "none" });
  await completeWizardViaUi(page, server);
  await findJobsAndWaitForReview(page);
  const evidence: Record<string, unknown> = {};

  // ---- a. skip, then undo
  await test.step("a. Skip Brightpath with the S key; what tells her it can be undone?", async () => {
    await openReview(page, BRIGHTPATH);
    await page.getByRole("heading", { level: 1, name: "Platform Engineer" }).click();
    await page.keyboard.press("s");
    await expect(page).toHaveURL(/\/review\/|\/today$/);
    await page.waitForTimeout(800);
    const afterSkipScreen = await page.locator("body").innerText();
    await page.screenshot({ path: auditPath("screens", "j3", "a1-after-skip.png"), fullPage: true });
    evidence.skipImmediateScreenMentionsUndo = /undo/i.test(afterSkipScreen);
    evidence.skipImmediateUrl = page.url();
    // Where could she find it? Today, then Pipeline, then the card, then the page.
    await page.goto(`${server.origin}/today`);
    const todayHasIt = (await needsYouItem(page, BRIGHTPATH).count()) > 0;
    const todayText = await page.locator("main").innerText();
    evidence.todayMentionsSkipped = /skipped/i.test(todayText);
    evidence.brightpathStillOnToday = todayHasIt;
    await goToPipeline(page);
    const board = await page.locator("main").innerText();
    evidence.pipelineShowsSkipped = /Skipped/.test(board);
    await page.screenshot({ path: auditPath("screens", "j3", "a2-pipeline-after-skip.png"), fullPage: true });
    await page.getByRole("link", { name: /Platform Engineer/ }).click();
    const canDo = await whatCanIDo(page);
    evidence.skippedPageActions = canDo;
    await page.screenshot({ path: auditPath("screens", "j3", "a3-skipped-application.png"), fullPage: true });
    await page.getByRole("button", { name: "Undo skip" }).click();
    await expect(page.getByText("Awaiting approval", { exact: true }).first()).toBeVisible();
    evidence.undoSkipWorked = true;
  });

  // ---- b. request an edit, then look for the old version
  await test.step("b. Request an edit; is the earlier version still there?", async () => {
    await page.goto(`${server.origin}/today`);
    const acmeId = await openReview(page, ACME);
    await page.getByRole("button", { name: "Request edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Request an edit" });
    await dialog.getByLabel("What should change?").fill("Lead with the Python work.");
    await dialog.getByRole("button", { name: "Send request" }).click();
    await waitUntilNoRunIsActive(server, 120_000);
    await page.goto(`${server.origin}/apps/${acmeId}`);
    const versions = page.getByRole("region", { name: "Resume versions" });
    await expect(versions.getByRole("listitem")).toHaveCount(2);
    const versionButtons = await versions.getByRole("button").allTextContents();
    evidence.versionControls = versionButtons;
    evidence.versionsText = (await versions.innerText()).replace(/\s+/g, " ");
    await page.screenshot({ path: auditPath("screens", "j3", "b1-versions.png"), fullPage: true });
    evidence.canGoBackToOlderVersion = versionButtons.some((t) => /use|restore|make current|go back|revert/i.test(t));
  });

  // ---- c. A pressed by accident; d. wrong "I submitted"; e. withdraw
  const brightpathId = await findApplicationId(server, "Brightpath", "Platform Engineer");
  const copperId = await findApplicationId(server, "Copperleaf AI", "Software Engineer, Applied AI");
  void copperId;
  await test.step("c. Press A by accident on Brightpath, then look for a way back", async () => {
    await page.goto(`${server.origin}/review/${brightpathId}`);
    await page.getByRole("heading", { level: 1, name: "Platform Engineer" }).click();
    await page.keyboard.press("a");
    await page.waitForTimeout(1200);
    await waitUntilNoRunIsActive(server, 120_000);
    await page.goto(`${server.origin}/apps/${brightpathId}`);
    evidence.afterAccidentalApprove = await whatCanIDo(page);
    await page.screenshot({ path: auditPath("screens", "j3", "c1-approved-by-accident.png"), fullPage: true });
  });

  await test.step("d. Mark 'I submitted' by mistake, then look for a way back", async () => {
    await page.goto(`${server.origin}/apply/${brightpathId}`);
    await page.getByRole("button", { name: "I submitted" }).click();
    const dialog = page.getByRole("dialog", { name: "Record that you applied" });
    await page.screenshot({ path: auditPath("screens", "j3", "d1-submitted-dialog.png"), fullPage: true });
    evidence.submittedDialogText = (await dialog.innerText()).replace(/\s+/g, " ");
    await dialog.getByLabel("Web address of the confirmation page").fill("https://example.invalid/confirm");
    await dialog.getByRole("button", { name: "Record as applied" }).click();
    await expect(page).toHaveURL(new RegExp(`/apps/${brightpathId}$`));
    evidence.afterWrongSubmitted = await whatCanIDo(page);
    await page.screenshot({ path: auditPath("screens", "j3", "d2-after-wrong-submitted.png"), fullPage: true });
  });

  await test.step("e. Withdraw it, then look for a way back", async () => {
    await page.getByRole("button", { name: "Withdraw" }).click();
    await page.getByRole("dialog", { name: "Withdraw this application?" }).getByRole("button", { name: "Withdraw" }).click();
    await expect(page.getByText("Withdrawn", { exact: true }).first()).toBeVisible();
    evidence.afterWithdraw = await whatCanIDo(page);
    await page.screenshot({ path: auditPath("screens", "j3", "e1-withdrawn.png"), fullPage: true });
    // Can the same job be applied to again?
    evidence.pipelineAfterWithdraw = await server.api<{ title: string; status: string }[]>("/api/pipeline");
  });

  writeEvidence("j3-evidence.json", evidence);

  // ---- judgement
  const after = (key: string) => evidence[key] as { buttons: string[]; links: string[]; statusOptions: string[]; text: string };
  const canUnapprove = after("afterAccidentalApprove").buttons.some((t) => /undo|un-?approve|cancel approval|take back/i.test(t));
  const canUnsubmit = after("afterWrongSubmitted").statusOptions.some((t) => /not (actually )?applied|undo|mistake|Approved/i.test(t)) || after("afterWrongSubmitted").buttons.some((t) => /undo|not applied/i.test(t));
  const canRestoreWithdrawn = after("afterWithdraw").buttons.some((t) => /reopen|restore|undo|apply again/i.test(t)) || after("afterWithdraw").statusOptions.length > 0;
  const canGoBackVersion = Boolean(evidence.canGoBackToOlderVersion);
  const skipUndoShown = Boolean(evidence.skipImmediateScreenMentionsUndo);

  if (!canUnapprove) {
    finding({
      id: "J3-1",
      severity: "P2",
      title: "An approval cannot be taken back; the only exit after an accidental A is Withdraw, which closes the application",
      persona: "Both",
      area: "Application page",
      prd: "A1-A3",
      expected: "A way to un-approve while nothing has been sent.",
      actual: `Page after accidental approve: buttons ${JSON.stringify(after("afterAccidentalApprove").buttons)}.`,
      evidence: [auditPath("j3-evidence.json"), auditPath("screens", "j3", "c1-approved-by-accident.png")],
      suspectedFile: "apps/dashboard/src/screens/application/ApplicationActionBar.tsx; packages/server/src/services/applicationActions.ts (same root cause as H4)",
      wrong: "product",
    });
  }
  if (!canUnsubmit) {
    finding({
      id: "J3-2",
      severity: "P2",
      title: "'I submitted' recorded by mistake cannot be undone; Applied only moves forward (assessment, phone, interview, rejected, no reply) or Withdraw",
      persona: "Both",
      area: "Application page / I submitted",
      prd: "A4, U4, K1 ('Applied means the confirmation was seen')",
      expected: "A way to say 'I did not actually apply' so Applied keeps meaning applied.",
      actual: `After a wrong 'I submitted': offered moves ${JSON.stringify(after("afterWrongSubmitted").statusOptions)}; buttons ${JSON.stringify(after("afterWrongSubmitted").buttons)}.`,
      evidence: [auditPath("j3-evidence.json"), auditPath("screens", "j3", "d2-after-wrong-submitted.png")],
      suspectedFile: "packages/core (status transitions: Applied has no way back), apps/dashboard/src/screens/application/StatusChangeCard.tsx",
      wrong: "product",
    });
  }
  if (!canRestoreWithdrawn) {
    finding({
      id: "J3-3",
      severity: "P3",
      title: "A withdrawn application cannot be reopened",
      persona: "Both",
      area: "Application page",
      prd: "K1",
      expected: "Either a Reopen button, or the page says how to add the job again.",
      actual: `After withdraw: buttons ${JSON.stringify(after("afterWithdraw").buttons)}, moves ${JSON.stringify(after("afterWithdraw").statusOptions)}.`,
      evidence: [auditPath("j3-evidence.json"), auditPath("screens", "j3", "e1-withdrawn.png")],
      wrong: "product",
    });
  }
  if (!canGoBackVersion) {
    finding({
      id: "J3-4",
      severity: "P3",
      title: "After Request edit, the earlier resume version can be downloaded but not made current again",
      persona: "Alex",
      area: "Application page > Resume versions",
      prd: "T2",
      expected: "'Use this version' on an older version.",
      actual: `Version controls: ${JSON.stringify(evidence.versionControls)}`,
      evidence: [auditPath("j3-evidence.json"), auditPath("screens", "j3", "b1-versions.png")],
      wrong: "product",
    });
  }
  if (!skipUndoShown) {
    finding({
      id: "J3-5",
      severity: "P3",
      title: "Skipping gives no 'Undo' on the screen it takes you to; the way back is Pipeline > the card > Undo skip",
      persona: "Maya",
      area: "Review after S / Skip",
      prd: "A2 ('skip is not final')",
      expected: "An Undo right after skipping.",
      actual: `Right after S the page was ${String(evidence.skipImmediateUrl)} and did not mention Undo. Skipped page offers: ${JSON.stringify((evidence.skippedPageActions as { buttons: string[] }).buttons)}. Today mentions skipped: ${String(evidence.todayMentionsSkipped)}; Pipeline shows Skipped: ${String(evidence.pipelineShowsSkipped)}.`,
      evidence: [auditPath("j3-evidence.json"), auditPath("screens", "j3", "a1-after-skip.png"), auditPath("screens", "j3", "a2-pipeline-after-skip.png")],
      wrong: "product",
    });
  }
  void COPPERLEAF;
});

