// Dependency rules from the tech spec ("Repository and packages") and docs/poc/ARCHITECTURE.md section 3.
// `pnpm lint:deps` fails when a package reaches past its boundary.
// The rules guard shipped code, so test files (which use Vitest, temp folders and processes) are left out.
const TEST_FILES = "\\.test\\.ts$|/test/";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-is-pure",
      comment: "core holds the rules; it may use only schemas and node:crypto, so it stays testable without files or network.",
      severity: "error",
      from: { path: "^packages/core/src", pathNot: TEST_FILES },
      to: {
        dependencyTypesNot: ["type-only"],
        pathNot: ["^packages/core/src", "^packages/schemas/src", "^node:crypto$", "^crypto$", "node_modules/zod"],
      },
    },
    {
      name: "only-storage-touches-the-database",
      comment: "One writer path: only packages/storage opens the SQLite database.",
      severity: "error",
      from: { pathNot: ["^packages/storage/src", TEST_FILES] },
      to: { path: "^node:sqlite$|^sqlite$" },
    },
    {
      name: "only-the-runner-starts-processes",
      comment: "One place to audit what runs on the person's machine.",
      severity: "error",
      from: { pathNot: ["^packages/server/src/runner", "^apps/desktop/src", "^fixtures/", "^e2e/", TEST_FILES] },
      to: { path: "^node:child_process$|^child_process$" },
    },
    {
      name: "no-model-sdk",
      comment: "Jobgoblin must never call a model itself; all reasoning runs in the person's own Claude Code.",
      severity: "error",
      from: {},
      to: { path: "node_modules/(@anthropic-ai|openai|@google/generative-ai|@mistralai)" },
    },
    {
      name: "dashboard-uses-http-only",
      comment: "The dashboard reaches data only through the HTTP API, so the same checks apply to every caller.",
      severity: "error",
      from: { path: "^apps/dashboard/src" },
      to: { path: "^packages/(core|storage|server|sources|render)/" },
    },
    {
      name: "leaf-packages-use-only-schemas",
      comment: "sources and render are leaf packages: they may use schemas but no other workspace package.",
      severity: "error",
      from: { path: "^packages/(sources|render)/src" },
      to: { path: "^packages/(core|storage|server)/" },
    },
  ],
  options: {
    // TypeScript 7 (the native compiler) has no JavaScript API for dependency-cruiser to call, so source files
    // are parsed with swc instead. It sees the same import statements.
    parser: "swc",
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default"] },
  },
};
