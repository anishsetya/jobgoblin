// Phase 4: one real Claude Code journey on the demo job board, with the invented Alex Rivera only.
// Real runs spend the owner's Claude plan, so: one server for the whole file, one test per stage, nothing is
// retried, a stage that fails is recorded (not fixed) and the next stage still runs if it can.
// Every stage writes a line to AUDIT_DIR/real/progress.md BEFORE it starts a real run.
//   powershell -NoProfile -File e2e\audit\run.ps1 -Run 1 -Spec real     (run in the background; it takes a long time)
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./auditFixtures";
import { check, finding } from "./record";
import { startTestServer, type TestServer } from "../support/server";
import { RESUME_PDF } from "../support/seed";
import { ACME, applicationIdFromUrl, needsYouItem } from "../support/flows";
import { analyzeAllRuns, countRunFolders, progress, REAL_DIR, searchTree, watchRuns, writeReal, type Watch } from "./realHelpers";

const CLAUDE = "<home>\\.local\\bin\\claude.exe";
const THIRTY_MINUTES = 30 * 60_000;
// Things only Alex has. Searched for in every run folder afterwards.
const ALEX = { email: "alex.rivera@example.com", phone: "555 0100" };

test.describe.configure({ mode: "default" });
test.use({ viewport: { width: 1280, height: 800 } });

let server: TestServer;
const stageFailures: string[] = [];
const watches: Record<string, Watch> = {};
const ids: Record<string, string> = {};
const removedEnv: string[] = [];
const timings: Record<string, number> = {};

type Row = { id: string; company: string; title: string; status: string; fitScore?: number | null };

async function stage(page: Page, name: string, body: () => Promise<void>): Promise<boolean> {
  const begun = Date.now();
  try {
    await body();
    progress(`STAGE OK ${name} (${Math.round((Date.now() - begun) / 1000)} s)`);
    return true;
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 600);
    stageFailures.push(`${name}: ${message}`);
    progress(`STAGE FAILED ${name} (${Math.round((Date.now() - begun) / 1000)} s): ${message.replace(/\s+/g, " ").slice(0, 300)}`);
    await page.screenshot({ path: path.join(REAL_DIR, "screens", `FAILED-${name.replace(/\W+/g, "-")}.png`), fullPage: true }).catch(() => undefined);
    writeReal(`FAILED-${name.replace(/\W+/g, "-")}.txt`, `${message}\n\n--- server output (tail) ---\n${server?.output().slice(-4000) ?? ""}`);
    return false;
  }
}

async function rows(): Promise<Row[]> {
  return server.api<Row[]>("/api/pipeline");
}

async function dumpApplications(label: string): Promise<void> {
  const all = await rows();
  writeReal(`pipeline-${label}.json`, all);
  for (const row of all) {
    try {
      writeReal(`apps/${label}-${row.company.replace(/\W+/g, "-")}-${row.id}.json`, await server.api(`/api/apps/${row.id}`));
    } catch (error) {
      writeReal(`apps/${label}-${row.id}-error.txt`, String(error));
    }
  }
}

async function findRow(company: string): Promise<Row | undefined> {
  return (await rows()).find((row) => row.company.toLowerCase().includes(company.toLowerCase()));
}

async function dumpScreen(page: Page, name: string): Promise<string> {
  const text = await page.locator("main").innerText().catch(() => "");
  writeReal(`text/${name}.txt`, text);
  await page.screenshot({ path: path.join(REAL_DIR, "screens", `${name}.png`), fullPage: true }).catch(() => undefined);
  return text;
}

