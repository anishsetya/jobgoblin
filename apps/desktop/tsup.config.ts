// Bundles main and preload into dist/main.cjs and dist/preload.cjs.
// CommonJS because Electron loads the main file with require, and a sandboxed preload can only be CommonJS.
// `electron` stays external: it is provided by the running app, not by node_modules.

import { defineConfig } from "tsup";

export default defineConfig({
  entry: { main: "src/main.ts", preload: "src/preload.ts" },
  format: ["cjs"],
  platform: "node",
  target: "es2023",
  external: ["electron"],
  clean: true,
});
