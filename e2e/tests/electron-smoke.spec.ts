// Story 12 (ARCHITECTURE.md section 13, apps/desktop/README.md): "The desktop app opens on my computer, shows
// the same dashboard, never lets a web page take over its window, and closes without leaving anything behind."
// This is the only test that runs inside Electron (Playwright's _electron). It launches apps/desktop exactly as
// `pnpm dev:desktop` would, with a temporary app data folder, the demo board and the fake claude.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { findJobsAndWaitForReview } from "../support/flows";
import {
  PASSWORD_PROTECTED_PDF,
  RESUME_PDF,
  approveThroughApi,
  findApplicationId,
  seedAlexRivera,
  type SeedTarget,
} from "../support/seed";
import { DEMO_FEEDS_DIR, FAKE_CLAUDE_CLI, REPO_ROOT } from "../support/server";

const DESKTOP_DIR = path.join(REPO_ROOT, "apps", "desktop");
const QUIT_TIMEOUT_MS = 30_000;

type JobgoblinBridge = { sessionToken: string; chooseFolder: unknown; openPath: unknown };

declare global {
  interface Window {
    jobgoblin?: JobgoblinBridge;
  }
}

test.describe("As a desktop user, Jobgoblin behaves like an app", () => {
  let appDataDir = "";
  let app: ElectronApplication | undefined;

  test.beforeEach(() => {
    appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobgoblin-e2e-desktop-"));
  });

  test.afterEach(async () => {
    // If a test failed before Quit, make sure no Electron process stays behind.
    await app?.close().catch(() => undefined);
    app = undefined;
    fs.rmSync(appDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  });

  test("it opens on the setup wizard, gives the page its bridge, keeps links out of the window, and quits cleanly", async () => {
    app = await electron.launch({
      executablePath: electronBinary(),
      args: [DESKTOP_DIR],
      env: desktopEnvironment(appDataDir),
    });
    const dashboard = await app.firstWindow();
    const serverOrigin = await waitForDashboard(dashboard);

    await test.step("the window shows the dashboard: a first run starts at the wizard", async () => {
      await expect(dashboard.getByRole("heading", { level: 1, name: "Welcome to Jobgoblin" })).toBeVisible();
      expect(await dashboard.title()).toContain("Jobgoblin");
    });

    await test.step("window.jobgoblin exists and carries the session token", async () => {
      const bridge = await dashboard.evaluate(() => ({
        isObject: typeof window.jobgoblin === "object" && window.jobgoblin !== null,
        tokenLength: window.jobgoblin?.sessionToken.length ?? 0,
        chooseFolder: typeof window.jobgoblin?.chooseFolder,
        openPath: typeof window.jobgoblin?.openPath,
      }));
      expect(bridge).toEqual({ isObject: true, tokenLength: expect.any(Number), chooseFolder: "function", openPath: "function" });
      expect(bridge.tokenLength).toBeGreaterThanOrEqual(32);
    });

    await test.step("the folder step uses the computer's chooser, not a text box", async () => {
      await dashboard.getByRole("button", { name: "Get started" }).click();
      await dashboard.getByRole("button", { name: "Continue" }).click();
      await expect(dashboard.getByRole("heading", { level: 1, name: "Choose your folder" })).toBeVisible();
      await expect(dashboard.getByRole("button", { name: "Choose a folder" })).toBeVisible();
      await expect(dashboard.getByLabel("Folder", { exact: true })).toHaveCount(0);
    });

    // The person's real browser must not open during a test.
    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as { __openedExternally?: string[] }).__openedExternally = opened;
      shell.openExternal = async (url: string) => {
        opened.push(url);
      };
    });

    await test.step("a link to another website opens in the person's browser and the window does not move", async () => {
      await dashboard.evaluate(() => {
        const link = document.createElement("a");
        link.id = "outside-link";
        link.href = "https://example.com/careers";
        link.target = "_blank";
        link.textContent = "Outside link";
        document.body.append(link);
      });
      await dashboard.locator("#outside-link").click();
      await expect.poll(() => openedExternally(app)).toEqual(["https://example.com/careers"]);
      expect(new URL(dashboard.url()).origin).toBe(serverOrigin);
    });

    await test.step("a page that tries to navigate away is stopped at the door", async () => {
      await dashboard.evaluate(() => window.location.assign("https://example.com/redirect"));
      await expect.poll(() => openedExternally(app)).toContain("https://example.com/redirect");
      expect(new URL(dashboard.url()).origin).toBe(serverOrigin);
      // The page is still the one the person was on (read from the page itself, since Playwright still
      // thinks a navigation it saw start is under way).
      await expect.poll(() => dashboard.evaluate(() => document.querySelector("h1")?.textContent)).toBe("Choose your folder");
    });

    const serverJson = path.join(appDataDir, "server.json");
    await test.step("the server is running: it has written server.json", async () => {
      expect(fs.existsSync(serverJson)).toBe(true);
    });

    await test.step("Quit stops Electron with exit code 0 and the server removes server.json", async () => {
      const exited = new Promise<number | null>((resolve) => app?.process().once("exit", (code) => resolve(code)));
      await app?.evaluate(({ app: electronApp }) => electronApp.quit());

      const exitCode = await Promise.race([
        exited,
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), QUIT_TIMEOUT_MS)),
      ]);
      expect(exitCode).toBe(0);
      expect(fs.existsSync(serverJson)).toBe(false);
      app = undefined;
    });
  });

  // Regression for docs/poc/RCA-2026-11-01-pdf-upload.md: inside Electron the server runs in a utility process,
  // where pdf.js once refused to open every PDF and the wizard blamed the person's file. Every other test runs
  // the server in plain Node, so only this one can catch that class of bug.
  test("my resume PDF is read on the wizard's resume step inside the desktop app", async () => {
    app = await electron.launch({ executablePath: electronBinary(), args: [DESKTOP_DIR], env: desktopEnvironment(appDataDir) });
    const dashboard = await app.firstWindow();
    const serverOrigin = await waitForDashboard(dashboard);

    await test.step("a folder is chosen (the computer's folder chooser cannot be clicked by a test)", async () => {
      // Outside the app data folder: the server refuses a person's folder inside its own working files.
      const personFolder = fs.mkdtempSync(path.join(os.tmpdir(), "jobgoblin-e2e-folder-"));
      const status = await dashboard.evaluate(async (folder) => {
        const response = await fetch("/api/settings/folder", {
          method: "POST",
          headers: { Authorization: `Bearer ${window.jobgoblin?.sessionToken ?? ""}`, "Content-Type": "application/json" },
          body: JSON.stringify({ path: folder }),
        });
        return `${response.status} ${await response.text()}`;
      }, personFolder);
      expect(status).toMatch(/^200 /);
    });

    await test.step("a password-protected PDF is called what it is: pdf.js's error name survives the desktop app", async () => {
      await dashboard.goto(`${serverOrigin}/setup/4`);
      await expect(dashboard.getByRole("heading", { level: 1, name: "Add your resume" })).toBeVisible();
      await dashboard.getByLabel("Your resume", { exact: true }).setInputFiles(PASSWORD_PROTECTED_PDF);
      await dashboard.getByRole("button", { name: "Read my resume" }).click();
      await dashboard.getByRole("dialog", { name: "Before your first run" }).getByRole("button", { name: "I understand, continue" }).click();

      const problem = dashboard.getByRole("alert");
      await expect(problem).toContainText("This PDF is protected with a password.");
      await expect(problem).toContainText("Open it, save a copy without a password, and choose that copy.");
      await expect(problem).not.toContainText("our side"); // not the "problem on our side" message pdf.js once caused
    });

    await test.step("I choose my own PDF instead, the message goes away, and Claude reads it", async () => {
      await dashboard.getByLabel("Your resume", { exact: true }).setInputFiles(RESUME_PDF);
      await expect(dashboard.getByRole("alert")).toHaveCount(0);
      await dashboard.getByRole("button", { name: "Read my resume" }).click();

      await expect(dashboard.getByText("Your resume has been read. Next, check what we found.")).toBeVisible({ timeout: 60_000 });
      await expect(dashboard.getByText(/could not read/)).toHaveCount(0);
    });
  });

  // Follow-up 2 of the same RCA: pdf.js was not the only library that can behave differently in Electron's
  // utility process. Each feature that uses one gets one pass here: Typst (render), pdf.js (read back),
  // the workbook writer (xlsx) and SQLite (backup).
  test("every feature that uses a library works inside the desktop app: render, read back, export, back up", async () => {
    test.setTimeout(240_000);
    app = await electron.launch({ executablePath: electronBinary(), args: [DESKTOP_DIR], env: desktopEnvironment(appDataDir) });
    const dashboard = await app.firstWindow();
    const serverOrigin = await waitForDashboard(dashboard);
    // Outside the app data folder: the server refuses a person's folder inside its own working files.
    const personFolder = fs.mkdtempSync(path.join(os.tmpdir(), "jobgoblin-e2e-folder-"));
    const inTheApp = apiInsideTheApp(dashboard, personFolder);

    await test.step("setup is finished with Alex Rivera's saved profile, through the app's own API", async () => {
      await seedAlexRivera(inTheApp, { usageNoticeSeen: true });
      await dashboard.goto(`${serverOrigin}/today`);
      await expect(dashboard.getByRole("button", { name: "Find jobs" })).toBeEnabled();
    });

    await test.step("Find jobs tailors resumes: Typst draws each PDF and pdf.js reads it back to check it", async () => {
      await findJobsAndWaitForReview(dashboard);
    });

    const acmeId = await findApplicationId(inTheApp, "Acme Cloud", "Backend Engineer");

    await test.step("approving writes the final PDF into my folder, exactly as approved", async () => {
      await approveThroughApi(inTheApp, acmeId);

      const detail = await inTheApp.api<{ application: { folder: string | null }; approval: { pdfSha256: string } | null }>(`/api/apps/${acmeId}`);
      const resumePdf = path.join(personFolder, ...(detail.application.folder ?? "").split("/"), "Alex Rivera - Resume.pdf");
      const approvedBytes = fs.readFileSync(resumePdf);
      expect(approvedBytes.subarray(0, 5).toString()).toBe("%PDF-");
      expect(createHash("sha256").update(approvedBytes).digest("hex")).toBe(detail.approval?.pdfSha256);
    });

    await test.step("the tracker downloads as a real Excel workbook", async () => {
      const workbook = await dashboard.evaluate(async () => {
        const response = await fetch("/api/export/xlsx", { headers: { Authorization: `Bearer ${window.jobgoblin?.sessionToken ?? ""}` } });
        const bytes = new Uint8Array(await response.arrayBuffer());
        return { status: response.status, firstTwoLetters: String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0), size: bytes.length };
      });
      expect(workbook.status).toBe(200);
      expect(workbook.firstTwoLetters).toBe("PK"); // an .xlsx is a zip file
      expect(workbook.size).toBeGreaterThan(1000);
    });

    await test.step("Back up now makes a backup and lists it", async () => {
      await dashboard.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
      const backups = dashboard.getByRole("region", { name: "Backups" });
      await backups.getByRole("button", { name: "Back up now" }).click();

      await expect(backups).toContainText(/Last backup: .+/);
      await expect(backups.getByRole("button", { name: /^Restore the backup from / }).first()).toBeVisible();
    });
  });
});