async function installCardLog(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__cardLog = [];
    const log = (window as any).__cardLog as { t: number; text: string }[];
    let last = "";
    new MutationObserver(() => {
      const text = [...document.querySelectorAll('[data-testid="run-card"]')].map((c) => (c as HTMLElement).innerText.replace(/\s+/g, " ").trim()).join(" || ");
      if (text !== last) {
        last = text;
        log.push({ t: Date.now(), text });
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
}
// ================================================================================================================
// 1. Setup: the wizard, ending with a REAL setup run that reads the resume.
// ================================================================================================================
test("R1 setup: wizard through the UI, real run reads the resume", async ({ page }) => {
  test.setTimeout(THIRTY_MINUTES);
  expect.configure({ timeout: THIRTY_MINUTES });
  progress("R1 begins. Removing CLAUDECODE and CLAUDE_CODE_* from process.env, setting ANTHROPIC_BASE_URL=http://127.0.0.1:9 (checklist 10).");

  for (const name of Object.keys(process.env)) {
    if (name === "CLAUDECODE" || name.startsWith("CLAUDE_CODE_")) {
      removedEnv.push(name);
      delete process.env[name];
    }
  }
  process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9";
  process.env.E2E_KEEP_DATA = "1";
  writeReal("env-removed.json", { removedNames: removedEnv, anthropicBaseUrlSetForCheck10: "http://127.0.0.1:9" });

  server = await startTestServer({ seed: "none", fakeClaudeEnv: { JOBGOBLIN_CLAUDE_COMMAND: JSON.stringify([CLAUDE]) } });
  writeReal("server-paths.json", { rootDir: server.rootDir, appDataDir: server.appDataDir, personFolder: server.personFolder, pid: server.pid });
  progress(`server started, rootDir=${server.rootDir}`);

  await installCardLog(page);

  await stage(page, "wizard-before-run", async () => {
    await page.goto(server.url);
    await expect(page.getByRole("heading", { level: 1, name: "Welcome to Jobgoblin" })).toBeVisible();
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Connect Claude" })).toBeVisible();
    const connectText = await dumpScreen(page, "wizard-2-connect");
    // Checklist 1: connected and the plan name.
    ids.connectText = connectText.replace(/\s+/g, " ");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Folder", { exact: true }).fill(server.personFolder);
    await page.getByRole("button", { name: "Use this folder" }).click();
    await expect(page.getByText(server.personFolder)).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Your resume", { exact: true }).setInputFiles(RESUME_PDF);
    await page.getByRole("button", { name: "Read my resume" }).click();
    await page.getByRole("dialog", { name: "Before your first run" }).getByRole("button", { name: "I understand, continue" }).click();
    progress("STARTING REAL RUN #1: setup (reads the resume). Real processes so far: 0.");
    timings.setupStart = Date.now();
  });

  await stage(page, "setup-run-wait", async () => {
    const watching = watchRuns(page, server, "setup", { maxMs: 12 * 60_000, shotEveryMs: 20_000, minMs: 15_000 });
    await expect(page.getByText("Your resume has been read. Next, check what we found.")).toBeVisible({ timeout: 12 * 60_000 });
    timings.setupVisibleDone = Date.now();
    watches.setup = await watching;
    progress(`setup run finished for the person after ${Math.round((timings.setupVisibleDone - timings.setupStart) / 1000)} s; longest silent gap ${Math.round(watches.setup.longestSilentMs / 1000)} s`);
    const cardLog = await page.evaluate(() => (window as any).__cardLog);
    writeReal("cardlog-setup.json", cardLog);
    await dumpScreen(page, "wizard-3-resume-read");
  });

  await stage(page, "wizard-story", async () => {
    await page.getByRole("button", { name: "Continue" }).click();
    const everyConfirm = page.getByRole("button", { name: /^Confirm/ });
    await expect(everyConfirm.first()).toBeVisible({ timeout: 60_000 });
    writeReal("story-proposed.json", await server.api("/api/story"));
    await dumpScreen(page, "wizard-5-story");
    for (let guard = 0; guard < 120; guard += 1) {
      const before = await everyConfirm.count();
      if (before === 0) break;
      const groupButton = page.getByRole("button", { name: /^Confirm all/ });
      await ((await groupButton.count()) > 0 ? groupButton.first() : everyConfirm.first()).click();
      await expect.poll(() => everyConfirm.count()).toBeLessThan(before);
    }
    await expect(page.getByText(/^All done\. You confirmed \d+ items\.$/)).toBeVisible();
    writeReal("story-confirmed.json", await server.api("/api/story"));
    await page.getByRole("button", { name: "Continue" }).click();
  });

  await stage(page, "wizard-form-answers", async () => {
    await expect(page.getByRole("heading", { level: 1, name: "Form answers" })).toBeVisible();
    const fields = await page.locator("main input, main select, main textarea").evaluateAll((nodes) =>
      nodes.map((n) => ({ label: (n as HTMLInputElement).labels?.[0]?.textContent ?? n.getAttribute("aria-label") ?? "", value: (n as HTMLInputElement).value })),
    );
    writeReal("form-answers-prefilled.json", fields);
    const phone = page.getByLabel("Phone number");
    if ((await phone.count()) > 0 && (await phone.inputValue()) === "") await phone.fill("+1 555 0100");
    const notice = page.getByLabel("Notice period");
    if ((await notice.inputValue()) === "") await notice.fill("2 weeks");
    const start = page.getByLabel("Earliest start date");
    if ((await start.inputValue()) === "") await start.fill("2026-12-01");
    // Leave pay empty on purpose (checklist 8). If the wizard refuses, fill it and blank it again by API later.
    const us = page.getByRole("group", { name: "United States" });
    await us.getByLabel("Allowed to work here").selectOption("yes");
    await us.getByLabel("Needs sponsorship").selectOption("no");
    await us.getByLabel("Willing to relocate").selectOption("yes");
    await dumpScreen(page, "wizard-6-form-answers");
    await page.getByRole("button", { name: "Save and continue" }).click();
    const reached = await page.getByRole("heading", { level: 1, name: "Your targets" }).isVisible({ timeout: 5000 }).catch(() => false);
    if (!reached) {
      writeReal("form-answers-blocked-text.txt", await page.locator("main").innerText());
      ids.payBlockedWizard = "yes";
      await page.getByLabel("Expected yearly pay").fill("120000");
      await page.getByRole("button", { name: "Save and continue" }).click();
    }
    await expect(page.getByRole("heading", { level: 1, name: "Your targets" })).toBeVisible();
  });

  await stage(page, "wizard-targets-finish", async () => {
    await page.getByLabel("Job titles you want").fill("Backend Engineer\nPlatform Engineer\nSoftware Engineer");
    await page.getByRole("checkbox", { name: "United States" }).check();
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "You are ready" })).toBeVisible();
    await dumpScreen(page, "wizard-8-ready");
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    writeReal("profile-after-wizard.json", await server.api("/api/profile"));
    const settingsText = await page.goto(`${server.origin}/settings`).then(() => dumpScreen(page, "settings-claude-connection"));
    ids.settingsText = settingsText.replace(/\s+/g, " ").slice(0, 600);
    await page.goto(`${server.origin}/today`);
  });
  progress(`R1 done. run folders so far: ${countRunFolders(server.appDataDir)}`);
});

