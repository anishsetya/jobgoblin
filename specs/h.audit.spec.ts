// H1 to H4: the four hypotheses read in the code. Each test reproduces or disproves one with evidence.
import { test, expect } from "./auditFixtures";
import { writeEvidence } from "./common";
import { auditPath } from "./paths";
import { finding } from "./record";
import { seedVariant } from "./seedVariants";
import { ACME, findJobsAndWaitForReview, needsYouItem, openReview } from "../support/flows";
import { waitUntilNoRunIsActive } from "../support/waits";

const JOB_TEXT =
  "Remoteco is hiring a Backend Engineer. You will build Python services on PostgreSQL, deploy with Docker and Kubernetes on AWS, " +
  "and write tests. 2+ years of experience building backend services. This is a fully remote role.";

type Missing = { section: string; key: string; label: string };

// H1 and H3: step 6 asks about regions before step 7 chooses them, and the pay label differs from the data sheet's.
test("H1/H3: the wizard asks for work authorization and pay before it knows the regions, and names pay two ways", async ({ page, startServer }) => {
  const server = await startServer({ seed: "none" });
  await seedVariant(server, {
    usageNoticeSeen: true,
    finishSetup: false,
    mutateProfile: (profile) => {
      profile.workAuthorization = { regions: {} };
      profile.targets.regions = [];
      profile.employment.noticePeriod = "TODO";
      profile.employment.earliestStartDate = "TODO";
      profile.compensation = { expectedBase: "TODO" };
    },
  });
  await page.goto(`${server.origin}/setup/6#token=${server.token}`);
  await expect(page.getByRole("heading", { level: 1, name: "Form answers" })).toBeVisible();

  const step6 = await readFormAnswers(page);
  const apiMissing = (await server.api<{ missing: Missing[] }>("/api/profile")).missing;
  writeEvidence("h1-step6-state.json", { ...step6, apiMissing });
  await page.screenshot({ path: auditPath("screens", "h", "h1-step6.png"), fullPage: true });

  // H1 claims: (a) the summary names an item that is not on this screen; (b) fields are marked that the summary
  // does not count; (c) US and India are shown before anyone chose regions.
  const summaryNamesPlaces = /Where you want to work/.test(step6.summary);
  const placesFieldOnScreen = (await page.getByText("Where you want to work").count()) > 1; // the summary itself is one
  const marked = step6.marked;
  const countedInSummary = Number(/^(\d+) answers? (is|are) still needed/.exec(step6.summary)?.[1] ?? 0);
  if (summaryNamesPlaces && !placesFieldOnScreen) finding({
    id: "H1",
    severity: "P2",
    title: "Form answers step shows US and India before the person chose regions, and its summary names 'Where you want to work', which is not on that screen",
    persona: "Maya",
    area: "Setup wizard step 6 vs 7",
    prd: "S/P3 ('Every TODO is visible on one screen'), P4",
    expected: "The summary counts and names exactly the fields marked, and every named item can be answered on that screen; regions come before region-specific questions.",
    actual: `Summary: "${step6.summary}" (counts ${countedInSummary}); fields marked 'Needs your answer': ${marked}; region groups shown: ${step6.groups.join(", ")}; 'Where you want to work' field on screen: ${placesFieldOnScreen}; pay label: ${step6.payLabel.join(", ")}; pay named in summary: ${/pay|salary/i.test(step6.summary)}. Server missing keys: ${apiMissing.map((m) => m.key).join(", ")}`,
    steps: "Wizard step 6 with no regions chosen yet.",
    evidence: [auditPath("h1-step6-state.json"), auditPath("screens", "h", "h1-step6.png")],
    suspectedFile: "apps/dashboard/src/lib/answersDraft.ts:25 (DEFAULT_REGIONS US, IN) and packages/server/src/services/missingValues.ts:77-80; apps/dashboard/src/screens/setup/steps (order 6 before 7)",
    wrong: "product",
  });
  expect.soft(summaryNamesPlaces && !placesFieldOnScreen, "H1: every item the summary names can be answered on this screen").toBe(false);
  expect.soft(marked, "H1: the summary counts every field marked").toBe(countedInSummary);

  // H3: label drift. The form label vs the server's/data sheet's.
  const formPayLabel = step6.payLabel[0] ?? "";
  writeEvidence("h3-labels.json", { formPayLabel, serverLabels: apiMissing.map((m) => m.label), dataSheetLabel: "Expected base salary (packages/core/src/dataSheet.ts:63)" });
});

