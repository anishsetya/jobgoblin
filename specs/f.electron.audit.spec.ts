// Section F: the desktop app. Every launch uses a temporary JOBGOBLIN_APP_DATA (asserted) and stubs the computer's
// folder chooser, error dialog, openExternal and openPath before anything can click them.
//   F1 golden path inside the window (folder chooser, find, review, approve, open resume file, copy, submitted)
//   F2 closing the window during a run, and a second launch bringing it back
//   F3 the server process dying: what the person sees, and what a relaunch finds
//   F4 the smallest window
// The tray cannot be driven by Playwright (the Tray object is not reachable from app.evaluate and a native menu is
// not part of the page); its two handlers are the same functions a second launch and app.quit() use, so those are
// exercised instead and the gap is reported.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { writeEvidence } from "./common";
import { removeDir, tempDir } from "./helpers";
import { auditPath } from "./paths";
import { check } from "./record";
import { sweep } from "./sweep";
import { ACME, findJobsAndWaitForReview, needsYouItem } from "../support/flows";
import { RESUME_PDF, approveThroughApi, findApplicationId, seedAlexRivera, type SeedTarget } from "../support/seed";
import { DEMO_FEEDS_DIR, FAKE_CLAUDE_CLI, REPO_ROOT } from "../support/server";
import { waitUntilNoRunIsActive as _unused } from "../support/waits";

void _unused;
const DESKTOP_DIR = path.join(REPO_ROOT, "apps", "desktop");

declare global {
  interface Window {
    jobgoblin?: { sessionToken: string; chooseFolder: () => Promise<string | null>; openPath: unknown };
  }
}

function electronBinary(): string {
  return createRequire(path.join(DESKTOP_DIR, "package.json"))("electron") as string;
}

function desktopEnvironment(appData: string, extra: Record<string, string> = {}): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || name === "ELECTRON_RUN_AS_NODE" || name.startsWith("JOBGOBLIN_") || name.startsWith("FAKE_CLAUDE_")) continue;
    environment[name] = value;
  }
  // SAFETY GATE: the app data folder is a temp folder created by this audit.
  if (!path.resolve(appData).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase()) || !path.basename(appData).startsWith("jobgoblin-audit2-")) {
    throw new Error(`Refusing to start the desktop app: ${appData} is not an audit temp folder.`);
  }
  return {
    ...environment,
    JOBGOBLIN_APP_DATA: appData,
    JOBGOBLIN_RESOURCES_DIR: REPO_ROOT,
    JOBGOBLIN_FEED_FIXTURES: DEMO_FEEDS_DIR,
    JOBGOBLIN_CLAUDE_COMMAND: JSON.stringify([process.execPath, FAKE_CLAUDE_CLI]),
    JOBGOBLIN_PORT: "0",
    ...extra,
  };
}

async function waitForDashboard(dashboard: Page): Promise<string> {
  await expect.poll(() => dashboard.url(), { timeout: 60_000 }).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  await dashboard.waitForLoadState("domcontentloaded");
  return new URL(dashboard.url()).origin;
}

// Stubs everything that would touch the person's computer. Records what was asked.
async function stubTheComputer(app: ElectronApplication, chosenFolder: string): Promise<void> {
  await app.evaluate(({ dialog, shell, clipboard }, folder) => {
    const g = globalThis as Record<string, unknown>;
    g.__audit = { openedExternally: [] as string[], openedPaths: [] as string[], errorBoxes: [] as string[][], openDialogs: 0 };
    const record = g.__audit as { openedExternally: string[]; openedPaths: string[]; errorBoxes: string[][]; openDialogs: number };
    shell.openExternal = async (url: string) => {
      record.openedExternally.push(url);
    };
    shell.openPath = async (target: string) => {
      record.openedPaths.push(target);
      return "";
    };
    (dialog as unknown as { showOpenDialog: (...args: unknown[]) => Promise<unknown> }).showOpenDialog = async () => {
      record.openDialogs += 1;
      return { canceled: false, filePaths: [folder] };
    };
    dialog.showErrorBox = (title: string, content: string) => {
      record.errorBoxes.push([title, content]);
    };
    clipboard.clear();
  }, chosenFolder);
}

