// Playwright setup for Jobgoblin's end-to-end tests. Two projects: the dashboard in Chromium (every
// user story) and the Electron shell (one smoke test). One worker, because every test starts its own
// server and a few of them launch real child processes; running them side by side would only add noise.
// Spec: ARCHITECTURE.md section 15 (Tests, "e2e").
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const e2eDir = import.meta.dirname;

export default defineConfig({
  testDir: path.join(e2eDir, "tests"),
  outputDir: path.join(e2eDir, "test-results"),
  // Builds the dashboard, the server bundle, the fake claude and the desktop shell once, before any test.
  globalSetup: path.join(e2eDir, "support", "globalSetup.ts"),
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // A run with the fake claude takes seconds; the generous limits are for a slow machine and for Typst's first render.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: path.join(e2eDir, "playwright-report") }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /electron-smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "electron",
      testMatch: /electron-smoke\.spec\.ts/,
    },
  ],
});
