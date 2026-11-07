// Section B: bad inputs. Resumes (Word, broken files, image-only, too large, LinkedIn), folders (missing, a file, relative,
// quoted, odd characters, read-only, the app's own data), the wizard (zero story items, empty targets, reload, Back,
// skipping ahead by URL), form answers (bad email, emoji, very long, banned word), display (very long names, a
// deep link with no token, unknown routes).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./auditFixtures";
import { alertTexts, removeDir, tempDir } from "./helpers";
import { writeEvidence } from "./common";
import { auditPath } from "./paths";
import { check } from "./record";
import { seedVariant } from "./seedVariants";
import { sweep } from "./sweep";
import { RESUME_PDF, brokenResume, uploadResumeAndChooseFolder } from "../support/seed";
import { REPO_ROOT } from "../support/server";
import { waitUntilNoRunIsActive } from "../support/waits";

const RESUMES = path.join(REPO_ROOT, "fixtures", "resumes");

function imageOnlyPdf(folder: string): string {
  const file = path.join(folder, "image-only.pdf");
  fs.writeFileSync(
    file,
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<<>>>>endobj\n" +
      "4 0 obj<</Length 36>>stream\n0.5 g 100 100 400 400 re f\nendstream endobj\ntrailer<</Root 1 0 R/Size 5>>\n%%EOF\n",
  );
  return file;
}

async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").innerText()).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------------------------
// Resumes
// ---------------------------------------------------------------------------------------------