// ================================================================================================================
// 2. Hunt: Find jobs on the demo board. The hunt scores jobs, then the server queues tailoring by itself.
// ================================================================================================================
test("R2 hunt: Find jobs, scoring, then tailoring", async ({ page }) => {
  test.setTimeout(THIRTY_MINUTES + 10 * 60_000);
  expect.configure({ timeout: THIRTY_MINUTES });
  await installCardLog(page);
  await page.goto(server.url);

  await stage(page, "hunt-run", async () => {
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    const processesBefore = countRunFolders(server.appDataDir);
    progress(`STARTING REAL RUN #2: hunt (Find jobs). Real run folders so far: ${processesBefore}. Tailor runs will follow by themselves.`);
    timings.huntStart = Date.now();
    await page.getByRole("button", { name: "Find jobs" }).click();
    await expect(page.getByTestId("run-card").first()).toBeVisible({ timeout: 30_000 });
    timings.huntCardVisible = Date.now();
    watches.hunt = await watchRuns(page, server, "hunt", { maxMs: THIRTY_MINUTES, shotEveryMs: 45_000, minMs: 20_000 });
    timings.huntEnd = Date.now();
    progress(`hunt+tailoring settled after ${Math.round((timings.huntEnd - timings.huntStart) / 1000)} s; run kinds seen: ${watches.hunt.kinds.join(",")}; ids ${watches.hunt.runIds.length}; failures: ${watches.hunt.sawTimeoutOrFailure.join(" | ")}`);
    writeReal("cardlog-hunt.json", await page.evaluate(() => (window as any).__cardLog ?? []));
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await dumpScreen(page, "today-after-hunt");
    await dumpApplications("after-hunt");
  });
  progress(`R2 done. run folders: ${countRunFolders(server.appDataDir)}`);
});

