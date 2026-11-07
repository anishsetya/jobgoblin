// J1: the golden path with NO seed. Maya, non-technical, opens an empty app and tries to get one application to
// Applied, then through the Pipeline to Accepted, then exports. UI only. Every click, typed field and minute is
// counted (AUDIT_DIR/j1-metrics.json) and a picture is taken at the end of each stage (AUDIT_DIR/screens/j1/).
// Where the app blocks her, the block is recorded exactly and the smallest workaround is used to look at the rest.
import fs from "node:fs";
import path from "node:path";
import { auditPath } from "./paths";
import { test, expect } from "./auditFixtures";
import { copyEvidence, listTree, writeEvidence, findFiles } from "./common";
import { Journey } from "./journey";
import { check, finding, observation, saveEvidence } from "./record";
import { sweep } from "./sweep";
import { ACME, applicationIdFromUrl, needsYouItem } from "../support/flows";
import { RESUME_PDF } from "../support/seed";
import { startRecordingRunCards, recordedRunCardTexts } from "../support/pageProbes";
import { waitUntilNoRunIsActive } from "../support/waits";

type Detail = {
  application: { id: string; status: string; folder: string | null; followUpOn: string | null; company: string; title: string };
  approval: { pdfSha256: string; dataSheetHash: string } | null;
  dataSheet: { region: string; fields: { key: string; label: string; value: string; missing: boolean; required: boolean }[] } | null;
  dataSheetHash: string | null;
};

