// One Vitest run covers the unit tests of every package.
// Browser flows live in e2e/ and run with Playwright instead.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "apps/desktop/src/**/*.test.ts",
      "fixtures/fake-claude/src/**/*.test.ts",
      "fixtures/fake-claude/test/**/*.test.ts",
    ],
    testTimeout: 20_000,
  },
});
