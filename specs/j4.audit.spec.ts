// J4: changing my facts. Change targets; drop a story item that a resume uses; add a banned word after tailoring;
// change the phone after approving. Does the next search change, what happens to resumes already tailored or
// approved, and are the approved PDF's bytes unchanged?
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./auditFixtures";
import { writeEvidence } from "./common";
import { auditPath } from "./paths";
import { finding } from "./record";
import { completeWizardViaUi } from "./wizard";
import { ACME, BRIGHTPATH, findJobsAndWaitForReview, needsYouItem, openReview } from "../support/flows";
import { waitUntilNoRunIsActive } from "../support/waits";

type Detail = {
  application: { status: string; folder: string | null };
  approval: { pdfSha256: string; voidedAt: string | null } | null;
  resume: { shortId: string; body: unknown } | null;
  actions: { canApprove: boolean; canMarkSubmitted: boolean };
};

const sha = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function goProfile(page: Page, tab: string): Promise<void> {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Profile" }).click();
  await page.getByRole("tab", { name: tab }).click();
}

test("J4: changing my facts", async ({ page, startServer }) => {
  const server = await startServer({ seed: "none" });
  const log: Record<string, unknown> = {};

  // ---------------- targets: India only first (nothing in the demo is in India), then add the United States.
  await completeWizardViaUi(page, server, { regions: ["India"] });
  await page.getByRole("button", { name: "Find jobs" }).click();
  await waitUntilNoRunIsActive(server, 120_000);
  await page.reload();
  log.todayAfterIndiaOnly = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  log.pipelineAfterIndiaOnly = (await server.api<unknown[]>("/api/pipeline")).length;

  await goProfile(page, "Targets");
  await page.getByRole("checkbox", { name: "India" }).uncheck();
  await page.getByRole("checkbox", { name: "United States" }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Today" }).click();
  await page.getByRole("button", { name: "Find jobs" }).click();
  await waitUntilNoRunIsActive(server, 120_000);
  await page.reload();
  log.todayAfterSwitchToUs = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  log.pipelineAfterSwitchToUs = (await server.api<unknown[]>("/api/pipeline")).length;
  await page.screenshot({ path: auditPath("screens", "j4", "01-after-switching-targets-to-us.png"), fullPage: true });
  const nextSearchChanged = (log.pipelineAfterSwitchToUs as number) > (log.pipelineAfterIndiaOnly as number);
  expect.soft(nextSearchChanged, "P4: a change to targets changes the next search").toBe(true);
  if (!nextSearchChanged) {
    finding({
      id: "J4-1",
      severity: "P1",
      title: "Changing Targets does not change the next search: jobs ruled out by the old targets never come back",
      persona: "Both",
      area: "Targets / Find jobs",
      prd: "P4 ('done when': a change to targets changes the next search), D3",
      expected: "After India -> United States, Find jobs shows the US jobs.",
      actual: `Pipeline rows after India-only search: ${String(log.pipelineAfterIndiaOnly)}; after switching to United States and searching again: ${String(log.pipelineAfterSwitchToUs)}. Today: ${String(log.todayAfterSwitchToUs)}`,
      steps: "Wizard with India only; Find jobs; Profile > Targets: untick India, tick United States; Find jobs.",
      evidence: [auditPath("j4-evidence.json"), auditPath("screens", "j4", "01-after-switching-targets-to-us.png")],
      suspectedFile: "packages/server/src/services/feeds.ts:71-79 (insertJobIfNew keeps the old filteredReason; the filter is never re-run for stored jobs)",
      wrong: "product",
    });
    // Minimum workaround to see the later stages: a fresh app (the person would have to delete everything).
    await page.goto(`${server.origin}/profile/targets`);
  }

  // ---------------- the stages below need jobs. If the app did not recover, Alex-style seeding is used (said in the finding).
  if (!nextSearchChanged) {
    const { seedVariant } = await import("./seedVariants");
    const second = await startServer({ seed: "none" });
    await seedVariant(second, { usageNoticeSeen: true });
    await page.goto(second.url);
    await runRest(page, second, log);
  } else {
    await runRest(page, server, log);
  }
  writeEvidence("j4-evidence.json", log);
});

async function runRest(page: Page, server: Awaited<ReturnType<Parameters<Parameters<typeof test>[1]>[0]["startServer"]>>, log: Record<string, unknown>): Promise<void> {
  await findJobsAndWaitForReview(page);

  // approve Acme with the button; wait for the answers
  const acmeId = await openReview(page, ACME);
  await page.getByRole("button", { name: "Approve" }).click();
  await waitUntilNoRunIsActive(server, 120_000);
  const approved = await server.api<Detail>(`/api/apps/${acmeId}`);
  const folder = path.join(server.personFolder, ...(approved.application.folder ?? "").split("/"));
  const pdf = path.join(folder, "Alex Rivera - Resume.pdf");
  const shaApproved = approved.approval?.pdfSha256 ?? "";
  log.approvedPdfShaOnApproval = shaApproved;
  log.approvedPdfFileShaOnApproval = fs.existsSync(pdf) ? sha(pdf) : "(missing)";

  const brightpathId = (await server.api<{ id: string; company: string }[]>("/api/pipeline")).find((row) => row.company === "Brightpath")?.id ?? "";
  const brightBefore = await server.api<Detail>(`/api/apps/${brightpathId}`);
  log.brightpathVersionBefore = brightBefore.resume?.shortId;

  // ---- banned word added after tailoring (Brightpath's draft uses Kubernetes)
  await goProfile(page, "Banned words");
  const box = page.getByRole("textbox", { name: "Banned words" });
  const existing = await box.inputValue();
  await box.fill(`${existing}\nKubernetes`.trim());
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Saved/).first()).toBeVisible();
  await page.goto(`${server.origin}/review/${brightpathId}`);
  await expect(page.getByRole("article", { name: "Resume preview" })).toBeVisible();
  const brightText = await page.locator("main").innerText();
  log.brightpathReviewHasBannedWord = /Kubernetes/.test(await page.getByRole("article", { name: "Resume preview" }).innerText());
  log.brightpathReviewWarnsBanned = /banned/i.test(brightText);
  const approveButton = page.getByRole("button", { name: "Approve" });
  log.approveEnabledWithBannedWord = await approveButton.isEnabled();
  await page.screenshot({ path: auditPath("screens", "j4", "04-review-with-banned-word.png"), fullPage: true });
  let approvedBanned = false;
  if (await approveButton.isEnabled()) {
    await approveButton.click();
    await page.waitForTimeout(1500);
    log.approveAnswerBanned = (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 400);
    const afterApprove = await server.api<Detail>(`/api/apps/${brightpathId}`);
    approvedBanned = afterApprove.application.status === "Approved";
    log.brightpathStatusAfterApproveWithBannedWord = afterApprove.application.status;
    await page.screenshot({ path: auditPath("screens", "j4", "05-after-approve-with-banned-word.png"), fullPage: true });
  }
  // take the banned word out again so the next question is not hidden by it
  await goProfile(page, "Banned words");
  await box.fill(existing);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Saved/).first()).toBeVisible();

  // ---- drop a story item that the Brightpath draft uses, then try to approve the draft
  await goProfile(page, "Your story");
  await page.getByRole("button", { name: /^Drop: Built a shipment-tracking API/ }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: auditPath("screens", "j4", "02-after-drop-story-item.png"), fullPage: true });
  const story = await server.api<{ id: string; status: string; data: { text?: string } }[]>("/api/story");
  log.droppedItemStatus = story.find((item) => /shipment-tracking API/.test(item.data.text ?? ""))?.status;
  const acmeAfterDrop = await server.api<Detail>(`/api/apps/${acmeId}`);
  log.acmeAfterDrop = { status: acmeAfterDrop.application.status, voided: acmeAfterDrop.approval?.voidedAt, sha: acmeAfterDrop.approval?.pdfSha256 };
  await page.goto(`${server.origin}/review/${brightpathId}`);
  await expect(page.getByRole("article", { name: "Resume preview" })).toBeVisible();
  const brightReviewText = await page.getByRole("article", { name: "Resume preview" }).innerText();
  log.brightpathReviewStillHasDroppedItem = /shipment-tracking API/.test(brightReviewText);
  log.brightpathReviewWarns = /dropped|no longer|removed from your story|out of date|story changed/i.test(await page.locator("main").innerText());
  await page.screenshot({ path: auditPath("screens", "j4", "03-review-after-drop.png"), fullPage: true });
  let approvedWithDropped = false;
  const approveAgain = page.getByRole("button", { name: "Approve" });
  if (await approveAgain.isEnabled()) {
    await approveAgain.click();
    await page.waitForTimeout(2000);
    const afterDrop = await server.api<Detail>(`/api/apps/${brightpathId}`);
    approvedWithDropped = afterDrop.application.status === "Approved";
    log.brightpathStatusAfterApproveWithDroppedItem = afterDrop.application.status;
    log.brightpathApprovedResumeHasDroppedItem = JSON.stringify(afterDrop.resume?.body ?? "").includes("shipment-tracking API");
    log.approveAnswerDropped = (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 300);
    await page.screenshot({ path: auditPath("screens", "j4", "05b-after-approve-with-dropped-item.png"), fullPage: true });
  }
  // ---- phone changed after approving
  await goProfile(page, "Form answers");
  await page.getByLabel("Phone number").fill("+1 555 0199");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const acmeAfterPhone = await server.api<Detail>(`/api/apps/${acmeId}`);
  log.acmeAfterPhone = { status: acmeAfterPhone.application.status, voided: acmeAfterPhone.approval?.voidedAt, sha: acmeAfterPhone.approval?.pdfSha256 };
  log.approvedPdfFileShaAfterAllChanges = fs.existsSync(pdf) ? sha(pdf) : "(missing)";
  await page.goto(`${server.origin}/today`);
  log.todayAfterPhone = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  await page.screenshot({ path: auditPath("screens", "j4", "06-today-after-phone-change.png"), fullPage: true });
  void needsYouItem;
  void BRIGHTPATH;

  // ---- judgement
  const bytesSame = log.approvedPdfFileShaOnApproval === log.approvedPdfFileShaAfterAllChanges && log.approvedPdfFileShaOnApproval === shaApproved;
  expect.soft(bytesSame, "the approved PDF's bytes are unchanged").toBe(true);
  if (!bytesSame) {
    finding({
      id: "J4-P0",
      severity: "P0",
      title: "The approved resume PDF changed after approval",
      persona: "Both",
      area: "Approval",
      prd: "T2",
      expected: "Same bytes",
      actual: JSON.stringify({ shaApproved, onApproval: log.approvedPdfFileShaOnApproval, after: log.approvedPdfFileShaAfterAllChanges }),
      evidence: [auditPath("j4-evidence.json")],
      wrong: "product",
    });
  }
  if (approvedWithDropped) {
    finding({
      id: "J4-2",
      severity: "P0",
      title: "A story item the person dropped can still be approved into a resume",
      persona: "Both",
      area: "Review / approval",
      prd: "P2 ('only what I confirmed is ever used'), T1, truthfulness rule",
      expected: "Approve is refused, or the resume is re-made without the dropped item.",
      actual: `After dropping 'Built a shipment-tracking API...' (story status ${String(log.droppedItemStatus)}), the Brightpath draft still showed it (${String(log.brightpathReviewStillHasDroppedItem)}), Review warned: ${String(log.brightpathReviewWarns)}, and Approve moved it to ${String(log.brightpathStatusAfterApproveWithDroppedItem)}. Approved resume body still holds the item: ${String(log.brightpathApprovedResumeHasDroppedItem)}.`,
      steps: "Wizard; Find jobs; Profile > Your story > Drop that achievement; open Brightpath review; Approve.",
      evidence: [auditPath("j4-evidence.json"), auditPath("screens", "j4", "03-review-after-drop.png"), auditPath("screens", "j4", "05b-after-approve-with-dropped-item.png")],
      suspectedFile: "packages/server/src/services/approvals.ts (approve does not re-check the resume against the confirmed story)",
      wrong: "product",
    });
  } else if (log.brightpathReviewStillHasDroppedItem === true && log.brightpathReviewWarns === false) {
    finding({
      id: "J4-2",
      severity: "P2",
      title: "A dropped story item stays in a draft waiting for approval, with no warning on Review (Approve is refused only when clicked)",
      persona: "Both",
      area: "Review",
      prd: "P2, T1",
      expected: "Review says the draft is out of date.",
      actual: `Draft still shows the dropped item; Approve answer: "${String(log.approveAnswerDropped)}"`,
      evidence: [auditPath("j4-evidence.json"), auditPath("screens", "j4", "03-review-after-drop.png")],
      wrong: "product",
    });
  }
  if (approvedBanned) {
    finding({
      id: "J4-3",
      severity: "P0",
      title: "A resume containing a word added to Banned words afterwards was approved",
      persona: "Both",
      area: "Approval",
      prd: "P5, hard rule",
      expected: "Approve is refused naming the word.",
      actual: `Status became ${String(log.brightpathStatusAfterApproveWithBannedWord)}`,
      evidence: [auditPath("j4-evidence.json"), auditPath("screens", "j4", "05-after-approve-with-banned-word.png")],
      suspectedFile: "packages/server/src/services/approvals.ts",
      wrong: "product",
    });
  }
}