// Calls the server's API from inside the desktop window, the way the dashboard itself does, so the seed helpers
// in support/seed.ts can set the person up without a server address or token of their own.
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

// The Electron program that apps/desktop depends on (pnpm links it into apps/desktop/node_modules).
function electronBinary(): string {
  const requireFromDesktop = createRequire(path.join(DESKTOP_DIR, "package.json"));
  return requireFromDesktop("electron") as string;
}

// Same as the server tests, plus nothing that would make Electron behave as plain Node.
function desktopEnvironment(appData: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || name === "ELECTRON_RUN_AS_NODE" || name.startsWith("JOBGOBLIN_") || name.startsWith("FAKE_CLAUDE_")) continue;
    environment[name] = value;
  }
  return {
    ...environment,
    JOBGOBLIN_APP_DATA: appData,
    JOBGOBLIN_RESOURCES_DIR: REPO_ROOT,
    JOBGOBLIN_FEED_FIXTURES: DEMO_FEEDS_DIR,
    JOBGOBLIN_CLAUDE_COMMAND: JSON.stringify([process.execPath, FAKE_CLAUDE_CLI]),
    JOBGOBLIN_PORT: "0",
  };
}

// The window first shows about:blank or the loading page; wait for the server's own address.
async function waitForDashboard(dashboard: Page): Promise<string> {
  await expect.poll(() => dashboard.url(), { timeout: 60_000 }).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  await dashboard.waitForLoadState("domcontentloaded");
  return new URL(dashboard.url()).origin;
}

async function openedExternally(application: ElectronApplication | undefined): Promise<string[]> {
  if (application === undefined) return [];
  return application.evaluate(() => (globalThis as { __openedExternally?: string[] }).__openedExternally ?? []);
}