test("B resume: each bad file is refused in plain words next to the file; a Word file is read", async ({ page, startServer }) => {
  const scratch = tempDir("resumes");
  try {
    const server = await startServer({ seed: "none" });
    await uploadFolderOnly(server);
    await page.goto(`${server.origin}/setup/4#token=${server.token}`);
    await expect(page.getByRole("heading", { level: 1, name: "Add your resume" })).toBeVisible();

    const results: Record<string, unknown> = {};
    const attempts: { id: string; file: string }[] = [
      { id: "truncated-pdf", file: brokenResume("truncated.pdf") },
      { id: "text-file-named-pdf", file: brokenResume("text-file.pdf") },
      { id: "truncated-docx", file: brokenResume("truncated.docx") },
      { id: "text-file-named-docx", file: brokenResume("text-file.docx") },
      { id: "password-pdf", file: brokenResume("password-protected.pdf") },
      { id: "image-only-pdf", file: imageOnlyPdf(scratch) },
    ];
    let first = true;
    for (const attempt of attempts) {
      await page.getByLabel("Your resume", { exact: true }).setInputFiles(attempt.file);
      await page.getByRole("button", { name: "Read my resume" }).click();
      if (first) {
        await page.getByRole("dialog", { name: "Before your first run" }).getByRole("button", { name: "I understand, continue" }).click();
        first = false;
      }
      await page.waitForTimeout(1800);
      const alerts = await alertTexts(page);
      results[attempt.id] = { alerts, readButtonEnabled: await page.getByRole("button", { name: "Read my resume" }).isEnabled().catch(() => null), status: await mainText(page).then((text) => text.slice(0, 700)) };
      await page.screenshot({ path: auditPath("screens", "b", `resume-${attempt.id}.png`), fullPage: true });
    }

    // Too large: 10.5 MB. The dashboard stops it; then the server is asked directly.
    const big = path.join(scratch, "big.pdf");
    fs.writeFileSync(big, Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(10.5 * 1024 * 1024, 0x20)]));
    await page.getByLabel("Your resume", { exact: true }).setInputFiles(big);
    await page.waitForTimeout(500);
    results["too-large-11mb-ui"] = { text: await mainText(page).then((text) => text.slice(0, 600)), readButtonEnabled: await page.getByRole("button", { name: "Read my resume" }).isEnabled() };
    await page.screenshot({ path: auditPath("screens", "b", "resume-too-large.png"), fullPage: true });
    for (const megabytes of [10.5, 12]) {
      const form = new FormData();
      form.set("kind", "resume");
      form.set("file", new Blob([Buffer.alloc(megabytes * 1024 * 1024, 0x20)], { type: "application/pdf" }), "big.pdf");
      const response = await fetch(`${server.origin}/api/import-resume`, { method: "POST", headers: { Authorization: `Bearer ${server.token}` }, body: form });
      results[`too-large-${megabytes}mb-api`] = { status: response.status, body: await response.text() };
    }

    // The optional LinkedIn file: a broken one first (the message must sit next to it), then a good pair.
    await page.getByLabel("Your resume", { exact: true }).setInputFiles(RESUME_PDF);
    await page.getByLabel(/Your LinkedIn profile/).setInputFiles(brokenResume("text-file.pdf"));
    await page.getByRole("button", { name: "Read my resume" }).click();
    await page.waitForTimeout(1800);
    results["linkedin-broken"] = { alerts: await alertTexts(page), text: await mainText(page).then((text) => text.slice(0, 700)) };
    await page.screenshot({ path: auditPath("screens", "b", "resume-linkedin-broken.png"), fullPage: true });

    // Word file as the resume, with a good LinkedIn PDF.
    await page.getByLabel("Your resume", { exact: true }).setInputFiles(path.join(RESUMES, "alex-rivera.docx"));
    await page.getByLabel(/Your LinkedIn profile/).setInputFiles(RESUME_PDF);
    await page.getByRole("button", { name: "Read my resume" }).click();
    let wordOutcome = "";
    try {
      await expect(page.getByText("Your resume has been read. Next, check what we found.")).toBeVisible({ timeout: 60_000 });
      wordOutcome = "read";
    } catch {
      wordOutcome = `not read: ${(await alertTexts(page)).join(" | ")} ${await mainText(page).then((text) => text.slice(0, 300))}`;
    }
    results["word-docx-with-linkedin-pdf"] = { outcome: wordOutcome, alerts: await alertTexts(page) };
    await waitUntilNoRunIsActive(server, 120_000);
    const items = await server.api<unknown[]>("/api/story").catch(() => []);
    results["story-items-after-word"] = Array.isArray(items) ? items.length : "n/a";
    await page.screenshot({ path: auditPath("screens", "b", "resume-word-read.png"), fullPage: true });
    const evidence = writeEvidence("b-resumes.json", results);

    for (const id of ["truncated-pdf", "text-file-named-pdf", "truncated-docx", "text-file-named-docx", "image-only-pdf"]) {
      const entry = results[id] as { alerts: string[] };
      check(entry.alerts.length > 0 && !/exception|undefined|ENOENT|stack|our side/i.test(entry.alerts.join(" ")), {
        id: `B-resume-${id}`, severity: "P2", title: `Broken resume "${id}" is not refused in plain words`, persona: "Maya", area: "Setup > Add your resume", prd: "P1, 'errors say what happened and what to do'",
        expected: "An alert that names the problem and the next step", actual: JSON.stringify(entry), evidence: [evidence], wrong: "product",
      });
    }
    check(wordOutcome === "read", {
      id: "B-resume-word", severity: "P1", title: "A Word resume cannot be read", persona: "Maya", area: "Setup > Add your resume", prd: "P1 (PDF or Word)",
      expected: "Read", actual: wordOutcome, evidence: [evidence], wrong: "product",
    });
    const large = results["too-large-11mb-ui"] as { text: string; readButtonEnabled: boolean };
    check(/larger than/.test(large.text) && !large.readButtonEnabled, {
      id: "B-resume-large-ui", severity: "P2", title: "A resume over 10 MB is not stopped with a message on the screen", persona: "Maya", area: "Setup > Add your resume", prd: "P1",
      expected: "Message + Read button off", actual: JSON.stringify(large), evidence: [evidence], wrong: "product",
    });
  } finally {
    removeDir(scratch);
  }
});

async function uploadFolderOnly(server: { api: <T>(route: string, init?: { method?: string; body?: unknown }) => Promise<T>; personFolder: string }): Promise<void> {
  await server.api("/api/settings/folder", { body: { path: server.personFolder } });
}

// ---------------------------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------------------------

