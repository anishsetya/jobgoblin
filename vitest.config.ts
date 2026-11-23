// One Vitest run covers the unit tests of every package.
// Browser flows live in e2e/ and run with Playwright instead.
// The dashboard's tests run in Node too: they cover logic that needs no browser (the live updates stream,
// screen loading, what an error screen says). Its "@/" imports need the same alias as its vite.config.ts.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./apps/dashboard/src", import.meta.url)) },
  },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "apps/desktop/src/**/*.test.ts",
      "apps/dashboard/src/**/*.test.{ts,tsx}",
      "fixtures/fake-claude/src/**/*.test.ts",
      "fixtures/fake-claude/test/**/*.test.ts",
    ],
    testTimeout: 20_000,
  },
});