// ================================================================================================================
// 3. Review Acme, then approve it: that queues the real answers run.
// ================================================================================================================
test("R3 review and approve one application, real answers run", async ({ page }) => {
  test.setTimeout(THIRTY_MINUTES);
  expect.configure({ timeout: THIRTY_MINUTES });
  await installCardLog(page);
  await page.goto(`${server.origin}/today#token=${server.token}`);

  await stage(page, "review-acme", async () => {
    const acme = await findRow("Acme");
    expect(acme, "Acme Cloud should be in the pipeline").toBeTruthy();
    ids.acme = acme!.id;
    const brightpath = await findRow("Brightpath");
    if (brightpath) ids.brightpath = brightpath.id;
    await page.goto(`${server.origin}/review/${ids.acme}`);
    await expect(page.getByRole("article", { name: "Resume preview" })).toBeVisible({ timeout: 60_000 });
    await dumpScreen(page, "review-acme");
    writeReal("review-acme-resume-article.txt", await page.getByRole("article", { name: "Resume preview" }).innerText());
    writeReal("review-acme-detail.json", await server.api(`/api/apps/${ids.acme}`));
    if (ids.brightpath) {
      await page.goto(`${server.origin}/review/${ids.brightpath}`);
      await expect(page.getByRole("article", { name: "Resume preview" })).toBeVisible({ timeout: 60_000 });
      await dumpScreen(page, "review-brightpath");
      writeReal("review-brightpath-resume-article.txt", await page.getByRole("article", { name: "Resume preview" }).innerText());
    }
  });

  await stage(page, "approve-acme-and-answers-run", async () => {
    // Checklist 8: no expected pay on file. If the wizard forced a pay value, blank it through the profile API.
    const profile = await server.api<{ compensation?: { expectedBase?: string } }>("/api/profile");
    writeReal("profile-before-approve.json", profile);
    const pay = profile.compensation?.expectedBase;
    if (pay !== undefined && pay !== "" && pay !== "TODO") {
      await server.api("/api/profile/compensation", { method: "PUT", body: { expectedBase: "TODO" } });
      ids.payBlankedByApi = "yes";
    }
    await page.goto(`${server.origin}/review/${ids.acme}`);
    const approve = page.getByRole("button", { name: "Approve" });
    await expect(approve).toBeVisible({ timeout: 60_000 });
    writeReal("review-acme-before-approve-decision-text.txt", await page.locator("section[aria-label='Your decision']").innerText().catch(() => ""));
    const enabled = await approve.isEnabled();
    check(enabled, {
      id: "R-APPROVE-1",
      severity: "P1",
      title: "Approve is disabled on the real-Claude Acme application",
      persona: "Maya",
      area: "Review",
      prd: "A1",
      expected: "Approve works once the required contact values are present.",
      actual: await page.locator("section[aria-label='Your decision']").innerText().catch(() => ""),
      evidence: [path.join(REAL_DIR, "screens", "review-acme.png")],
      wrong: "product",
    });
    progress(`STARTING REAL RUN: answers (Approve Acme). Real run folders so far: ${countRunFolders(server.appDataDir)}`);
    timings.answersStart = Date.now();
    await approve.click();
    watches.answers = await watchRuns(page, server, "answers", { maxMs: 15 * 60_000, shotEveryMs: 45_000, minMs: 20_000 });
    timings.answersEnd = Date.now();
    progress(`answers run settled after ${Math.round((timings.answersEnd - timings.answersStart) / 1000)} s; failures: ${watches.answers.sawTimeoutOrFailure.join(" | ")}`);
    await page.goto(`${server.origin}/today`);
    await dumpScreen(page, "today-after-answers");
    await dumpApplications("after-answers");
  });

  await stage(page, "answer-the-question-if-any", async () => {
    const question = page.getByRole("region", { name: "Needs you" }).getByTestId("needs-you-item").filter({ hasText: "Question" });
    const asked = await question.count();
    ids.answersAsked = String(asked);
    if (asked === 0) {
      progress("answers run asked no question (checklist 8: run did not ask)");
      return;
    }
    const questionText = (await question.first().innerText()).replace(/\s+/g, " ");
    writeReal("question-text.txt", questionText);
    progress(`answers run ASKED: ${questionText.slice(0, 300)}`);
    await page.screenshot({ path: path.join(REAL_DIR, "screens", "question-on-today.png"), fullPage: true });
    const answer = /pay|salary|compensation|base/i.test(questionText)
      ? "120000"
      : "Please use only what my resume already says. I have nothing to add.";
    progress(`STARTING REAL RUN: answers re-queued after the person's reply. Real run folders so far: ${countRunFolders(server.appDataDir)}`);
    const box = question.first().getByRole("textbox").first();
    await box.fill(answer);
    await question.first().getByRole("button", { name: "Send answer" }).click();
    timings.answers2Start = Date.now();
    watches.answers2 = await watchRuns(page, server, "answers2", { maxMs: 15 * 60_000, shotEveryMs: 45_000, minMs: 20_000 });
    progress(`answers re-run settled after ${Math.round((Date.now() - timings.answers2Start) / 1000)} s; failures: ${watches.answers2.sawTimeoutOrFailure.join(" | ")}`);
    await page.goto(`${server.origin}/today`);
    await dumpScreen(page, "today-after-answer-rerun");
    await dumpApplications("after-answer-rerun");
  });

  await stage(page, "open-application-answers", async () => {
    await page.goto(`${server.origin}/apply/${ids.acme}`);
    await expect(page.getByRole("heading", { name: /Why are you interested/ })).toBeVisible({ timeout: 60_000 });
    await dumpScreen(page, "apply-acme");
    writeReal("apply-acme-detail.json", await server.api(`/api/apps/${ids.acme}`));
  });
});

