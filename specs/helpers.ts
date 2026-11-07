// Helpers for the Phase 3 audit (failure states, bad inputs, trust, UX, docs, Electron). Nothing here changes the
// product. Everything is created in temporary folders named jobgoblin-audit2-*, which each test removes.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "@playwright/test";
import { FAKE_CLAUDE_CLI, REPO_ROOT } from "../support/server";

export const TEMP_PREFIX = "jobgoblin-audit2-";

export function tempDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${TEMP_PREFIX}${label}-`));
}

export function removeDir(folder: string): void {
  try {
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // A temp folder left behind is harmless.
  }
}

// ---------------------------------------------------------------------------------------------
// A fake claude whose mode can change while the server runs
// ---------------------------------------------------------------------------------------------

export type FlakyClaude = {
  dir: string;
  // JOBGOBLIN_CLAUDE_COMMAND (and nothing else) for the server's fakeClaudeEnv.
  env: Record<string, string>;
  // Which fake mode each run kind gets from now on: { tailor: "usage-limit" }, { "*": "signed-out" } or null for normal.
  // Also { version: "1.0.0" } makes `--version` print an old version.
  setModes(modes: Record<string, string> | null): void;
  log(): string;
  // Everything the server answered to the fake claude on /mcp (what a real run would have been handed), and the
  // playbooks it was given on stdin.
  repliesFile: string;
  playbooksFile: string;
  remove(): void;
};

// The server starts this exactly as it starts claude. It reads the run kind from the playbook on stdin, picks the
// fake's mode for that kind from modes.json, and then runs the REAL fake claude with that mode. So the whole
// server path (runner, outcome, run cards) is the product's own; only the choice of failure is the audit's.
export function makeFlakyClaude(): FlakyClaude {
  const dir = tempDir("flaky");
  const modesFile = path.join(dir, "modes.json");
  const logFile = path.join(dir, "invocations.log");
  const script = path.join(dir, "flaky-claude.mjs");
  const preload = path.join(dir, "capture-mcp-replies.mjs");
  const repliesFile = path.join(dir, "mcp-replies.log");
  const playbooksFile = path.join(dir, "playbooks.log");
  // Loaded into the fake claude (node --import): writes what the server answers on /mcp to a file, so a test can read
  // exactly what the server handed to the run. Request headers (the run token) are never written.
  fs.writeFileSync(
    preload,
    `import fs from "node:fs";
const original = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const response = await original(...args);
  try {
    const first = args[0];
    const url = typeof first === "string" ? first : first instanceof URL ? first.href : first?.url ?? "";
    if (url.includes("/mcp")) {
      const copy = response.clone();
      copy.text().then((text) => fs.appendFileSync(${JSON.stringify(repliesFile)}, text + "\\n"), () => {});
    }
  } catch {}
  return response;
};
`,
  );
  fs.writeFileSync(
    script,
    `import { spawn } from "node:child_process";
import fs from "node:fs";
const FAKE = ${JSON.stringify(FAKE_CLAUDE_CLI)};
const MODES = ${JSON.stringify(modesFile)};
const LOG = ${JSON.stringify(logFile)};
const args = process.argv.slice(2);
let modes = {};
try { modes = JSON.parse(fs.readFileSync(MODES, "utf8")); } catch {}
if (args[0] === "--version" && modes.version) {
  fs.appendFileSync(LOG, new Date().toISOString() + " --version (old: " + modes.version + ")\\n");
  process.stdout.write(modes.version + " (Claude Code)\\n");
  process.exit(0);
}
const isRun = args.includes("-p");
const chunks = [];
if (isRun) { for await (const chunk of process.stdin) chunks.push(chunk); }
const input = Buffer.concat(chunks);
const kind = /<!-- run-kind: (\\w+) -->/.exec(input.toString("utf8"))?.[1] ?? "none";
const mode = modes[kind] ?? modes["*"] ?? "";
const env = { ...process.env };
delete env.FAKE_CLAUDE_MODE;
if (mode) env.FAKE_CLAUDE_MODE = mode;
fs.appendFileSync(LOG, new Date().toISOString() + " " + (args[0] ?? "") + " " + (args[1] ?? "") + " kind=" + kind + " mode=" + (mode || "normal") + "\\n");
if (isRun) fs.appendFileSync(${JSON.stringify(playbooksFile)}, "=== run " + kind + " ===\\n" + input.toString("utf8") + "\\n");
const child = spawn(process.execPath, ["--import", ${JSON.stringify(pathToFileURL(preload).href)}, FAKE, ...args], { stdio: ["pipe", "inherit", "inherit"], env });
child.stdin.on("error", () => {});
child.stdin.end(input);
child.on("exit", (code) => process.exit(code ?? 1));
`,
  );
  return {
    dir,
    env: { JOBGOBLIN_CLAUDE_COMMAND: JSON.stringify([process.execPath, script]) },
    setModes: (modes) => {
      if (modes === null) fs.rmSync(modesFile, { force: true });
      else fs.writeFileSync(modesFile, JSON.stringify(modes));
    },
    log: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : ""),
    repliesFile,
    playbooksFile,
    remove: () => removeDir(dir),
  };
}

// ---------------------------------------------------------------------------------------------
// Install stubs. The product's default install command is a real winget install; it must never run.
// ---------------------------------------------------------------------------------------------

export type InstallStub = {
  dir: string;
  env: Record<string, string>; // JOBGOBLIN_CLAUDE_INSTALL_COMMAND
  calls(): string[];
  remove(): void;
};

// kind "never": records that it was called and fails. "ok": copies node.exe to <home>/.local/bin/claude.exe, which
// the server's search finds, so the server then thinks Claude Code is installed (it answers --version with node's
// version, and `auth status` with nothing, so the state after a successful install is "Not signed in").
// "fail": exits 1 with a message on stderr.
export function makeInstallStub(kind: "never" | "ok" | "fail", homeDir: string): InstallStub {
  const dir = tempDir(`install-${kind}`);
  const callsFile = path.join(dir, "calls.log");
  const script = path.join(dir, `install-${kind}.mjs`);
  const target = path.join(homeDir, ".local", "bin", "claude.exe");
  const body =
    kind === "ok"
      ? `fs.mkdirSync(${JSON.stringify(path.dirname(target))}, { recursive: true }); fs.copyFileSync(process.execPath, ${JSON.stringify(target)});`
      : `process.stderr.write("simulated install failure\\n"); process.exitCode = 1;`;
  fs.writeFileSync(
    script,
    `import fs from "node:fs";