test("J1: an empty app to Applied to Accepted to export, UI only (Maya)", async ({ page, context, startServer }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const server = await startServer({ seed: "none" });
  const j = new Journey(page, "j1");
  await startRecordingRunCards(page);
  const downloads: string[] = [];

  try {
    // ----------------------------------------------------------------------------------------------
    await j.stage("Open the app for the first time", async () => {
      await page.goto(server.url);
      await expect(page.getByRole("heading", { level: 1, name: "Welcome to Jobgoblin" })).toBeVisible();
      await sweep(page, "Wizard 1 Welcome", { screenshot: "screens/j1/sweep-wizard-1.png" });
      await j.click(page.getByRole("button", { name: "Get started" }));
    });

    await j.stage("Connect Claude", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Connect Claude" })).toBeVisible();
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();
      await j.click(page.getByRole("button", { name: "Continue" }));
    });

    await j.stage("Choose a folder (browser: she must type a full path)", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Choose your folder" })).toBeVisible();
      await j.fill(page.getByLabel("Folder", { exact: true }), server.personFolder, "folder");
      await j.click(page.getByRole("button", { name: "Use this folder" }));
      await expect(page.getByText(server.personFolder)).toBeVisible();
      await j.click(page.getByRole("button", { name: "Continue" }));
    });

    await j.stage("Add resume and read it", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Add your resume" })).toBeVisible();
      await j.chooseFile(page.getByLabel("Your resume", { exact: true }), RESUME_PDF);
      await j.click(page.getByRole("button", { name: "Read my resume" }));
      await j.click(page.getByRole("dialog", { name: "Before your first run" }).getByRole("button", { name: "I understand, continue" }));
      await j.waiting(() => expect(page.getByText("Your resume has been read. Next, check what we found.")).toBeVisible({ timeout: 90_000 }));
      await j.click(page.getByRole("button", { name: "Continue" }));
    });

    await j.stage("Your story: confirm everything", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Your story" })).toBeVisible();
      // "Confirm all N items" exists per group (Jobs, Projects, Skills...), not once for the whole story.
      const confirmAll = page.getByRole("button", { name: /^Confirm all/ });
      const everyConfirm = page.getByRole("button", { name: /^Confirm/ });
      await expect(everyConfirm.first()).toBeVisible({ timeout: 30_000 });
      j.note(`Your story: ${await confirmAll.count()} 'Confirm all' group buttons visible at the start; no single button for the whole story.`);
      for (let guard = 0; guard < 80; guard += 1) {
        const before = await everyConfirm.count();
        if (before === 0) break;
        await j.click((await confirmAll.count()) > 0 ? confirmAll.first() : everyConfirm.first());
        await expect.poll(() => everyConfirm.count()).toBeLessThan(before);
      }      await expect(page.getByText(/^All done\. You confirmed \d+ items\.$/)).toBeVisible();
      await j.click(page.getByRole("button", { name: "Continue" }));
    });

    {
      const storyClicks = j.stages[j.stages.length - 1]?.clicks ?? 0;
      if (storyClicks > 5) {
        finding({
          id: "J1-3",
          severity: "P2",
          title: `Confirming the 22 items of her story took ${storyClicks} clicks: 'Confirm all' exists only per group, and some items have no group button`,
          persona: "Maya",
          area: "Setup step 5, Your story",
          prd: "P2, S (setup in a few minutes)",
          expected: "One 'Confirm everything that is right' action, with Edit and Drop still available per item.",
          actual: `${storyClicks} clicks in this stage (3 'Confirm all' group buttons, the rest one by one).`,
          evidence: [auditPath("j1-metrics.json"), auditPath("screens", "j1")],
          suspectedFile: "apps/dashboard/src/components/StoryGroupCard.tsx, StoryList.tsx",
          wrong: "product",
        });
      }
    }

    await j.stage("Form answers (before she has said where she wants to work)", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Form answers" })).toBeVisible();
      // What the screen says about itself, before Maya touches anything: this is the H1/H3 evidence.
      const summary = (await page.locator("main p").filter({ hasText: /still needed/ }).allTextContents()).join(" | ");
      const marked = await page.getByText("Needs your answer").count();
      const groups = await page.getByRole("group").evaluateAll((nodes) => nodes.map((node) => node.querySelector("legend")?.textContent ?? ""));
      const payLabel = await page.getByRole("region", { name: "Pay" }).locator("label").allTextContents();
      saveEvidence("j1-form-answers-state.json", JSON.stringify({ summary, marked, regionGroupsShown: groups, payLabel }, null, 2));
      j.note(`Form answers: summary="${summary}"; fields marked 'Needs your answer'=${marked}; region groups shown=${groups.join(",")}; pay label=${payLabel.join(",")}`);

      await j.fill(page.getByLabel("Notice period"), "2 weeks");
      await j.fill(page.getByLabel("Earliest start date"), "2026-12-01");
      await j.fill(page.getByLabel("Expected yearly pay"), "120000");
      // She wants Remote work, not the United States or India, so she leaves those groups alone.
      await sweep(page, "Wizard 6 Form answers", { screenshot: "screens/j1/sweep-wizard-6.png" });
      await j.click(page.getByRole("button", { name: "Save and continue" }));
    });

    await j.stage("Targets: Remote only", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Your targets" })).toBeVisible();
      await j.fill(page.getByLabel("Job titles you want"), "Backend Engineer");
      await j.check(page.getByRole("checkbox", { name: "Remote" }));
      await j.click(page.getByRole("button", { name: "Save and continue" }));
    });

    await j.stage("Finish", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "You are ready" })).toBeVisible();
      const finishText = await page.locator("main").innerText();
      saveEvidence("j1-finish-text.txt", finishText);
      j.note(`Finish screen text: ${finishText.replace(/\s+/g, " ")}`);
      await j.click(page.getByRole("button", { name: "Finish setup" }));
      await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    });

    // ----------------------------------------------------------------------------------------------
    let acmeShown = false;
    await j.stage("Find jobs (Remote only)", async () => {
      await sweep(page, "Today before the first Find jobs", { screenshot: "screens/j1/sweep-today-fresh.png" });
      const freshText = await page.locator("main").innerText();
      saveEvidence("j1-today-fresh-text.txt", freshText);
      if (!/Find your first jobs/.test(freshText)) {
        finding({
          id: "J1-8",
          severity: "P3",
          title: "Right after setup Today says 'Nothing needs you right now' and shows a 'Reading your resume: Finished' card; the 'Find your first jobs' welcome never appears",
          persona: "Maya",
          area: "Today (first visit)",
          prd: "S, R1 (empty state invites one action)",
          expected: "The first Today explains what Find jobs does (the copy exists as today:fresh).",
          actual: `Today text on first visit: "${freshText.replace(/\s+/g, " ")}"`,
          evidence: [auditPath("j1-today-fresh-text.txt"), auditPath("screens", "j1", "sweep-today-fresh.png")],
          suspectedFile: "apps/dashboard/src/screens/TodayScreen.tsx:56-59 (isFreshStart needs running.length === 0, but the setup run card is still listed)",
          wrong: "product",
        });
      }
      await j.click(page.getByRole("button", { name: "Find jobs" }));
      await j.waiting(async () => {
        await expect(page.getByTestId("run-card").first()).toBeVisible();
        await waitUntilNoRunIsActive(server, 120_000);
      });
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
      acmeShown = (await needsYouItem(page, ACME).count()) > 0;
      const todayText = await page.locator("main").innerText();
      saveEvidence("j1-today-after-remote-find.txt", todayText);
      j.note(`After Find jobs with only Remote chosen, Today shows: ${todayText.replace(/\s+/g, " ")}`);
    });

    if (!acmeShown) {
      const pipeline = await server.api<{ company: string; title: string; status: string }[]>("/api/pipeline");
      writeEvidence("j1-pipeline-after-remote-find.json", pipeline);
      finding({
        id: "J1-1",
        severity: "P1",
        title: "Choosing Remote on Targets finds none of the demo's Remote-US jobs, and Today does not say why",
        persona: "Maya",
        area: "Targets / Find jobs / Today",
        prd: "D1, P4 (targets change the next search)",
        expected: "A person who picks Remote sees remote jobs, or is told that Remote means 'no country named' and what to pick instead.",
        actual: `After picking only Remote, Find jobs ended with the Acme Cloud 'Remote - US' job absent from Needs you. Pipeline rows: ${JSON.stringify(pipeline.map((row) => `${row.title} at ${row.company}: ${row.status}`))}. Today text: see j1-today-after-remote-find.txt`,
        steps: "Empty app; wizard; Targets: tick only Remote; Finish; Find jobs.",
        evidence: [auditPath("j1-today-after-remote-find.txt"), auditPath("j1-pipeline-after-remote-find.json"), auditPath("screens", "j1")],
        suspectedFile: "packages/core/src/jobFilters.ts:45-52 (classifyRegion puts 'Remote - US' in US) and :203-207 (isOutsideTargetRegions)",
        wrong: "product",
      });
      j.note("WORKAROUND: Maya adds United States on Profile > Targets so that the Remote-US Acme job can be reached.");

      await j.stage("WORKAROUND: add United States on Profile > Targets, Find jobs again", async () => {
        await j.click(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Profile" }));
        await j.click(page.getByRole("tab", { name: "Targets" }));
        await j.check(page.getByRole("checkbox", { name: "United States" }));
        await j.click(page.getByRole("button", { name: "Save", exact: true }));
        await expect(page.getByText("Saved", { exact: true })).toBeVisible();
        await j.click(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Today" }));
        await j.click(page.getByRole("button", { name: "Find jobs" }));
        await j.waiting(async () => {
          await waitUntilNoRunIsActive(server, 120_000);
        });
        await page.reload();
        await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
        acmeShown = (await needsYouItem(page, ACME).count()) > 0;
        const todayText = await page.locator("main").innerText();
        saveEvidence("j1-today-after-us-find.txt", todayText);
        j.note(`After adding United States and pressing Find jobs again, Today shows: ${todayText.replace(/\s+/g, " ")}`);
      });

      if (!acmeShown) {
        const jobsAfter = await server.api<{ company: string; title: string; status: string }[]>("/api/pipeline");
        writeEvidence("j1-pipeline-after-us-find.json", jobsAfter);
        finding({
          id: "J1-2",
          severity: "P1",
          title: "After widening Targets (adding United States), the next Find jobs still shows nothing, and does not say why",
          persona: "Maya",
          area: "Find jobs / Targets",
          prd: "D3, P4 ('done when': a change to targets changes the next search)",
          expected: "Jobs the old targets ruled out are looked at again, or Today says 'nothing new' and how to see the jobs that were ruled out.",
          actual: `Second Find jobs (US + Remote chosen) ended with 'Jobs found 0' and 'Nothing needs you right now.' Pipeline rows: ${jobsAfter.length}. The Acme Remote-US job stayed out.`,
          steps: "Empty app; Targets Remote only; Find jobs (0 found); Profile > Targets add United States; Today > Find jobs.",
          evidence: [auditPath("j1-today-after-us-find.txt"), auditPath("j1-pipeline-after-us-find.json"), auditPath("screens", "j1")],
          suspectedFile: "packages/server/src/services/feeds.ts:71-79 (a posting the filter rejected is stored with filteredReason and insertJobIfNew never re-evaluates it)",
          wrong: "product",
        });
        j.note("WORKAROUND 2: Maya cannot get Acme from Find jobs, so she pastes its link with Add a job.");
        await j.stage("WORKAROUND 2: Add a job with the Acme link", async () => {
          await j.click(page.getByRole("button", { name: "Add a job" }));
          const dialog = page.getByRole("dialog", { name: "Add a job" });
          await j.fill(dialog.getByLabel("Link to the job"), "https://boards.greenhouse.io/acmecloud/jobs/4012345", "job-link");
          await j.click(dialog.getByRole("button", { name: "Add job" }));
          await j.waiting(async () => {
            await waitUntilNoRunIsActive(server, 120_000);
          });
          await page.reload();
          await expect(needsYouItem(page, ACME)).toContainText("Ready to review", { timeout: 60_000 });
        });
      }
    }

    // ----------------------------------------------------------------------------------------------
    let applicationId = "";
    await j.stage("Review Acme Cloud", async () => {
      await j.click(needsYouItem(page, ACME).getByRole("link", { name: "Review" }));
      await expect(page).toHaveURL(/\/review\/[\w-]+$/);
      applicationId = applicationIdFromUrl(page);
      await expect(page.getByRole("article", { name: "Resume preview" })).toBeVisible();
      const detail = await server.api<Detail>(`/api/apps/${applicationId}`);
      writeEvidence("j1-review-detail-before-approve.json", detail);
      const missing = detail.dataSheet?.fields.filter((field) => field.missing).map((field) => `${field.label}${field.required ? " (required)" : ""}`) ?? [];
      j.note(`Data sheet region=${detail.dataSheet?.region}; missing values at review: ${missing.join(", ") || "none"}`);
      await sweep(page, "Review Acme (J1)", { screenshot: "screens/j1/sweep-review.png" });
      const approve = page.getByRole("button", { name: "Approve" });
      const enabled = await approve.isEnabled();
      if (!enabled) {
        finding({
          id: "J1-7",
          severity: "P1",
          title: "Approve is disabled on the Remote/US Acme job",
          persona: "Maya",
          area: "Review",
          prd: "A1",
          expected: "Maya can approve once she has given the required name, email and phone.",
          actual: `Approve was disabled. Missing: ${missing.join(", ")}. Page said: ${await page.locator("section[aria-label='Your decision']").innerText()}`,
          evidence: [auditPath("j1-review-detail-before-approve.json"), auditPath("screens", "j1")],
          wrong: "product",
        });
      }
      await j.click(approve);
    });

    await j.stage("Wait for answers, then Open application", async () => {
      await j.waiting(async () => {
        await waitUntilNoRunIsActive(server, 120_000);
      });
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Today" }).click();
      await expect(needsYouItem(page, ACME)).toContainText("Ready to send", { timeout: 60_000 });
      await j.click(needsYouItem(page, ACME).getByRole("link", { name: "Open application" }));
      await expect(page.getByRole("heading", { name: "Why are you interested in this role?" })).toBeVisible();
      await sweep(page, "Open application (J1)", { screenshot: "screens/j1/sweep-apply.png" });
    });

    let detailAfterApprove: Detail | undefined;
    await j.stage("Copy a value, open the resume file", async () => {
      detailAfterApprove = await server.api<Detail>(`/api/apps/${applicationId}`);
      writeEvidence("j1-detail-after-approve.json", detailAfterApprove);
      const dataSheet = page.getByRole("table", { name: "Every value that will be sent with this application" });
      await j.click(dataSheet.getByRole("button", { name: "Copy Email address" }));
      await expect(dataSheet.getByText("Copied")).toBeVisible();
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      check(clip.length > 3 && clip.includes("@"), {
        id: "J1-6",
        severity: "P2",
        title: "Copy Email address does not put the email on the clipboard",
        persona: "Maya",
        area: "Open application",
        prd: "U1",
        expected: "An email address",
        actual: JSON.stringify(clip),
        evidence: [auditPath("screens", "j1")],
        wrong: "product",
      });
      await j.click(page.getByRole("button", { name: "Open resume file" }));
      await expect(page.getByRole("status").filter({ hasText: "The file could not be opened from here" })).toBeVisible();
    });

    await j.stage("I submitted (with proof)", async () => {
      await j.click(page.getByRole("button", { name: "I submitted" }));
      const dialog = page.getByRole("dialog", { name: "Record that you applied" });
      await j.fill(dialog.getByLabel("Web address of the confirmation page"), "https://boards.greenhouse.io/acmecloud/confirmation", "confirmation-url");
      await j.click(dialog.getByRole("button", { name: "Record as applied" }));
      await expect(page).toHaveURL(new RegExp(`/apps/${applicationId}$`));
      await expect(page.getByText("Applied", { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/^Follow up on /)).toBeVisible();
    });

    await j.stage("Pipeline shows Applied", async () => {
      await j.click(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pipeline" }));
      await expect(page.getByRole("region", { name: /^Applied/ }).getByTestId("pipeline-card")).toHaveCount(1);
      await sweep(page, "Pipeline (J1)", { screenshot: "screens/j1/sweep-pipeline.png" });
    });

    await j.stage("Move through the pipeline to Accepted", async () => {
      await j.click(page.getByTestId("pipeline-card").filter({ hasText: "Acme Cloud" }).getByRole("link").first());
      const statusCard = page.getByRole("region", { name: "Change status" });
      for (const label of ["Online assessment", "Phone screen", "Interview round", "Offer", "Accepted"]) {
        await j.select(statusCard.getByLabel("New status"), { label });
        await j.click(statusCard.getByRole("button", { name: "Change status" }));
        await expect(page.getByRole("heading", { level: 1, name: "Backend Engineer" }).locator("..").getByText(label, { exact: true })).toBeVisible();
      }
    });

    await j.stage("Export the tracker from Settings", async () => {
      await j.click(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }));
      for (const name of ["Download CSV", "Download Excel file"]) {
        const [download] = await Promise.all([page.waitForEvent("download"), j.click(page.getByRole("button", { name }).or(page.getByRole("link", { name })))]);
        const saved = auditPath("j1-exports", download.suggestedFilename());
        await download.saveAs(saved);
        downloads.push(saved);
      }
      await sweep(page, "Settings (J1)", { screenshot: "screens/j1/sweep-settings.png" });
    });

    // ----------------------------------------------------------------------------------------------
    // Inspection of what was produced (no clicking).
    const finalDetail = await server.api<Detail>(`/api/apps/${applicationId}`);
    writeEvidence("j1-final-detail.json", finalDetail);
    const applicationFolder = path.join(server.personFolder, ...(finalDetail.application.folder ?? "").split("/"));
    const tree = listTree(server.personFolder);
    writeEvidence("j1-person-folder-tree.txt", tree.join("\n"));
    writeEvidence("j1-run-card-texts.json", await recordedRunCardTexts(page));

    const resumePdf = path.join(applicationFolder, "Alex Rivera - Resume.pdf");
    check(fs.existsSync(resumePdf), {
      id: "J1-4",
      severity: "P1",
      title: "The approved resume PDF is not named 'Alex Rivera - Resume.pdf' in the application folder",
      persona: "Maya",
      area: "Files",
      prd: "T2",
      expected: resumePdf,
      actual: `Folder holds: ${fs.existsSync(applicationFolder) ? fs.readdirSync(applicationFolder).join(", ") : "(folder missing)"}`,
      evidence: [auditPath("j1-person-folder-tree.txt")],
      wrong: "product",
    });
    copyEvidence(path.join(applicationFolder, "Answers.md"), "j1-Answers.md");
    for (const file of findFiles(server.personFolder, (name) => /tracker.*\.(csv|xlsx)$/i.test(name))) copyEvidence(file, `j1-tracker-files/${path.basename(file)}`);
    j.note(`Exports saved: ${downloads.join(", ")}`);

    // Frozen sheet: what Review showed (sheet hash at approve) equals the approval stored.
    check(finalDetail.approval !== null && detailAfterApprove?.approval?.dataSheetHash === finalDetail.approval?.dataSheetHash, {
      id: "J1-5",
      severity: "P0",
      title: "The approved data sheet changed after approval",
      persona: "Maya",
      area: "Approval",
      prd: "A3",
      expected: "Same data sheet hash after approval and after applying",
      actual: `${detailAfterApprove?.approval?.dataSheetHash} vs ${finalDetail.approval?.dataSheetHash}`,
      evidence: [auditPath("j1-detail-after-approve.json"), auditPath("j1-final-detail.json")],
      wrong: "product",
    });
  } finally {
    j.save();
    observation("j1-server-output", { tail: server.output().slice(-4000) });
    // Copy what the person's folder holds before the temp folders are removed.
    try {
      writeEvidence("j1-person-folder-tree-final.txt", listTree(server.personFolder).join("\n"));
    } catch {
      // folder may be gone
    }
  }
});



