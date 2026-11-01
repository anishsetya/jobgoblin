// Reads the server's start options from the environment and command-line flags (a flag wins over the
// environment). Kept apart from main.ts so it can be tested without starting anything.
//   JOBGOBLIN_APP_DATA, --app-data              the app data folder
//   JOBGOBLIN_RESOURCES_DIR, --resources-dir    the folder holding packages/, playbooks/, apps/dashboard/dist
//   JOBGOBLIN_PORT, --port                      0 picks any free port
//   JOBGOBLIN_CLAUDE_COMMAND                    a JSON array, such as ["C:\\...\\claude.exe"]
//   JOBGOBLIN_CLAUDE_INSTALL_COMMAND            a JSON array
//   JOBGOBLIN_FEED_FIXTURES, --feed-fixtures    read saved feeds from this folder instead of the network
//   JOBGOBLIN_DEV_ORIGIN, --dev-origin          the dashboard dev server's origin, such as http://localhost:5173
// Spec: ARCHITECTURE.md section 11 (server entry) and decision D14.
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StartOptions } from "./context";
import { DEFAULT_PORT } from "./http/listen";

export function readStartOptions(env: NodeJS.ProcessEnv, args: readonly string[]): StartOptions {
  const flags = readFlags(args);
  return {
    appDataDir: path.resolve(flags["app-data"] ?? env.JOBGOBLIN_APP_DATA ?? defaultAppDataDir(env)),
    resourcesDir: path.resolve(flags["resources-dir"] ?? env.JOBGOBLIN_RESOURCES_DIR ?? defaultResourcesDir()),
    port: readPort(flags.port ?? env.JOBGOBLIN_PORT),
    claudeCommand: readCommand("JOBGOBLIN_CLAUDE_COMMAND", env.JOBGOBLIN_CLAUDE_COMMAND),
    claudeInstallCommand: readCommand("JOBGOBLIN_CLAUDE_INSTALL_COMMAND", env.JOBGOBLIN_CLAUDE_INSTALL_COMMAND),
    feedFixturesDir: optionalPath(flags["feed-fixtures"] ?? env.JOBGOBLIN_FEED_FIXTURES),
    devOrigin: optionalText(flags["dev-origin"] ?? env.JOBGOBLIN_DEV_ORIGIN),
  };
}

// "--port 0" and "--port=0" both work. Anything that is not a "--name value" pair is ignored.
function readFlags(args: readonly string[]): Record<string, string | undefined> {
  const flags: Record<string, string | undefined> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("--")) continue;
    const equalsAt = arg.indexOf("=");
    if (equalsAt !== -1) {
      flags[arg.slice(2, equalsAt)] = arg.slice(equalsAt + 1);
    } else {
      flags[arg.slice(2)] = args[index + 1];
      index += 1;
    }
  }
  return flags;
}

function readPort(text: string | undefined): number {
  if (text === undefined || text.trim() === "") return DEFAULT_PORT;
  const port = Number(text);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`The port "${text}" is not a number from 0 to 65535.`);
  }
  return port;
}

// A command is an array of arguments, never one string, so no shell is involved and nothing is split on spaces.
function readCommand(name: string, text: string | undefined): string[] | null {
  if (text === undefined || text.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const isStringList = Array.isArray(parsed) && parsed.length > 0 && parsed.every((part) => typeof part === "string" && part !== "");
  if (!isStringList) throw new Error(`${name} must be a JSON array of strings, such as ["C:\\\\tools\\\\claude.exe"].`);
  return parsed as string[];
}

function optionalText(text: string | undefined): string | null {
  return text === undefined || text.trim() === "" ? null : text.trim();
}

function optionalPath(text: string | undefined): string | null {
  const value = optionalText(text);
  return value === null ? null : path.resolve(value);
}

function defaultAppDataDir(env: NodeJS.ProcessEnv): string {
  if (process.platform === "win32") return path.join(env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Jobgoblin");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Jobgoblin");
  return path.join(env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "jobgoblin");
}

// The repository root: three folders above packages/server/src (and above packages/server/dist, where the bundle lives).
function defaultResourcesDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}