test("B folder: missing, a file, relative, quoted, odd characters, app data, read-only", async ({ page, startServer }) => {
  const scratch = tempDir("folders");
  const readOnly = path.join(scratch, "read-only");
  try {
    const server = await startServer({ seed: "none" });
    fs.mkdirSync(readOnly);
    const aFile = path.join(scratch, "a-file.txt");
    fs.writeFileSync(aFile, "hello");
    // Deny writing in the read-only folder (a plain read-only attribute does not stop writing on Windows).
    let denyWorked = false;
    if (process.platform === "win32") {
      try {
        execFileSync("icacls", [readOnly, "/deny", `${process.env.USERNAME}:(OI)(CI)(W,DC)`], { stdio: "ignore" });
        try {
          fs.writeFileSync(path.join(readOnly, "probe.txt"), "x");
          fs.rmSync(path.join(readOnly, "probe.txt"), { force: true });
        } catch {
          denyWorked = true;
        }
      } catch {
        denyWorked = false;
      }
    }

    await page.goto(`${server.origin}/setup/3#token=${server.token}`);
    await expect(page.getByRole("heading", { level: 1, name: "Choose your folder" })).toBeVisible();
    const variants: { id: string; value: string; expect: "ok" | "refused" }[] = [
      { id: "nonexistent", value: path.join(scratch, "not-yet", "Jobgoblin files"), expect: "ok" },
      { id: "a-file", value: aFile, expect: "refused" },
      { id: "relative", value: "Documents\\Jobgoblin", expect: "refused" },
      { id: "quoted-as-copied-from-explorer", value: `"${path.join(scratch, "quoted folder")}"`, expect: "ok" },
      { id: "spaces-and-non-english", value: path.join(scratch, "María José 日本語 ñandú folder"), expect: "ok" },
      { id: "invalid-characters", value: path.join(scratch, "bad<>|name"), expect: "refused" },
      { id: "app-data-folder", value: server.appDataDir, expect: "refused" },
      { id: "inside-app-data-folder", value: path.join(server.appDataDir, "mine"), expect: "refused" },
      { id: "trailing-spaces", value: `${path.join(scratch, "trailing")}   `, expect: "ok" },
      ...(denyWorked ? [{ id: "read-only", value: path.join(readOnly, "inside"), expect: "refused" as const }, { id: "read-only-itself", value: readOnly, expect: "refused" as const }] : []),
    ];
    const results: Record<string, unknown> = { denyWorked };
    for (const variant of variants) {
      await page.getByLabel("Folder", { exact: true }).fill(variant.value);
      await page.getByRole("button", { name: "Use this folder" }).click();
      await page.waitForTimeout(900);
      const alerts = await alertTexts(page);
      const current = await page.locator("main").getByText(/Your files are kept in/).first().innerText().catch(() => "");
      const created = fs.existsSync(variant.value.replace(/^"|"$/g, "").trim());
      results[variant.id] = { typed: variant.value, expected: variant.expect, alerts, current: current.replace(/\s+/g, " "), existsOnDisk: created };
      await page.screenshot({ path: auditPath("screens", "b", `folder-${variant.id}.png`), fullPage: false });
      if (variant.expect === "refused") await page.getByLabel("Folder", { exact: true }).fill("");
    }
    const evidence = writeEvidence("b-folders.json", results);
    for (const variant of variants) {
      const entry = results[variant.id] as { alerts: string[]; current: string };
      if (variant.expect === "refused") {
        check(entry.alerts.length > 0, {
          id: `B-folder-${variant.id}`, severity: "P2", title: `Folder "${variant.id}" is not refused with a message`, persona: "Maya", area: "Setup > Choose your folder", prd: "S4",
          expected: "Plain refusal with a next step", actual: JSON.stringify(entry), evidence: [evidence], wrong: "product",
        });
        check(!/exception|EPERM|ENOENT|EACCES|undefined|errno/i.test(entry.alerts.join(" ")), {
          id: `B-folder-${variant.id}-wording`, severity: "P2", title: `Folder "${variant.id}" shows a technical error`, persona: "Maya", area: "Setup > Choose your folder", prd: "Voice",
          expected: "Plain words", actual: JSON.stringify(entry), evidence: [evidence], wrong: "product",
        });
      } else {
        check(entry.alerts.length === 0, {
          id: `B-folder-${variant.id}`, severity: "P3", title: `Folder "${variant.id}" should be accepted but was refused`, persona: "Maya", area: "Setup > Choose your folder", prd: "S4",
          expected: "Accepted", actual: JSON.stringify(entry), evidence: [evidence], wrong: "product",
        });
      }
    }
  } finally {
    try {
      execFileSync("icacls", [readOnly, "/remove:d", String(process.env.USERNAME)], { stdio: "ignore" });
      execFileSync("icacls", [readOnly, "/reset", "/T"], { stdio: "ignore" });
    } catch {
      // Best effort; the folder is ours and in temp.
    }
    removeDir(scratch);
  }
});

