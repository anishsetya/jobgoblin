// Runs once before any test: builds everything the tests start as a program. The tests run the BUILT
// server bundle (what Electron runs), the BUILT dashboard (what the server serves) and the BUILT fake claude,
// so a stale build would test old code. Set E2E_SKIP_BUILD=1 to reuse the builds while writing tests.
// Spec: ARCHITECTURE.md section 15 (e2e).
import { execSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

// The packages whose build output the tests start. Order matters only for readability.
const PACKAGES_TO_BUILD = [
  "@jobgoblin/dashboard",
  "@jobgoblin/server",
  "@jobgoblin/fake-claude",
  "@jobgoblin/desktop",
] as const;

export default function globalSetup(): void {
  if (process.env.E2E_SKIP_BUILD === "1") {
    console.log("E2E_SKIP_BUILD=1: using the builds that are already there.");
    return;
  }

  for (const packageName of PACKAGES_TO_BUILD) {
    console.log(`Building ${packageName} ...`);
    // pnpm is a .cmd file on Windows, which only starts through a shell. The package names are constants above.
    execSync(`pnpm --filter ${packageName} build`, { cwd: repoRoot, stdio: "inherit" });
  }
}
