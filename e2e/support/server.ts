// Starts a real Jobgoblin server for one test: the built bundle, a fresh app data folder and person's folder,
// the demo job board instead of the network, and the fake claude instead of Claude Code.
// The test then drives the dashboard in a browser exactly as a person would, against that server.
// Spec: ARCHITECTURE.md sections 11 (server entry), 14 (fake claude) and 15 (e2e).
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedAlexRivera, type SeedOptions } from "./seed";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const SERVER_BUNDLE = path.join(REPO_ROOT, "packages", "server", "dist", "server.mjs");
export const FAKE_CLAUDE_CLI = path.join(REPO_ROOT, "fixtures", "fake-claude", "dist", "cli.mjs");
export const DEMO_FEEDS_DIR = path.join(REPO_ROOT, "fixtures", "feeds", "demo");

const READY_TIMEOUT_MS = 45_000;
const READY_LINE = /^JOBGOBLIN_READY (\{.*\})\s*$/;

export type TestServerOptions = {
  // Extra FAKE_CLAUDE_* switches for the fake claude, such as { FAKE_CLAUDE_MODE: "slow" }.
  fakeClaudeEnv?: Record<string, string>;
  // "alex-rivera" sets up the demo person through the public API; "none" leaves the app empty (first run).
  seed?: "none" | "alex-rivera";
  seedOptions?: SeedOptions;
  // Start on the data of a server that was killed, to test recovery. Its folders are reused, not recreated.
  reuseDataOf?: TestServer;
  // Use this person's folder (holding another server's backups, say) with a brand-new app data folder:
  // what moving to a new computer looks like.
  personFolder?: string;
};

export type TestServer = {
  url: string; // http://127.0.0.1:<port>/#token=<session token>: what a person would open
  origin: string; // http://127.0.0.1:<port>
  token: string;
  pid: number;
  rootDir: string; // holds app-data/ and person-folder/
  appDataDir: string;
  personFolder: string;
  // The server's output so far, for a failure message.
  output(): string;
  // GET/POST/... an /api route with the session token, parsed as JSON (or text when the answer is not JSON).
  api<T = unknown>(route: string, init?: { method?: string; body?: unknown }): Promise<T>;
  // Kills ONLY the server process, the way a crash or a power cut would: whatever it started (a Claude
  // process) is left behind, and so is the data. This is what crash recovery has to clean up after.
  crash(): Promise<void>;
  // Stops the process and everything it started, but leaves the data folders.
  killHard(): Promise<void>;
  // Stops the process tree and deletes the data folders.
  stop(): Promise<void>;
};

export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  assertBuildsExist();

  const previous = options.reuseDataOf;
  const rootDir = previous?.rootDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "jobgoblin-e2e-"));
  const appDataDir = previous?.appDataDir ?? path.join(rootDir, "app-data");
  const personFolder = previous?.personFolder ?? options.personFolder ?? path.join(rootDir, "person-folder");

  const child = spawn(process.execPath, [SERVER_BUNDLE], {
    cwd: REPO_ROOT,
    env: buildServerEnvironment({ appDataDir, fakeClaudeEnv: options.fakeClaudeEnv ?? {} }),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const log = collectOutput(child);

  let ready: { port: number; url: string };
  try {
    ready = await waitForReadyLine(child, log);
  } catch (error) {
    killProcessTree(child.pid);
    throw error;
  }

  const fragment = new URL(ready.url).hash.slice(1);
  const token = new URLSearchParams(fragment).get("token") ?? "";
  const origin = `http://127.0.0.1:${ready.port}`;

  const server: TestServer = {
    url: ready.url,
    origin,
    token,
    pid: child.pid ?? 0,
    rootDir,
    appDataDir,
    personFolder,
    output: () => log.text(),
    api: (route, init) => callApi(origin, token, route, init),
    crash: async () => {
      killProcess(child.pid);
      await waitForExit(child);
    },
    killHard: async () => {
      killProcessTree(child.pid);
      await waitForExit(child);
    },
    stop: async () => {
      killProcessTree(child.pid);
      await waitForExit(child);
      removeFolder(rootDir);
    },
  };

  if ((options.seed ?? "none") === "alex-rivera") {
    await seedAlexRivera(server, options.seedOptions);
  }
  return server;
}

function assertBuildsExist(): void {
  for (const file of [SERVER_BUNDLE, FAKE_CLAUDE_CLI, path.join(REPO_ROOT, "apps", "dashboard", "dist", "index.html")]) {
    if (!fs.existsSync(file)) throw new Error(`${file} is missing. Run the tests with "pnpm test:e2e" so globalSetup builds it.`);
  }
}

// The server sees the machine's environment (it needs PATH), minus anything that could leak into a run,
// plus the settings every test needs. FAKE_CLAUDE_* from the developer's shell never leaks in.
function buildServerEnvironment(input: { appDataDir: string; fakeClaudeEnv: Record<string, string> }): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith("FAKE_CLAUDE_") || name.startsWith("JOBGOBLIN_")) continue;
    inherited[name] = value;
  }
  return {
    ...inherited,
    JOBGOBLIN_APP_DATA: input.appDataDir,
    JOBGOBLIN_RESOURCES_DIR: REPO_ROOT,
    JOBGOBLIN_FEED_FIXTURES: DEMO_FEEDS_DIR,
    JOBGOBLIN_CLAUDE_COMMAND: JSON.stringify([process.execPath, FAKE_CLAUDE_CLI]),
    JOBGOBLIN_PORT: "0",
    ...input.fakeClaudeEnv,
  };
}

type OutputLog = { text(): string };

function collectOutput(child: ChildProcess): OutputLog {
  let text = "";
  child.stdout?.on("data", (chunk: Buffer) => (text += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (text += chunk.toString()));
  return { text: () => text };
}

function waitForReadyLine(child: ChildProcess, log: OutputLog): Promise<{ port: number; url: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`The server did not print JOBGOBLIN_READY within ${READY_TIMEOUT_MS / 1000} s.\n${log.text()}`));
    }, READY_TIMEOUT_MS);

    function checkOutput(): void {
      for (const line of log.text().split(/\r?\n/)) {
        const match = READY_LINE.exec(line);
        if (match?.[1] === undefined) continue;
        clearTimeout(timer);
        resolve(JSON.parse(match[1]) as { port: number; url: string });
        return;
      }
    }

    child.stdout?.on("data", checkOutput);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`The server exited with code ${code} before it was ready.\n${log.text()}`));
    });
  });
}

// taskkill /T ends the server and any fake claude it started. A plain child.kill() would leave those running.
function killProcessTree(pid: number | undefined): void {
  killProcessWith(pid, ["/T", "/F"]);
}

// Only this process, no children: a crash.
function killProcess(pid: number | undefined): void {
  killProcessWith(pid, ["/F"]);
}

function killProcessWith(pid: number | undefined, windowsFlags: string[]): void {
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), ...windowsFlags], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // Already gone: that is the goal.
  }
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 10_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function removeFolder(folder: string): void {
  if (process.env.E2E_KEEP_DATA === "1") return;
  try {
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // A temp folder left behind is harmless; failing the test over it would hide the real result.
  }
}

async function callApi<T>(
  origin: string,
  token: string,
  route: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${origin}${route}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${route} answered ${response.status}: ${text}`);
  return (text === "" ? undefined : JSON.parse(text)) as T;
}