// ---------------------------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------------------------

test("B wizard: skipping ahead by URL on an empty app; Finish setup with nothing done", async ({ page, startServer }) => {
  const server = await startServer({ seed: "none" });
  const results: Record<string, unknown> = {};
  for (let step = 1; step <= 8; step += 1) {
    await page.goto(`${server.origin}/setup/${step}#token=${server.token}`);
    await page.waitForTimeout(500);
    const heading = await page.getByRole("heading", { level: 1 }).first().innerText();
    const progress = await page.getByText(/^Step \d+ of \d+$/).first().innerText().catch(() => "");
    const buttons = await page.getByRole("button").allInnerTexts();
    results[`step-${step}`] = { heading, progress, buttons, alerts: await alertTexts(page) };
    await page.screenshot({ path: auditPath("screens", "b", `wizard-skip-step-${step}.png`), fullPage: true });
  }
  for (const odd of ["99", "abc", "0", "-3"]) {
    await page.goto(`${server.origin}/setup/${odd}`);
    results[`step-${odd}`] = await page.getByRole("heading", { level: 1 }).first().innerText().catch(() => "no heading");
  }
  // Finish setup with nothing done.
  await page.goto(`${server.origin}/setup/8`);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.waitForTimeout(1500);
  results.afterFinishWithNothing = { url: page.url(), alerts: await alertTexts(page), heading: await page.getByRole("heading", { level: 1 }).first().innerText().catch(() => "") };
  await page.screenshot({ path: auditPath("screens", "b", "wizard-finish-with-nothing.png"), fullPage: true });
  const setupComplete = (await server.api<{ setupComplete: boolean }>("/api/today")).setupComplete;
  results.setupCompleteAfter = setupComplete;
  if (setupComplete) {
    await page.goto(`${server.origin}/today`);
    const find = page.getByRole("button", { name: "Find jobs" });
    if (await find.isVisible().catch(() => false)) {
      await find.click();
      const dialog = page.getByRole("dialog", { name: "Before your first run" });
      if (await dialog.isVisible().catch(() => false)) await dialog.getByRole("button", { name: "I understand, continue" }).click();
      await page.waitForTimeout(8000);
      results.todayAfterEmptySetupFind = { text: await mainText(page), alerts: await alertTexts(page) };
      await page.screenshot({ path: auditPath("screens", "b", "wizard-find-after-empty-setup.png"), fullPage: true });
    }
  }
  const evidence = writeEvidence("b-wizard-skip-ahead.json", results);
  check(!setupComplete, {
    id: "B-wizard-finish-empty", severity: "P1", title: "Setup can be finished with no folder, no resume, no story, no answers and no targets just by opening step 8", persona: "Maya", area: "Setup wizard", prd: "S1, 'setup is the gate to Find jobs'",
    expected: "Finish is refused (or the earlier steps are required) with a plain reason", actual: JSON.stringify({ after: results.afterFinishWithNothing, setupComplete }), evidence: [evidence],
    suspectedFile: "packages/server/src/services/setup.ts (finishSetup); apps/dashboard/src/screens/setup/steps/FinishStep.tsx", wrong: "product",
  });
});

