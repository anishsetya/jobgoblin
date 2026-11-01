// Bundles the server into one file, dist/server.mjs, that Electron's utilityProcess (or plain node) runs.
// Everything is bundled except three packages that cannot be: the Typst compiler is a native module, and
// pdfjs-dist loads its reader by a path relative to its own files; exceljs is a large CommonJS package
// that Node loads better from node_modules. Spec: ARCHITECTURE.md decision D2 and section 11.
import { defineConfig } from "tsup";

// Left as `import "..."` in the bundle and found in node_modules when the bundle runs, so they are also
// dependencies of this package (see package.json): Node looks next to dist/ first.
const LEFT_OUTSIDE_THE_BUNDLE = ["@myriaddreamin/typst-ts-node-compiler", "pdfjs-dist", "exceljs"];

// "Anything except those three, or a file inside one of them (pdfjs-dist/legacy/build/pdf.mjs)".
const everythingElse = new RegExp(`^(?!(${LEFT_OUTSIDE_THE_BUNDLE.join("|")})(/|$))`);

export default defineConfig({
  entry: { server: "src/main.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  dts: false,
  // Workspace packages export TypeScript source (decision D2), so they must be bundled. tsup leaves a
  // package's own dependencies outside by default, so hono, pino, zod and the rest are listed here to be
  // bundled too. (A name in `noExternal` wins over the same name in `external`, which is why the three
  // packages above are excluded from this pattern instead of being listed under `external`.)
  noExternal: [everythingElse],
  external: LEFT_OUTSIDE_THE_BUNDLE,
  outExtension: () => ({ js: ".mjs" }),
  // tsup would turn `node:sqlite` into `sqlite`, which Node cannot find: this module exists only with the prefix.
  removeNodeProtocol: false,
  // Some bundled CommonJS packages (pino and its helpers) call require() for Node built-ins, which an
  // ES module does not have. This gives them one.
  banner: {
    js: "import { createRequire as __jobgoblinCreateRequire } from 'node:module'; const require = __jobgoblinCreateRequire(import.meta.url);",
  },
});
