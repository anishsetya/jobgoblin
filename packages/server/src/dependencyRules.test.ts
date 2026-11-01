// The dependency rules of ARCHITECTURE.md section 3 that protect the person, checked by reading the code as text.
// `pnpm lint:deps` (dependency-cruiser) checks the same rules from the import graph; this test is a second, plain
// check that anyone can read, and it also looks at every package.json.
//   1. Jobgoblin never calls a model itself: no model SDK anywhere. All reasoning runs in the person's own Claude Code.
//   2. Only packages/storage opens the database (`node:sqlite`), so every write goes through one set of functions.
//   3. Only the runner and the desktop app start processes (`node:child_process`), so there is one place to audit.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const MODEL_SDKS = ["@anthropic-ai", "openai", "@google/generative-ai", "@mistralai"];
const SQLITE_MODULES = ["node:sqlite", "sqlite"];
const PROCESS_MODULES = ["node:child_process", "child_process"];

const MAY_USE_SQLITE = ["packages/storage/src"];
const MAY_START_PROCESSES = ["packages/server/src/runner", "apps/desktop/src"];

// ---------------------------------------------------------------------------------------------
// Reading the repository
// ---------------------------------------------------------------------------------------------

function childFolders(folder: string): string[] {
  const absolute = path.join(REPOSITORY_ROOT, folder);
  if (!fs.existsSync(absolute)) return [];
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${folder}/${entry.name}`);
}

// Every file under `folder` (relative to the repository root, with forward slashes), except installed or built code.
function filesUnder(folder: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(path.join(REPOSITORY_ROOT, folder), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const relative = `${folder}/${entry.name}`;
    if (entry.isDirectory()) found.push(...filesUnder(relative));
    else found.push(relative);
  }
  return found;
}

function isSourceFile(file: string): boolean {
  return /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file);
}

// The code that ships: packages/*/src and apps/*/src, without tests.
function shippedSourceFiles(): string[] {
  const sourceFolders = [...childFolders("packages"), ...childFolders("apps")].map((folder) => `${folder}/src`);
  return sourceFolders.filter((folder) => fs.existsSync(path.join(REPOSITORY_ROOT, folder))).flatMap(filesUnder).filter(isSourceFile);
}

function packageJsonFiles(): string[] {
  const folders = ["", ...childFolders("packages"), ...childFolders("apps"), ...childFolders("fixtures"), ...childFolders("e2e")];
  return folders
    .map((folder) => (folder === "" ? "package.json" : `${folder}/package.json`))
    .filter((file) => fs.existsSync(path.join(REPOSITORY_ROOT, file)));
}

function readFile(file: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
}

// The module names a source file imports: `import … from "x"`, `import "x"`, `import("x")` and `require("x")`.
function importedModules(sourceText: string): string[] {
  const importPattern = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
  return [...sourceText.matchAll(importPattern)].map((match) => match[1] ?? "");
}

// The package names a package.json depends on, of every kind.
function dependencyNames(packageJsonText: string): string[] {
  const json = JSON.parse(packageJsonText) as Record<string, unknown>;
  const kinds = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  return kinds.flatMap((kind) => Object.keys((json[kind] as Record<string, string> | undefined) ?? {}));
}

function isModule(imported: string, wanted: readonly string[]): boolean {
  return wanted.some((name) => imported === name || imported.startsWith(`${name}/`));
}

function isInside(file: string, folders: readonly string[]): boolean {
  return folders.some((folder) => file.startsWith(`${folder}/`));
}

// The files that import one of `modules` although they are not inside one of the `allowedFolders`.
function importsOutside(modules: readonly string[], allowedFolders: readonly string[]): string[] {
  return shippedSourceFiles()
    .filter((file) => !isInside(file, allowedFolders))
    .flatMap((file) =>
      importedModules(readFile(file))
        .filter((imported) => isModule(imported, modules))
        .map((imported) => `${file} imports "${imported}"`),
    );
}

// ---------------------------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------------------------

describe("dependency rules", () => {
  it("looks at real files, so the rules below cannot pass by finding nothing", () => {
    expect(shippedSourceFiles().length).toBeGreaterThan(100);
    expect(packageJsonFiles()).toContain("packages/server/package.json");
  });

  it("uses no model SDK: no import of one in the code and no package.json that depends on one", () => {
    const inCode = shippedSourceFiles().flatMap((file) =>
      importedModules(readFile(file))
        .filter((imported) => isModule(imported, MODEL_SDKS))
        .map((imported) => `${file} imports "${imported}"`),
    );
    const inPackageJson = packageJsonFiles().flatMap((file) =>
      dependencyNames(readFile(file))
        .filter((name) => isModule(name, MODEL_SDKS))
        .map((name) => `${file} depends on "${name}"`),
    );

    expect([...inCode, ...inPackageJson], "Jobgoblin must never call a model itself; reasoning runs in Claude Code.").toEqual([]);
  });

  it("opens the database only inside packages/storage/src", () => {
    expect(importsOutside(SQLITE_MODULES, MAY_USE_SQLITE), "Only packages/storage may import node:sqlite.").toEqual([]);
  });

  it("starts processes only inside packages/server/src/runner and apps/desktop/src", () => {
    expect(
      importsOutside(PROCESS_MODULES, MAY_START_PROCESSES),
      "Only the runner and the desktop app may import node:child_process.",
    ).toEqual([]);
  });
});
