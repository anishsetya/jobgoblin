// Story 12 (ARCHITECTURE.md section 13, apps/desktop/README.md): "The desktop app opens on my computer, shows
// the same dashboard, never lets a web page take over its window, and closes without leaving anything behind."
// This is the only test that runs inside Electron (Playwright's _electron). It launches apps/desktop exactly as
// `pnpm dev:desktop` would, with a temporary app data folder, the demo board and the fake claude.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
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
});

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