test("B wizard: zero confirmed story items and empty targets, then Find jobs; reload and Back on every step", async ({ page, startServer }) => {
  const server = await startServer({ seed: "none" });
  await uploadResumeAndChooseFolder(server);
  await waitUntilNoRunIsActive(server);
  const results: Record<string, unknown> = {};
  await page.goto(`${server.origin}/setup/5#token=${server.token}`);
  await expect(page.getByRole("heading", { level: 1, name: "Your story" })).toBeVisible();
  const continueButton = page.getByRole("button", { name: "Continue" });
  results.story = { text: (await mainText(page)).slice(0, 400), continueEnabled: await continueButton.isEnabled(), hint: await page.getByText(/confirm|Continue opens/i).first().innerText().catch(() => "") };
  await page.screenshot({ path: auditPath("screens", "b", "wizard-story-zero-confirmed.png"), fullPage: true });
  if (await continueButton.isEnabled()) await continueButton.click();
  await page.waitForTimeout(500);
  results.afterStoryContinue = { heading: await page.getByRole("heading", { level: 1 }).first().innerText() };

  // Form answers: all empty, Save and continue.
  await page.goto(`${server.origin}/setup/6`);
  await page.getByRole("button", { name: "Save and continue" }).click().catch(() => undefined);
  await page.waitForTimeout(800);
  results.answersEmptySave = { heading: await page.getByRole("heading", { level: 1 }).first().innerText(), alerts: await alertTexts(page), text: (await mainText(page)).slice(0, 500) };
  await page.screenshot({ path: auditPath("screens", "b", "wizard-answers-empty.png"), fullPage: true });

  // Targets: empty.
  await page.goto(`${server.origin}/setup/7`);
  await page.getByRole("button", { name: "Save and continue" }).click().catch(() => undefined);
  await page.waitForTimeout(800);
  results.targetsEmptySave = { heading: await page.getByRole("heading", { level: 1 }).first().innerText(), alerts: await alertTexts(page), text: (await mainText(page)).slice(0, 500) };
  await page.screenshot({ path: auditPath("screens", "b", "wizard-targets-empty.png"), fullPage: true });

  await page.goto(`${server.origin}/setup/8`);
  results.finishText = await mainText(page);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await page.getByRole("button", { name: "Find jobs" }).first().click();
  await page.waitForTimeout(500);
  const notice = page.getByRole("dialog", { name: "Before your first run" });
  if (await notice.isVisible().catch(() => false)) await notice.getByRole("button", { name: "I understand, continue" }).click();
  await waitUntilNoRunIsActive(server, 120_000);
  await page.reload();
  results.todayAfterFindWithNothingConfirmed = { body: await mainText(page), alerts: await alertTexts(page) };
  await page.screenshot({ path: auditPath("screens", "b", "wizard-find-with-zero-confirmed.png"), fullPage: true });
  const pipeline = await server.api<{ id: string; company: string; status: string }[]>("/api/pipeline");
  results.pipelineSize = pipeline.length;
  // With nothing confirmed, what did the tailored resume end up holding?
  const acmeRow = pipeline.find((row) => row.company === "Acme Cloud");
  let emptyResume = false;
  if (acmeRow !== undefined) {
    const acmeDetail = await server.api<any>(`/api/apps/${acmeRow.id}`);
    const pdf = await fetch(`${server.origin}/api/apps/${acmeRow.id}/resume.pdf`, { headers: { Authorization: `Bearer ${server.token}` } });
    const { readPdfInfo } = await import("./helpers");
    const info = await readPdfInfo(new Uint8Array(await pdf.arrayBuffer()));
    const confirmedNow = (await server.api<{ status: string }[]>("/api/story")).filter((item) => item.status === "confirmed").length;
    emptyResume = !/Northwind|Experience/i.test(info.text);
    results.acmeWithNothingConfirmed = { status: acmeRow.status, confirmedItems: confirmedNow, resumeTextStart: info.text.replace(/\s+/g, " ").slice(0, 300), pages: info.pages, canApprove: acmeDetail.actions.canApprove, fit: acmeDetail.fit?.score ?? acmeDetail.fit };
    await page.goto(`${server.origin}/review/${acmeRow.id}`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: auditPath("screens", "b", "wizard-zero-confirmed-review.png"), fullPage: true });
  }

  // Reload and Back on every step (setup is done now, but the steps are still reachable).
  const backs: Record<string, unknown> = {};
  for (let step = 2; step <= 8; step += 1) {
    await page.goto(`${server.origin}/setup/${step}`);
    const before = await page.getByRole("heading", { level: 1 }).first().innerText();
    await page.reload();
    const afterReload = await page.getByRole("heading", { level: 1 }).first().innerText();
    const backButton = page.getByRole("button", { name: "Back" });
    let afterBack = "no Back button";
    if ((await backButton.count()) > 0) {
      await backButton.first().click();
      await page.waitForTimeout(400);
      afterBack = await page.getByRole("heading", { level: 1 }).first().innerText();
    }
    if (step === 5) {
      await page.waitForTimeout(1500);
      backs["step-5-after-1.5s"] = { url: new URL(page.url()).pathname, heading: await page.getByRole("heading", { level: 1 }).first().innerText() };
    }
    backs[`step-${step}`] = { before, afterReload, afterBack };
  }
  results.reloadAndBack = backs;
  const evidence = writeEvidence("b-wizard-empty-and-back.json", results);
  const pipelineStatuses = pipeline.map((row) => row.status).join(",");
  check(!emptyResume && acmeRow === undefined || !emptyResume, {
    id: "B-wizard-zero-story", severity: "P1", title: "A person who skips Your story by address can finish setup with nothing confirmed, run Find jobs, and be handed a 'Ready to review' resume with no experience on it", persona: "Maya", area: "Setup (server does not require a confirmed story) / Review", prd: "S1, P2, T1",
    expected: "Finish (or Find jobs) is refused until at least something is confirmed, or Today says there is nothing to build a resume from", actual: `pipeline ${pipelineStatuses || "(empty)"}; ${JSON.stringify(results.acmeWithNothingConfirmed)}; Today: ${(results.todayAfterFindWithNothingConfirmed as { body: string }).body.slice(0, 300)}`, evidence: [evidence, auditPath("screens", "b", "wizard-zero-confirmed-review.png")],
    suspectedFile: "packages/server/src/services/setup.ts (finishSetup checks only the folder); services/tailoring.ts", wrong: "product",
  });
});