test("H3: after regions are chosen, the pay gap is counted in the summary under another name than the field", async ({ page, startServer }) => {
  const server = await startServer({ seed: "none" });
  await seedVariant(server, {
    usageNoticeSeen: true,
    mutateProfile: (profile) => {
      profile.compensation = { expectedBase: "TODO" };
      profile.workAuthorization = { regions: { US: { authorized: true, requiresSponsorship: false, willingToRelocate: true }, REMOTE: { authorized: true, requiresSponsorship: false, willingToRelocate: true } } };
      profile.targets.regions = ["US", "REMOTE"];
    },
  });
  await page.goto(`${server.origin}/profile/answers#token=${server.token}`);
  await expect(page.getByLabel("Full name")).toBeVisible();
  const state = await readFormAnswers(page);
  const apiMissing = (await server.api<{ missing: Missing[] }>("/api/profile")).missing;
  writeEvidence("h3-profile-answers-state.json", { ...state, apiMissing });
  await page.screenshot({ path: auditPath("screens", "h", "h3-profile-answers.png"), fullPage: true });

  const formLabel = state.payLabel[0] ?? "";
  // The server says nothing is missing while the form marks the pay (and India, never chosen) as needing an answer.
  const mismatch = state.marked > 0 && state.summary === "" && apiMissing.length === 0;
  const payInSummary = /salary|pay/i.test(state.summary);
  if (mismatch) finding({
    id: "H3",
    severity: "P2",
    title: "Pay is called 'Expected yearly pay' on the form but 'Expected base salary' elsewhere, and the form's single pay box is not what the server asks for per region",
    persona: "Maya",
    area: "Form answers / data sheet / missing-values summary",
    prd: "P3 (every TODO visible on one screen)",
    expected: "One name for one thing; the summary counts what the form marks; one pay box per region if pay is asked per region.",
    actual: `Form label: "${formLabel}"; data sheet label: "Expected base salary"; summary: "${state.summary}"; server missing: ${JSON.stringify(apiMissing.map((m) => m.label))}; pay box marked 'Needs your answer': ${state.marked > 0}; pay named in summary: ${payInSummary}; one pay box on form: ${state.payLabel.length === 1}. e2e/tests/setup-wizard.spec.ts:96,243 and review-approve-apply.spec.ts:62 expect 'Expected base salary' in the summary.`,
    evidence: [auditPath("h3-profile-answers-state.json"), auditPath("screens", "h", "h3-profile-answers.png"), "baseline: setup-wizard.spec.ts:96 and :243 fail"],
    suspectedFile: "packages/server/src/services/missingValues.ts:61-73 (isStillToDo(undefined) is false, so a region with no pay entry is never reported) and apps/dashboard/src/lib/answersDraft.ts:123 (typecheck: byRegion missing); label en/profile.json answers.fields.compensation.expectedBase",
    wrong: "product",
  });
  expect.soft(mismatch, "H3: the pay is called the same thing everywhere").toBe(false);
});