async function audited(app: ElectronApplication): Promise<{ openedExternally: string[]; openedPaths: string[]; errorBoxes: string[][]; openDialogs: number }> {
  return app.evaluate(() => (globalThis as { __audit?: unknown }).__audit as { openedExternally: string[]; openedPaths: string[]; errorBoxes: string[][]; openDialogs: number });
}

function apiInsideTheApp(dashboard: Page, personFolder: string): SeedTarget {
  return {
    personFolder,
    api: async <T>(route: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
      const method = init.method ?? (init.body === undefined ? "GET" : "POST");
      const answer = await dashboard.evaluate(
        async ({ route, method, body }) => {
          const headers: Record<string, string> = { Authorization: `Bearer ${window.jobgoblin?.sessionToken ?? ""}` };
          if (body !== undefined) headers["Content-Type"] = "application/json";
          const response = await fetch(route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
          return { ok: response.ok, text: await response.text() };
        },
        { route, method, body: init.body },
      );
      if (!answer.ok) throw new Error(`${method} ${route} failed: ${answer.text}`);
      return (answer.text === "" ? undefined : JSON.parse(answer.text)) as T;
    },
  };
}

type TodayShape = { running: { status: string }[]; needsYou: unknown[] };

test.describe("F: the desktop app", () => {
  let appData = "";
  let personFolder = "";
  let app: ElectronApplication | undefined;

  test.beforeEach(() => {
    appData = tempDir("desktop-appdata");
    personFolder = tempDir("desktop-person");
  });
  test.afterEach(async () => {
    await app?.close().catch(() => undefined);
    app = undefined;
    await new Promise((resolve) => setTimeout(resolve, 600));
    removeDir(appData);
    removeDir(personFolder);
  });

  test("F1 golden path inside the window: folder chooser, find, review, approve, open resume file, copy, submitted, quit", async () => {
    test.setTimeout(300_000);
    app = await electron.launch({ executablePath: electronBinary(), args: [DESKTOP_DIR], env: desktopEnvironment(appData) });
    const dashboard = await app.firstWindow();
    const origin = await waitForDashboard(dashboard);
    await stubTheComputer(app, personFolder);
    const results: Record<string, unknown> = {};

    // Wizard steps 1 to 3 by clicking, the folder through the (stubbed) native chooser.
    await expect(dashboard.getByRole("heading", { level: 1, name: "Welcome to Jobgoblin" })).toBeVisible();
    await dashboard.getByRole("button", { name: "Get started" }).click();
    await expect(dashboard.getByRole("heading", { level: 1, name: "Connect Claude" })).toBeVisible();
    await dashboard.waitForTimeout(800);
    results.connectStepText = (await dashboard.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 300);
    await dashboard.getByRole("button", { name: "Continue" }).click();
    await dashboard.getByRole("button", { name: "Choose a folder" }).click();
    await expect(dashboard.getByText(personFolder)).toBeVisible({ timeout: 15_000 });
    results.folderChooserCalls = (await audited(app)).openDialogs;
    await dashboard.screenshot({ path: auditPath("screens", "f", "f1-folder-chosen.png") });

    // The rest of setup through the app's own API (the wizard itself is covered in the browser specs).
    const inTheApp = apiInsideTheApp(dashboard, personFolder);
    await seedAlexRivera(inTheApp, { usageNoticeSeen: true });
    await dashboard.goto(`${origin}/today`);
    await findJobsAndWaitForReview(dashboard);
    await dashboard.screenshot({ path: auditPath("screens", "f", "f1-today-review.png") });
    await needsYouItem(dashboard, ACME).getByRole("link", { name: "Review" }).click();
    await expect(dashboard.getByRole("article", { name: "Resume preview" })).toBeVisible();
    // Pay is TODO in the demo person: fill it so Approve is open, as a person would on Profile.
    const acmeId = await findApplicationId(inTheApp, "Acme Cloud", "Backend Engineer");
    await inTheApp.api("/api/profile/compensation", { method: "PUT", body: { expectedBase: "120000" } });
    await dashboard.reload();
    await expect(dashboard.getByRole("button", { name: "Approve" })).toBeEnabled();
    await dashboard.getByRole("button", { name: "Approve" }).click();
    await dashboard.goto(`${origin}/apply/${acmeId}`);
    await expect(dashboard.getByRole("button", { name: "Copy Email address" })).toBeVisible({ timeout: 60_000 });
    await dashboard.screenshot({ path: auditPath("screens", "f", "f1-open-application.png"), fullPage: true });

    // Copy inside Electron.
    await dashboard.getByRole("button", { name: "Copy Email address" }).click();
    await expect(dashboard.getByText("Copied").first()).toBeVisible();
    results.clipboardAfterCopy = await app.evaluate(({ clipboard }) => clipboard.readText());

    // Open resume file: the server asks main to open a path inside the person's folder.
    const openButton = dashboard.getByRole("button", { name: /Open resume file/i });
    results.openResumeButtonCount = await openButton.count();
    if ((await openButton.count()) > 0) {
      await openButton.first().click();
      await expect.poll(async () => (await audited(app!)).openedPaths.length, { timeout: 10_000 }).toBeGreaterThan(0);
    }
    results.openedPaths = (await audited(app)).openedPaths;
    results.personFolder = personFolder;

    // "I submitted", then Pipeline.
    await dashboard.getByRole("button", { name: "I submitted" }).click();
    const dialog = dashboard.getByRole("dialog", { name: "Record that you applied" });
    await dialog.getByLabel("I saw the confirmation, and have nothing to paste").check();
    await dialog.getByRole("button", { name: "Record as applied" }).click();
    await expect(dashboard.getByRole("heading", { level: 1, name: "Backend Engineer" })).toBeVisible();
    await dashboard.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pipeline" }).click();
    await expect(dashboard.getByTestId("pipeline-card").first()).toBeVisible();
    await dashboard.screenshot({ path: auditPath("screens", "f", "f1-pipeline.png"), fullPage: true });

    // Outside link, then Quit.
    await dashboard.evaluate(() => {
      const link = document.createElement("a");
      link.id = "outside";
      link.href = "https://example.com/careers";
      link.target = "_blank";
      link.textContent = "x";
      document.body.append(link);
    });
    await dashboard.locator("#outside").click();
    await expect.poll(async () => (await audited(app!)).openedExternally.length).toBeGreaterThan(0);
    const exited = new Promise<number | null>((resolve) => app?.process().once("exit", (code) => resolve(code)));
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    const exitCode = await Promise.race([exited, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 30_000))]);
    app = undefined;
    results.quitExitCode = exitCode;
    results.serverJsonGoneAfterQuit = !fs.existsSync(path.join(appData, "server.json"));
    const evidence = writeEvidence("f1-golden-path.json", results);

    check(results.folderChooserCalls === 1, { id: "F-folder-chooser", severity: "P1", title: "The Choose a folder button does not use the computer's folder chooser", persona: "Maya", area: "Setup step 3 (desktop)", prd: "S4", expected: "The native chooser opens once", actual: String(results.folderChooserCalls), evidence: [evidence], wrong: "product" });
    check(String(results.clipboardAfterCopy).includes("@"), { id: "F-copy", severity: "P2", title: "Copy inside the desktop window does not put the value on the computer's clipboard", persona: "Maya", area: "Open application (desktop)", prd: "U1", expected: "email on the clipboard", actual: String(results.clipboardAfterCopy), evidence: [evidence], wrong: "product" });
    const opened = (results.openedPaths as string[]) ?? [];
    check(opened.length > 0 && opened.every((target) => path.resolve(target).toLowerCase().startsWith(path.resolve(personFolder).toLowerCase())), { id: "F-open-resume", severity: "P2", title: "Open resume file does not reach the computer, or reaches a path outside the person's folder", persona: "Maya", area: "Open application (desktop)", prd: "U1", expected: "shell.openPath with a path inside the folder", actual: JSON.stringify({ opened, button: results.openResumeButtonCount }), evidence: [evidence], wrong: "product" });
    check(results.quitExitCode === 0 && results.serverJsonGoneAfterQuit === true, { id: "F-quit", severity: "P2", title: "Quit does not end with exit code 0 and a clean data folder", persona: "Both", area: "Desktop quit", prd: "-", expected: "0", actual: JSON.stringify({ code: results.quitExitCode, serverJson: results.serverJsonGoneAfterQuit }), evidence: [evidence], wrong: "product" });
  });

  test("F2 closing the window during a run; a second launch brings it back; the tray's two handlers", async () => {
    test.setTimeout(240_000);
    app = await electron.launch({ executablePath: electronBinary(), args: [DESKTOP_DIR], env: desktopEnvironment(appData, { FAKE_CLAUDE_MODE: "slow" }) });
    const dashboard = await app.firstWindow();
    const origin = await waitForDashboard(dashboard);
    await stubTheComputer(app, personFolder);
    const inTheApp = apiInsideTheApp(dashboard, personFolder);
    await seedAlexRivera(inTheApp, { usageNoticeSeen: true });
    await dashboard.goto(`${origin}/today`);
    await dashboard.getByRole("button", { name: "Find jobs" }).click();
    await expect(dashboard.getByTestId("run-card").first()).toBeVisible({ timeout: 15_000 });
    const results: Record<string, unknown> = {};

    const state = () =>
      app!.evaluate(({ BrowserWindow }) => {
        const [win] = BrowserWindow.getAllWindows();
        return win === undefined ? null : { visible: win.isVisible(), minimized: win.isMinimized(), destroyed: win.isDestroyed(), focused: win.isFocused() };
      });
    results.windowBeforeClose = await state();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await dashboard.waitForTimeout(500);
    results.windowAfterClose = await state();
    const runsWhileHidden = await inTheApp.api<TodayShape>("/api/today");
    results.runsRightAfterClose = runsWhileHidden.running.map((run) => run.status);
    await expect
      .poll(async () => (await inTheApp.api<TodayShape>("/api/today")).running.some((run) => run.status === "running" || run.status === "queued"), { timeout: 5_000 })
      .toBe(true);

    // Second launch, same data: it must exit at once and bring the first window forward.
    const second = spawn(electronBinary(), [DESKTOP_DIR], { env: desktopEnvironment(appData, { FAKE_CLAUDE_MODE: "slow" }), stdio: "ignore", windowsHide: true });
    const secondCode = await new Promise<number | null | "timeout">((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), 30_000);
      second.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    if (secondCode === "timeout") second.kill();
    results.secondLaunchExitCode = secondCode;
    await dashboard.waitForTimeout(800);
    results.windowAfterSecondLaunch = await state();

    // The handlers behind the tray menu: Open Jobgoblin (= second-instance) and Quit (= app.quit()).
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide());
    await app.evaluate(({ app: electronApp }) => electronApp.emit("second-instance", {}, [], ""));
    await dashboard.waitForTimeout(500);
    results.windowAfterOpenHandler = await state();

    // The run carried on while hidden and finishes.
    await expect
      .poll(async () => (await inTheApp.api<TodayShape>("/api/today")).running.every((run) => run.status !== "running" && run.status !== "queued"), { timeout: 150_000 })
      .toBe(true);
    results.runsAtEnd = (await inTheApp.api<TodayShape>("/api/today")).running.map((run) => run.status);
    await dashboard.screenshot({ path: auditPath("screens", "f", "f2-after-run-window-returned.png") });
    const evidence = writeEvidence("f2-close-and-second-launch.json", results);

    const closed = results.windowAfterClose as { visible: boolean; destroyed: boolean } | null;
    check(closed !== null && closed.visible === false && closed.destroyed === false, { id: "F-close-hides", severity: "P3", title: "Closing the window does not hide it and leave Jobgoblin running", persona: "Maya", area: "Desktop window", prd: "R1 (runs never block)", expected: "Hidden, not destroyed", actual: JSON.stringify(results.windowAfterClose), evidence: [evidence], wrong: "product" });
    check((results.runsRightAfterClose as string[]).some((status) => status === "running" || status === "queued"), { id: "F-close-during-run", severity: "P1", title: "Closing the window stops the run", persona: "Maya", area: "Desktop window", prd: "R1", expected: "The run carries on", actual: JSON.stringify(results.runsRightAfterClose), evidence: [evidence], wrong: "product" });
    check(results.secondLaunchExitCode === 0 && (results.windowAfterSecondLaunch as { visible: boolean }).visible === true, { id: "F-second-launch", severity: "P2", title: "A second launch does not exit and bring the first window back", persona: "Maya", area: "Desktop window", prd: "-", expected: "Exit 0, window visible", actual: JSON.stringify({ code: results.secondLaunchExitCode, window: results.windowAfterSecondLaunch }), evidence: [evidence], wrong: "product" });
    check((results.windowAfterOpenHandler as { visible: boolean }).visible === true, { id: "F-open-handler", severity: "P2", title: "The Open Jobgoblin handler does not bring a hidden window back", persona: "Maya", area: "Tray / desktop", prd: "-", expected: "Visible", actual: JSON.stringify(results.windowAfterOpenHandler), evidence: [evidence], wrong: "product" });
    check((results.runsAtEnd as string[]).every((status) => status === "done"), { id: "F-run-finishes-hidden", severity: "P1", title: "A run started before the window was closed does not finish", persona: "Maya", area: "Desktop window", prd: "R1", expected: "done", actual: JSON.stringify(results.runsAtEnd), evidence: [evidence], wrong: "product" });
  });

  test("F3 the server process dies: what the person sees, and what a relaunch finds", async () => {
    test.setTimeout(240_000);
    app = await electron.launch({ executablePath: electronBinary(), args: [DESKTOP_DIR], env: desktopEnvironment(appData, { FAKE_CLAUDE_MODE: "slow" }) });
    const dashboard = await app.firstWindow();
    const origin = await waitForDashboard(dashboard);
    await stubTheComputer(app, personFolder);
    const inTheApp = apiInsideTheApp(dashboard, personFolder);
    await seedAlexRivera(inTheApp, { usageNoticeSeen: true });
    await dashboard.goto(`${origin}/today`);
    await dashboard.getByRole("button", { name: "Find jobs" }).click();
    await expect(dashboard.getByTestId("run-card").first()).toBeVisible({ timeout: 15_000 });
    const results: Record<string, unknown> = {};

    const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().map((metric) => ({ pid: metric.pid, type: metric.type, name: (metric as { name?: string }).name ?? null, serviceName: (metric as { serviceName?: string }).serviceName ?? null })));
    results.processes = metrics;
    const utilityPids = metrics.filter((metric) => metric.type === "Utility" && /server/i.test(`${metric.serviceName ?? ""} ${metric.name ?? ""}`)).map((metric) => metric.pid);
    const serverPid = utilityPids[0] ?? metrics.find((metric) => metric.type === "Utility")?.pid;
    expect(serverPid, "the server's utility process must be found").toBeDefined();
    const exited = new Promise<number | null>((resolve) => app?.process().once("exit", (code) => resolve(code)));
    process.kill(serverPid!);
    const exitCode = await Promise.race([exited, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 30_000))]);
    results.appExitCodeAfterServerDied = exitCode;
    app = undefined;
    const logFile = path.join(appData, "logs", "desktop.log");
    results.desktopLogTail = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).slice(-8) : [];
    // The stubbed error box could not be read after app.exit(1), so the dialog's wording is read from the source.
    results.dialogWordingInSource = fs.readFileSync(path.join(DESKTOP_DIR, "src", "main.ts"), "utf8").match(/Jobgoblin's background service stopped unexpectedly[\s\S]{0,260}/)?.[0] ?? null;

    // Relaunch on the same data: what does the person find?
    app = await electron.launch({ executablePath: electronBinary(), args: [DESKTOP_DIR], env: desktopEnvironment(appData) });
    const again = await app.firstWindow();
    await waitForDashboard(again);
    await expect(again.getByRole("heading", { level: 1, name: "Today" })).toBeVisible({ timeout: 30_000 });
    await again.waitForTimeout(1200);
    results.todayAfterRelaunch = { cards: await again.getByTestId("run-card").evaluateAll((cards) => cards.map((card) => (card as HTMLElement).innerText.replace(/\s+/g, " "))), needsYou: await again.getByTestId("needs-you-item").evaluateAll((items) => items.map((item) => (item as HTMLElement).innerText.replace(/\s+/g, " "))) };
    await again.screenshot({ path: auditPath("screens", "f", "f3-after-relaunch.png"), fullPage: true });
    const evidence = writeEvidence("f3-server-died.json", results);

    check(results.appExitCodeAfterServerDied === 1, { id: "F-server-died-exit", severity: "P3", title: "When the background service dies, the app does not show an error and exit with code 1 as designed", persona: "Maya", area: "Desktop", prd: "R4", expected: "Error box, exit 1", actual: String(results.appExitCodeAfterServerDied), evidence: [evidence], wrong: "unclear" });
    check(/interrupt/i.test(JSON.stringify((results.todayAfterRelaunch as { cards: string[] }).cards)), { id: "F-relaunch-interrupted", severity: "P1", title: "After a relaunch the interrupted run is not shown as interrupted", persona: "Maya", area: "Today (desktop)", prd: "R4", expected: "This run was interrupted + Try again", actual: JSON.stringify(results.todayAfterRelaunch), evidence: [evidence], wrong: "product" });
    check(!/Retry button/.test(String(results.dialogWordingInSource)), { id: "F-dialog-says-retry", severity: "P3", title: "The 'Jobgoblin stopped' dialog promises a Retry button; the screen's button says Try again", persona: "Maya", area: "apps/desktop/src/main.ts:119", prd: "Voice consistency", expected: "The button's real name", actual: String(results.dialogWordingInSource).slice(0, 200), evidence: [evidence], suspectedFile: "apps/desktop/src/main.ts:119", wrong: "product" });
  });

  test("F4 the smallest window: size limit and layout at the limit", async () => {
    test.setTimeout(240_000);
    app = await electron.launch({ executablePath: electronBinary(), args: [DESKTOP_DIR], env: desktopEnvironment(appData) });
    const dashboard = await app.firstWindow();
    const origin = await waitForDashboard(dashboard);
    await stubTheComputer(app, personFolder);
    const inTheApp = apiInsideTheApp(dashboard, personFolder);
    await seedAlexRivera(inTheApp, { usageNoticeSeen: true });
    await dashboard.goto(`${origin}/today`);
    await findJobsAndWaitForReview(dashboard);
    const results: Record<string, unknown> = {};
    results.sizeAtStart = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getSize());
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(300, 300));
    await dashboard.waitForTimeout(500);
    results.sizeAfterTryingTo300 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getSize());
    results.minimumSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getMinimumSize());
    const screens = [
      { name: "today", url: "/today" },
      { name: "pipeline", url: "/pipeline" },
      { name: "settings", url: "/settings" },
      { name: "profile-answers", url: "/profile/answers" },
    ];
    const rows = await inTheApp.api<{ id: string; company: string }[]>("/api/pipeline");
    const acme = rows.find((row) => row.company === "Acme Cloud");
    if (acme) screens.push({ name: "review", url: `/review/${acme.id}` });
    const layout: Record<string, unknown> = {};
    for (const screen of screens) {
      await dashboard.goto(`${origin}${screen.url}`);
      await dashboard.waitForTimeout(700);
      const result = await sweep(dashboard, `desktop smallest ${screen.name}`, { screenshot: `screens/f/f4-smallest-${screen.name}.png`, axe: false });
      layout[screen.name] = { overflow: result.horizontalOverflow, scrollWidth: result.scrollWidth, clientWidth: result.clientWidth, viewport: await dashboard.evaluate(() => [window.innerWidth, window.innerHeight]) };
    }
    results.layoutAtSmallest = layout;
    const evidence = writeEvidence("f4-smallest-window.json", results);
    const sizeNow = results.sizeAfterTryingTo300 as number[];
    check(sizeNow[0] >= 800 && sizeNow[1] >= 500, { id: "F-min-size", severity: "P3", title: "The desktop window can be made smaller than the dashboard works at", persona: "Maya", area: "Desktop window", prd: "Layout", expected: "A minimum near 900x600", actual: JSON.stringify(results.sizeAfterTryingTo300), evidence: [evidence], wrong: "product" });
    const overflowing = Object.entries(layout).filter(([, value]) => (value as { overflow: boolean }).overflow).map(([name]) => name);
    check(overflowing.length === 0, { id: "F-smallest-overflow", severity: "P2", title: "A screen scrolls sideways at the desktop window's smallest size", persona: "Maya", area: overflowing.join(", "), prd: "Layout", expected: "No horizontal scroll", actual: JSON.stringify(layout), evidence: [evidence], wrong: "product" });
    void approveThroughApi;
    void RESUME_PDF;
  });
});