// ---------------------------------------------------------------------------------------------
// Form answers
// ---------------------------------------------------------------------------------------------

test("B answers: invalid email, emoji, very long values, a banned word in a contact field", async ({ page, startServer }) => {
  const server = await startServer({ seed: "none" });
  await seedVariant(server, { usageNoticeSeen: true, mutateProfile: (profile) => { profile.compensation = { expectedBase: "120000" }; } });
  await page.goto(`${server.origin}/profile/answers#token=${server.token}`);
  await expect(page.getByLabel("Full name")).toBeVisible();
  const results: Record<string, unknown> = {};
  const saveButton = page.getByRole("button", { name: /^Save/ });
  results.hasSaveButton = (await saveButton.count()) > 0;

  async function tryField(id: string, label: string | RegExp, value: string): Promise<void> {
    const field = page.getByLabel(label, { exact: typeof label === "string" });
    await field.fill(value);
    await field.blur();
    if ((await saveButton.count()) > 0 && (await saveButton.first().isEnabled())) await saveButton.first().click();
    await page.waitForTimeout(900);
    const profile = await server.api<{ profile: { contact: Record<string, string> } }>("/api/profile");
    results[id] = {
      alerts: await alertTexts(page),
      fieldErrors: await page.locator("[id$='-error'], [role=alert], .text-danger").allInnerTexts(),
      saved: await page.getByText("Saved", { exact: true }).count(),
      storedContact: profile.profile.contact,
    };
  }
  await tryField("bad-email", "Email address", "not-an-email");
  await page.screenshot({ path: auditPath("screens", "b", "answers-bad-email.png"), fullPage: true });
  await tryField("emoji-name", "Full name", "Alex 😀 Rivera 🚀");
  await tryField("very-long", "Where you live", "Austin, ".repeat(900));
  await page.screenshot({ path: auditPath("screens", "b", "answers-very-long.png"), fullPage: true });
  await tryField("banned-word", "Full name", "Alex Rockstar Rivera");
  await page.screenshot({ path: auditPath("screens", "b", "answers-banned-word.png"), fullPage: true });
  await tryField("bad-phone", "Phone number", "call me maybe");
  await tryField("empty-name", "Full name", "");
  await page.screenshot({ path: auditPath("screens", "b", "answers-empty-name.png"), fullPage: true });
  const evidence = writeEvidence("b-answers.json", results);

  const email = results["bad-email"] as { alerts: string[]; fieldErrors: string[]; storedContact: Record<string, string> };
  check(email.storedContact.email !== "not-an-email" || email.fieldErrors.length > 0 || email.alerts.length > 0, {
    id: "B-answers-email", severity: "P2", title: "An email address that is not an email is saved without any warning", persona: "Maya", area: "Profile > Form answers", prd: "P3",
    expected: "The form explains the email looks wrong before it can be sent on an application", actual: JSON.stringify(email), evidence: [evidence], wrong: "product",
  });
  const banned = results["banned-word"] as { alerts: string[]; fieldErrors: string[]; storedContact: Record<string, string> };
  check(!/rockstar/i.test(banned.storedContact.fullName ?? "") || banned.alerts.some((text) => /rockstar/i.test(text)), {
    id: "B-answers-banned-contact", severity: "P1", title: "A banned word typed into the name field is saved with no warning (it would reach every application)", persona: "Maya", area: "Profile > Form answers", prd: "P5",
    expected: "Refused at save with the word named (the rules say banned words must never appear in form details)", actual: JSON.stringify(banned), evidence: [evidence], suspectedFile: "packages/server/src/services/profile.ts (updateProfileSection has no banned-term check); refused only at Approve (approvals.ts:107-112)", wrong: "product",
  });
  const longValue = results["very-long"] as { storedContact: Record<string, string>; alerts: string[]; fieldErrors: string[] };
  check((longValue.storedContact.location ?? "").length < 500 || longValue.alerts.length > 0 || longValue.fieldErrors.length > 0, {
    id: "B-answers-very-long", severity: "P3", title: "A 7,000-character 'Where you live' is saved without a limit or warning (it goes into every resume header and form)", persona: "Maya", area: "Profile > Form answers", prd: "P3, T1 (one page)",
    expected: "A sensible limit or a warning", actual: `stored length ${(longValue.storedContact.location ?? "").length}`, evidence: [evidence], wrong: "product",
  });
  const phone = results["bad-phone"] as { storedContact: Record<string, string>; fieldErrors: string[]; alerts: string[] };
  check(phone.storedContact.phone !== "call me maybe" || phone.fieldErrors.length > 0 || phone.alerts.length > 0, {
    id: "B-answers-phone", severity: "P3", title: "A phone number that is not a number is saved without a warning", persona: "Maya", area: "Profile > Form answers", prd: "P3",
    expected: "A hint", actual: JSON.stringify(phone), evidence: [evidence], wrong: "product",
  });
  const empty = results["empty-name"] as { storedContact: Record<string, string>; alerts: string[]; fieldErrors: string[] };
  check((empty.storedContact.fullName ?? "x") !== "" || empty.fieldErrors.length > 0 || empty.alerts.length > 0, {
    id: "B-answers-empty-name", severity: "P2", title: "The full name can be emptied and saved silently", persona: "Maya", area: "Profile > Form answers", prd: "P3",
    expected: "Name is required or flagged missing", actual: JSON.stringify(empty), evidence: [evidence], wrong: "product",
  });
});