fs.appendFileSync(${JSON.stringify(callsFile)}, new Date().toISOString() + " install stub '${kind}' was run\\n");
${body}
`,
  );
  return {
    dir,
    env: { JOBGOBLIN_CLAUDE_INSTALL_COMMAND: JSON.stringify([process.execPath, script]) },
    calls: () => (fs.existsSync(callsFile) ? fs.readFileSync(callsFile, "utf8").split("\n").filter(Boolean) : []),
    remove: () => removeDir(dir),
  };
}

// Runs `action` with the machine-level variables that decide where claude.exe is looked for pointed at empty folders,
// so the real ~/.local/bin/claude.exe cannot be found. The server copies process.env at spawn time, so this only
// has to hold while the server starts.
export async function withNoClaudeOnThisMachine<T>(homeDir: string, action: () => Promise<T>): Promise<T> {
  const emptyPath = path.join(homeDir, "empty-path");
  fs.mkdirSync(emptyPath, { recursive: true });
  const names = ["PATH", "Path", "USERPROFILE", "HOME", "LOCALAPPDATA", "HOMEPATH"] as const;
  const saved = new Map<string, string | undefined>();
  for (const name of names) saved.set(name, process.env[name]);
  process.env.PATH = emptyPath;
  process.env.USERPROFILE = homeDir;
  process.env.HOME = homeDir;
  process.env.LOCALAPPDATA = path.join(homeDir, "local-app-data");
  try {
    return await action();
  } finally {
    // process.env is case-insensitive on Windows, so restoring PATH restores Path.
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Reading files the way a person's other programs would
// ---------------------------------------------------------------------------------------------

export type PdfInfo = { pages: number; title: string | null; author: string | null; keywords: string | null; text: string; producer: string | null };

export async function readPdfInfo(bytes: Uint8Array): Promise<PdfInfo> {
  const renderRequire = createRequire(path.join(REPO_ROOT, "packages", "render", "package.json"));
  const pdfMain = renderRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjs = (await import(pathToFileURL(pdfMain).href)) as typeof import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(renderRequire.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href;
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), verbosity: 0 });
  try {
    const doc = await task.promise;
    const meta = (await doc.getMetadata()).info as Record<string, unknown>;
    let text = "";
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      text += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + "\n";
    }
    const asText = (value: unknown): string | null => (typeof value === "string" ? value : null);
    return { pages: doc.numPages, title: asText(meta.Title), author: asText(meta.Author), keywords: asText(meta.Keywords), producer: asText(meta.Producer), text };
  } finally {
    await task.destroy();
  }
}

export type WorkbookInfo = { sheets: { name: string; rowCount: number; header: string[]; rows: string[][] }[] };

export async function readWorkbook(bytes: Uint8Array): Promise<WorkbookInfo> {
  const storageRequire = createRequire(path.join(REPO_ROOT, "packages", "storage", "package.json"));
  const ExcelJS = storageRequire("exceljs") as typeof import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const sheets = workbook.worksheets.map((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      const values = (row.values as unknown[]).slice(1).map((cell) => {
        if (cell === null || cell === undefined) return "";
        if (typeof cell === "object" && "text" in (cell as Record<string, unknown>)) return String((cell as { text: string }).text);
        if (typeof cell === "object" && "result" in (cell as Record<string, unknown>)) return String((cell as { result: unknown }).result);
        return String(cell);
      });
      rows.push(values);
    });
    return { name: sheet.name, rowCount: rows.length, header: rows[0] ?? [], rows: rows.slice(1) };
  });
  return { sheets };
}

// Every file under a folder, as { path, text } for the files that can be read as text; used by the privacy sweep.
export function readAllText(root: string): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = [];
  function walk(folder: string): void {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          found.push({ file: full, text: fs.readFileSync(full, "latin1") });
        } catch {
          // A file that is locked is skipped; the caller reports how many files it could read.
        }
      }
    }
  }
  walk(root);
  return found;
}

// ---------------------------------------------------------------------------------------------
// Looking at the page the way a person does
// ---------------------------------------------------------------------------------------------

export type RunCardView = { title: string; status: string; buttons: string[] };

export async function runCards(page: Page): Promise<RunCardView[]> {
  return page.getByTestId("run-card").evaluateAll((cards) =>
    cards.map((card) => ({
      title: card.getAttribute("aria-label") ?? "",
      status: (card.querySelector("[role=status]") as HTMLElement | null)?.innerText ?? "",
      buttons: [...card.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.innerText),
    })),
  );
}

export async function needsYouTexts(page: Page): Promise<string[]> {
  return page.getByTestId("needs-you-item").evaluateAll((items) => items.map((item) => (item as HTMLElement).innerText.replace(/\s+/g, " ").trim()));
}

export async function alertTexts(page: Page): Promise<string[]> {
  return page.getByRole("alert").evaluateAll((items) => items.map((item) => (item as HTMLElement).innerText.replace(/\s+/g, " ").trim()));
}