// H2: Remote.
test("H2: a person who chose Remote cannot answer Remote work authorization, and the summary uses a code word", async ({ page, startServer }) => {
  const server = await startServer({ seed: "none" });
  await seedVariant(server, {
    usageNoticeSeen: true,
    mutateProfile: (profile) => {
      // What a real person has after the wizard: US answered (she was shown it), Remote chosen but never asked.
      profile.workAuthorization = { regions: { US: { authorized: true, requiresSponsorship: false, willingToRelocate: true } } };
      profile.targets.regions = ["US", "REMOTE"];
      profile.compensation = { expectedBase: "120000" };
    },
  });
  await page.goto(`${server.origin}/profile/answers#token=${server.token}`);
  await expect(page.getByLabel("Full name")).toBeVisible();
  const state = await readFormAnswers(page);
  const apiMissing = (await server.api<{ missing: Missing[] }>("/api/profile")).missing;
  writeEvidence("h2-profile-answers-state.json", { ...state, apiMissing });
  await page.screenshot({ path: auditPath("screens", "h", "h2-profile-answers.png"), fullPage: true });

  const remoteGroupShown = state.groups.some((g) => /remote/i.test(g));
  const summaryNamesRemote = /REMOTE|Remote/.test(state.summary);
  if (!remoteGroupShown && (summaryNamesRemote || apiMissing.some((m) => /REMOTE/.test(m.key)))) finding({
    id: "H2a",
    severity: "P1",
    title: "Remote is a chosen region but Form answers has no Remote group, yet the summary says answers for (REMOTE) are still needed",
    persona: "Maya",
    area: "Form answers (Profile and wizard) / Finish",
    prd: "P3, A1",
    expected: "Every item the summary asks for can be answered on the screen; labels are plain words ('Remote'), not region codes.",
    actual: `Region groups shown: ${state.groups.join(", ")}; summary: "${state.summary}"; server missing: ${JSON.stringify(apiMissing.map((m) => m.label))}. Remote group shown: ${remoteGroupShown}.`,
    steps: "Targets: United States + Remote chosen and saved; open Profile > Form answers.",
    evidence: [auditPath("h2-profile-answers-state.json"), auditPath("screens", "h", "h2-profile-answers.png")],
    suspectedFile: "apps/dashboard/src/lib/answersDraft.ts:25,53 (regions = DEFAULT_REGIONS + saved ones; targets.regions ignored) vs packages/server/src/services/missingValues.ts:28-30,46-59 (regionsOf includes targets.regions)",
    wrong: "product",
  });
  expect.soft(remoteGroupShown, "H2: a Remote group is offered when Remote is a chosen region").toBe(true);

  // Now the same person pastes a Remote job, reviews and approves it.
  await page.goto(`${server.origin}/today`);
  await page.getByRole("button", { name: "Add a job" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a job" });
  await dialog.getByRole("button", { name: "Paste the job text instead" }).click();
  await dialog.getByLabel("Company").fill("Remoteco");
  await dialog.getByLabel("Job title").fill("Backend Engineer");
  await dialog.getByLabel("Place (optional)").fill("Remote");
  await dialog.getByLabel("Job description").fill(JOB_TEXT);
  await dialog.getByRole("button", { name: "Add job" }).click();
  await waitUntilNoRunIsActive(server, 120_000);
  await page.reload();
  const item = needsYouItem(page, "Backend Engineer at Remoteco");
  await expect(item).toContainText("Ready to review", { timeout: 60_000 });
  await item.getByRole("link", { name: "Review" }).click();
  await expect(page.getByRole("article", { name: "Resume preview" })).toBeVisible();
  await page.screenshot({ path: auditPath("screens", "h", "h2-review-remote-job.png"), fullPage: true });

  const decision = await page.locator("section[aria-label='Your decision']").innerText();
  const sheet = await page.getByRole("table", { name: "Every value that will be sent with this application" }).innerText();
  const approve = page.getByRole("button", { name: "Approve" });
  const canApprove = await approve.isEnabled();
  const missingRows = sheet.split("\n").filter((line) => /Missing/.test(line));
  writeEvidence("h2-review-remote-job.json", { decision, canApprove, missingRows });
  if (canApprove && missingRows.some((row) => /Authorized|sponsorship|relocate/.test(row))) finding({
    id: "H2b",
    severity: "P2",
    title: "A Remote job can be approved with 'Authorized to work here' Missing, with no warning, and there is no screen to fix it",
    persona: "Maya",
    area: "Review (data sheet)",
    prd: "A1, A3 ('every approval is informed')",
    expected: "Either Approve waits until work authorization for this region is answered, or Review says what is missing and links to where it can be answered.",
    actual: `Approve enabled: ${canApprove}. Decision panel text: "${decision.replace(/\n/g, " ")}". Missing rows: ${JSON.stringify(missingRows)}`,
    evidence: [auditPath("h2-review-remote-job.json"), auditPath("screens", "h", "h2-review-remote-job.png")],
    suspectedFile: "packages/core/src/dataSheet.ts:55-57 (work authorization fields required:false) and apps/dashboard/src/screens/review/ReviewContent.tsx:43,109-116 (only required fields are warned about)",
    wrong: "product",
  });
  expect.soft(canApprove && missingRows.length > 0, "H2: approve is open while authorization is missing").toBe(false);
});

// H4: A approves at once. Is there any way back?
test("H4: pressing A approves immediately with no confirmation, and nothing in the app un-approves it", async ({ page, startServer }) => {
  const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
  await page.goto(server.url);
  await findJobsAndWaitForReview(page);
  const acmeId = await openReview(page, ACME);
  const heading = page.getByRole("heading", { level: 1, name: "Backend Engineer" });
  await heading.click();
  await page.keyboard.press("a"); // an accident: one key
  await expect(page.getByRole("heading", { level: 1, name: "Platform Engineer" })).toBeVisible({ timeout: 30_000 });
  const dialogShown = await page.getByRole("dialog").count();
  const detail = await server.api<{ application: { status: string }; approval: { id?: string } | null }>(`/api/apps/${acmeId}`);
  writeEvidence("h4-after-a.json", { dialogShown, status: detail.application.status, hasApproval: detail.approval !== null });

  // Look for any way back on the application page.
  await waitUntilNoRunIsActive(server);
  await page.goto(`${server.origin}/apps/${acmeId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Backend Engineer" })).toBeVisible();
  const buttons = await page.getByRole("button").allTextContents();
  const links = await page.getByRole("link").allTextContents();
  await page.screenshot({ path: auditPath("screens", "h", "h4-application-after-A.png"), fullPage: true });
  await page.goto(`${server.origin}/review/${acmeId}`);
  const reviewText = await page.locator("main").innerText();
  const reviewButtons = await page.getByRole("button").allTextContents();
  writeEvidence("h4-ways-back.json", { appButtons: buttons, appLinks: links, reviewNotice: reviewText.slice(0, 300), reviewButtons });
  const unapprove = [...buttons, ...reviewButtons].filter((text) => /undo|un-?approve|cancel approval|take back|revoke/i.test(text));
  if (dialogShown === 0 && detail.approval !== null && unapprove.length === 0) finding({
    id: "H4",
    severity: "P2",
    title: "One key press (A) approves at once with no confirmation, and there is no way to un-approve",
    persona: "Both",
    area: "Review",
    prd: "A1-A3, 'the person decides', 'every approval is informed'",
    expected: "Approval is deliberate (confirmation or an Undo for a few seconds), or can be taken back before anything is sent.",
    actual: `After pressing A once: status ${detail.application.status}, a live approval exists: ${detail.approval !== null}, dialogs shown: ${dialogShown}, next application opened immediately. Buttons on the application page: ${JSON.stringify(buttons)}; on Review: ${JSON.stringify(reviewButtons)}. Un-approve controls found: ${unapprove.length}.`,
    steps: "Review the Acme job; click the page; press a.",
    evidence: [auditPath("h4-after-a.json"), auditPath("h4-ways-back.json"), auditPath("screens", "h", "h4-application-after-A.png")],
    suspectedFile: "apps/dashboard/src/screens/review/ReviewContent.tsx:46-49,69-72; packages/server/src/services/applicationActions.ts:18-24 (no 'unapprove' action)",
    wrong: "product",
  });
  expect.soft(unapprove.length, "H4: there is a way to un-approve").toBeGreaterThan(0);
});

async function readFormAnswers(page: import("@playwright/test").Page): Promise<{ summary: string; marked: number; groups: string[]; payLabel: string[] }> {
  const summary = (await page.locator("main p, form p").filter({ hasText: /still needed/ }).allTextContents()).join(" | ");
  const marked = await page.getByText("Needs your answer").count();
  const groups = await page.getByRole("group").evaluateAll((nodes) => nodes.map((node) => node.querySelector("legend")?.textContent ?? ""));
  const payLabel = await page.getByRole("region", { name: "Pay" }).locator("label").allTextContents();
  return { summary, marked, groups, payLabel };
}


