// Bundles the fake into one file, dist/cli.mjs (decision D3). A run starts the fake inside its own run
// directory, where tsx and node_modules cannot be found, so the bundle must not need anything else:
// @jobgoblin/schemas (TypeScript source), the MCP SDK and zod are all bundled in.
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  noExternal: [/.*/],
  splitting: false,
  // Not cleaned: other work may be starting the fake from dist while it is rebuilt.
  clean: false,
  // Some bundled packages are CommonJS and call require("node:...") for Node's own modules.
  // An ES module has no `require`, so give the bundle one.
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
