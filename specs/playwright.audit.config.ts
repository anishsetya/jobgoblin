// Playwright config for the PM audit. Same global setup as the product's own e2e suite (builds once, or reuses
// builds with E2E_SKIP_BUILD=1), one worker, no retries, and trace, video and screenshots always on.
// Output and the JSON report go under AUDIT_DIR, not into the repository.
//   pnpm --filter @jobgoblin/e2e exec playwright test --config audit/playwright.audit.config.ts [file or -g "J3"]
// AUDIT_RUN=1 / AUDIT_RUN=2 tag the findings, so a finding recorded in both runs counts as reproduced.
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { AUDIT_DIR, AUDIT_RUN } from "./paths";

const auditDir = import.meta.dirname;
const e2eDir = path.resolve(auditDir, "..");

export default defineConfig({
  testDir: auditDir,
  testMatch: /.*\.audit\.spec\.ts$/,
  outputDir: path.join(AUDIT_DIR, `pw-output-run${AUDIT_RUN}`),
  globalSetup: path.join(e2eDir, "support", "globalSetup.ts"),
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(AUDIT_DIR, `audit-results-run${AUDIT_RUN}.json`) }],
  ],
  use: {
    trace: "on",
    video: "on",
    screenshot: "on",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /electron\.audit\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "electron",
      testMatch: /electron\.audit\.spec\.ts$/,
    },
  ],
});