// ---------------------------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------------------------

test("B display: very long company and title names on every screen; unknown routes; a deep link without the key", async ({ page, browser, startServer }) => {
  const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
  const results: Record<string, unknown> = {};
  const longCompany = `Extraordinarily${"Longnamed".repeat(14)}Industries`;
  const longTitle = "Senior Principal Distinguished Backend Platform Infrastructure Reliability Engineering Lead, ".repeat(3).trim();
  await page.goto(server.url);
  await page.getByRole("button", { name: "Add a job" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a job" });
  await dialog.getByRole("button", { name: "Paste the job text instead" }).click();
  await dialog.getByLabel("Company").fill(longCompany);
  await dialog.getByLabel("Job title").fill(longTitle);
  await dialog.getByLabel("Place (optional)").fill("Remote");
  await dialog.getByLabel("Job description").fill("Backend Engineer building Python services on PostgreSQL with Docker and Kubernetes on AWS. 2+ years of experience. Fully remote.");
  await dialog.getByRole("button", { name: "Add job" }).click();
  await waitUntilNoRunIsActive(server, 120_000);
  const rows = await server.api<{ id: string; company: string; status: string }[]>("/api/pipeline");
  const row = rows.find((candidate) => candidate.company === longCompany);
  results.pipelineRow = row ?? null;
  const screens: { name: string; url: string }[] = [
    { name: "today", url: "/today" },
    { name: "pipeline-board", url: "/pipeline" },
    { name: "pipeline-list", url: "/pipeline?view=list" },
    ...(row ? [{ name: "application", url: `/apps/${row.id}` }, { name: "review", url: `/review/${row.id}` }] : []),
  ];
  const overflow: Record<string, unknown> = {};
  for (const screen of screens) {
    await page.goto(`${server.origin}${screen.url}`);
    await page.waitForTimeout(900);
    const result = await sweep(page, `long-names ${screen.name}`, { screenshot: `screens/b/longnames-${screen.name}.png`, axe: false });
    overflow[screen.name] = { overflow: result.horizontalOverflow, scrollWidth: result.scrollWidth, clientWidth: result.clientWidth };
  }
  results.overflow = overflow;

  // Unknown routes and ids.
  const unknown: Record<string, unknown> = {};
  for (const route of ["/nope", "/review/does-not-exist", "/apps/does-not-exist", "/apply/does-not-exist", "/profile/zzz", "/pipeline?view=bogus&q=%3Cscript%3E"]) {
    await page.goto(`${server.origin}${route}`);
    await page.waitForTimeout(900);
    unknown[route] = { final: new URL(page.url()).pathname, text: (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 260) };
    await page.screenshot({ path: auditPath("screens", "b", `route-${route.replace(/[^a-z0-9]+/gi, "-")}.png`), fullPage: false });
  }
  results.unknownRoutes = unknown;

  // A deep link with no key: a fresh browser context, no #token.
  const bare = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const barePage = await bare.newPage();
  await barePage.goto(`${server.origin}/today`);
  await barePage.waitForTimeout(1500);
  results.deepLinkNoToken = { text: (await barePage.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 400), alerts: await barePage.getByRole("alert").allInnerTexts() };
  await barePage.screenshot({ path: auditPath("screens", "b", "deep-link-no-token.png"), fullPage: true });
  await barePage.goto(`${server.origin}/review/anything`);
  await barePage.waitForTimeout(1200);
  results.deepLinkNoTokenReview = (await barePage.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300);
  await bare.close();

  const evidence = writeEvidence("b-display.json", results);
  for (const [name, value] of Object.entries(overflow)) {
    check(!(value as { overflow: boolean }).overflow, {
      id: `B-longname-overflow-${name}`, severity: "P2", title: `A very long company or title makes ${name} scroll sideways`, persona: "Both", area: name, prd: "Layout",
      expected: "Long names wrap or are cut with an ellipsis", actual: JSON.stringify(value), evidence: [evidence, auditPath("screens", "b", `longnames-${name}.png`)], wrong: "product",
    });
  }
  const noKey = results.deepLinkNoToken as { text: string };
  check(/Close Jobgoblin and open it again|could not be reached|did not recognise|Open Jobgoblin/i.test(noKey.text), {
    id: "B-deeplink-no-token", severity: "P2", title: "Opening a Jobgoblin address without its key shows a screen that does not say what to do", persona: "Maya", area: "Any screen", prd: "R4",
    expected: "A plain message on how to open Jobgoblin properly", actual: noKey.text, evidence: [evidence, auditPath("screens", "b", "deep-link-no-token.png")], wrong: "product",
  });
});