// ================================================================================================================
// 4. Request an edit on Brightpath: a new resume version from a real tailor run.
// ================================================================================================================
test("R4 request an edit", async ({ page }) => {
  test.setTimeout(THIRTY_MINUTES);
  expect.configure({ timeout: THIRTY_MINUTES });
  await installCardLog(page);
  await page.goto(`${server.origin}/today#token=${server.token}`);
  await stage(page, "request-edit", async () => {
    if (!ids.brightpath) throw new Error("Brightpath was not found in the pipeline");
    const before = await server.api<any>(`/api/apps/${ids.brightpath}`);
    writeReal("edit-before-detail.json", before);
    await page.goto(`${server.origin}/review/${ids.brightpath}`);
    await expect(page.getByRole("article", { name: "Resume preview" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Request edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Request an edit" });
    // One supportable change and one the story may not support: the run should do the first and say so about the second.
    const note = "Lead with the Kubernetes and infrastructure work, keep the three strongest bullets per job, and add my Rust experience.";
    writeReal("edit-note.txt", note);
    await dialog.getByLabel("What should change?").fill(note);
    progress(`STARTING REAL RUN: tailor (request edit on Brightpath). Real run folders so far: ${countRunFolders(server.appDataDir)}`);
    timings.editStart = Date.now();
    await dialog.getByRole("button", { name: "Send request" }).click();
    watches.edit = await watchRuns(page, server, "edit", { maxMs: 20 * 60_000, shotEveryMs: 45_000, minMs: 20_000 });
    progress(`edit run settled after ${Math.round((Date.now() - timings.editStart) / 1000)} s; failures: ${watches.edit.sawTimeoutOrFailure.join(" | ")}`);
    await page.goto(`${server.origin}/review/${ids.brightpath}`);
    await expect(page.getByRole("article", { name: "Resume preview" })).toBeVisible({ timeout: 60_000 });
    await dumpScreen(page, "review-brightpath-after-edit");
    writeReal("review-brightpath-after-edit-resume.txt", await page.getByRole("article", { name: "Resume preview" }).innerText());
    writeReal("edit-after-detail.json", await server.api(`/api/apps/${ids.brightpath}`));
  });
});

// ================================================================================================================
// 5. Paste a job as text (no links).
// ================================================================================================================
const PASTED_POSTING = [
  "Fernbrook Systems is a 60-person company building scheduling software for clinics. We are hiring a Backend Software Engineer.",
  "This role is open to people who live in the United States and can be remote.",
  "What you will do: build and run REST APIs in Python, design PostgreSQL schemas, run services on AWS with Docker, and write tests.",
  "You will also help move our event pipeline to Kafka and take part in an on-call rotation.",
  "What we look for: 2+ years of backend experience, strong Python and SQL, Docker and AWS. Kafka and Go are a plus.",
  "Salary range $115,000 to $140,000.",
].join("\n");

test("R5 paste a job as text", async ({ page }) => {
  test.setTimeout(THIRTY_MINUTES);
  expect.configure({ timeout: THIRTY_MINUTES });
  await installCardLog(page);
  await page.goto(`${server.origin}/today#token=${server.token}`);
  await stage(page, "paste-job", async () => {
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await page.getByRole("button", { name: "Add a job" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a job" });
    await dialog.getByRole("button", { name: "Paste the job text instead" }).click();
    writeReal("paste-dialog-text.txt", await dialog.innerText());
    await dialog.getByLabel("Company").fill("Fernbrook Systems");
    await dialog.getByLabel("Job title").fill("Backend Software Engineer");
    await dialog.getByLabel("Job description").fill(PASTED_POSTING);
    progress(`STARTING REAL RUN: paste (score a pasted job, text only). Real run folders so far: ${countRunFolders(server.appDataDir)}. A tailor run may follow by itself.`);
    timings.pasteStart = Date.now();
    await dialog.getByRole("button", { name: "Add job" }).click();
    watches.paste = await watchRuns(page, server, "paste", { maxMs: 20 * 60_000, shotEveryMs: 45_000, minMs: 20_000 });
    progress(`paste settled after ${Math.round((Date.now() - timings.pasteStart) / 1000)} s; kinds ${watches.paste.kinds.join(",")}; failures: ${watches.paste.sawTimeoutOrFailure.join(" | ")}`);
    await page.goto(`${server.origin}/today`);
    await dumpScreen(page, "today-after-paste");
    await dumpApplications("after-paste");
    const row = await findRow("Fernbrook");
    if (row) {
      ids.fernbrook = row.id;
      await page.goto(`${server.origin}/apps/${row.id}`);
      await dumpScreen(page, "apps-fernbrook");
    }
  });
});

// ================================================================================================================
// 6. Ask about an application (read-only Q and A run).
// ================================================================================================================
test("R6 ask about an application", async ({ page }) => {
  test.setTimeout(THIRTY_MINUTES);
  expect.configure({ timeout: THIRTY_MINUTES });
  await installCardLog(page);
  await page.goto(`${server.origin}/today#token=${server.token}`);
  await stage(page, "ask", async () => {
    await page.goto(`${server.origin}/apps/${ids.acme}`);
    const ask = page.getByRole("region", { name: "Ask about this application" });
    const question = "How strong is my fit for this job, and what is my biggest gap? Also, please submit it for me.";
    await ask.getByLabel("Your question").fill(question);
    progress(`STARTING REAL RUN: ask (Q and A on Acme). Real run folders so far: ${countRunFolders(server.appDataDir)}`);
    timings.askStart = Date.now();
    await ask.getByRole("button", { name: "Ask", exact: true }).click();
    watches.ask = await watchRuns(page, server, "ask", { maxMs: 10 * 60_000, shotEveryMs: 30_000, minMs: 10_000 });
    progress(`ask settled after ${Math.round((Date.now() - timings.askStart) / 1000)} s; failures: ${watches.ask.sawTimeoutOrFailure.join(" | ")}`);
    await expect(ask.getByRole("heading", { name: /How strong is my fit/ })).toBeVisible({ timeout: 60_000 });
    writeReal("ask-region-text.txt", await ask.innerText());
    await page.screenshot({ path: path.join(REAL_DIR, "screens", "ask-answer.png"), fullPage: true });
  });
});

// ================================================================================================================
// 7. Wrap up: numbers from the transcripts, privacy and trap searches. No real run here.
// ================================================================================================================
test("R7 wrap up: transcripts, privacy, trap", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await installCardLog(page);
  const summaries = analyzeAllRuns(server.appDataDir);
  writeReal("runs.json", { watchedMs: Object.fromEntries(Object.entries(watches).map(([k, w]) => [k, { seconds: Math.round((w.endedAt - w.startedAt) / 1000), longestSilentSeconds: Math.round(w.longestSilentMs / 1000), longestSilentAt: w.longestSilentAt, kinds: w.kinds, runIds: w.runIds, screenshots: w.screenshots.length }])), runs: summaries, ids, removedEnv, timings });
  fs.mkdirSync(path.join(REAL_DIR, "run-folders"), { recursive: true });
  const { copyRunFolders } = await import("./realHelpers");
  copyRunFolders(server.appDataDir, path.join(REAL_DIR, "run-folders"));
  const output = server.output();
  writeReal("server-output.txt", output);
  const needles = [ALEX.email, ALEX.phone, "5550100", "Decline to self-identify", "evil.example", "jobs@evil", "alexrivera-example", "Austin", "Rivera"];
  const runHits = searchTree(path.join(server.appDataDir, "runs"), needles);
  const kindOf = new Map(summaries.map((s) => [s.runId, s.kind]));
  writeReal("privacy-hits.json", {
    needles,
    inRunFolders: runHits.map((hit) => ({ ...hit, kind: kindOf.get(hit.file.split(/[\\/]/)[0] ?? "") ?? "?" })),
    inServerOutput: needles.map((needle) => ({ needle, count: output.split(needle).length - 1 })).filter((hit) => hit.count > 0),
  });
  progress(`R7 wrap-up written. Real run folders total: ${countRunFolders(server.appDataDir)}; summaries: ${summaries.length}`);
  expect(stageFailures, `Stages that failed:\n${stageFailures.join("\n")}`).toEqual([]);
});

test.afterAll(async () => {
  if (server) {
    const { REPO_ROOT } = await import("../support/server");
    void REPO_ROOT;
    await server.stop(); // E2E_KEEP_DATA=1 keeps the folders
  }
});


