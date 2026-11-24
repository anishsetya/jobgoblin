// Checks, installs and signs in the person's own Claude Code. Jobgoblin never modifies, wraps or copies
// it, and never reads its credential files: it only runs `claude --version`, `claude auth status` and
// `claude auth login`, and shows the install command before it runs. Where the program is on disk is
// found by findClaudeProgram.ts. An install or update that leaves Claude Code missing or too old is
// refused with what happened, so the person is never left looking at the same button.
// Spec: ARCHITECTURE.md section 10 (Claude Code CLI) and decision D21; tech spec "Claude Code integration".
import path from "node:path";
import { z } from "zod";
import type { ClaudeStatus } from "@jobgoblin/schemas";
import { unavailable, type ServiceError } from "../services/serviceError";
import { findClaudeProgram } from "./findClaudeProgram";
import { runCommand } from "./processes";
import type { CommandResult, CommandRunner } from "./processes";
import { scrubClaudeEnvironment } from "./runEnvironment";

export const MINIMUM_CLAUDE_VERSION = "2.1.0";

// What the Connect screen shows as the sign-in command. The real command line uses the full path we found.
const SIGN_IN_COMMAND_TEXT = "claude auth login";

const WINGET_INSTALL_COMMAND = [
  "winget", "install", "--id", "Anthropic.ClaudeCode", "-e", "--accept-source-agreements", "--accept-package-agreements",
];
// Anthropic's official installer for macOS (it also works on Linux). It is a fixed string with nothing from the
// person or a posting in it, so running it through bash is safe.
const SCRIPT_INSTALL_COMMAND = ["/bin/bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"];

const VERSION_TIMEOUT_MS = 15_000;
const AUTH_STATUS_TIMEOUT_MS = 20_000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
// `claude auth login` waits while the person finishes signing in in their browser.
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

// The only way of signing in that a run may use: the person's Claude plan.
const REQUIRED_AUTH_METHOD = "claude.ai";

export type ClaudeAuth = { loggedIn: boolean; authMethod: string | null; plan: string | null };

export type ClaudeCliOptions = {
  claudeCommand: string[] | null; // from the start options (decision D21); null means look for it
  claudeInstallCommand: string[] | null; // from the start options; null means the default for this system
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  runCommand?: CommandRunner;
};

export type ClaudeCli = {
  resolveCommand(): Promise<string[] | null>;
  status(): Promise<ClaudeStatus>;
  install(): Promise<ClaudeStatus>;
  signIn(): Promise<ClaudeStatus>;
  authStatus(): Promise<ClaudeAuth>;
};

export function createClaudeCli(options: ClaudeCliOptions): ClaudeCli {
  const platform = options.platform ?? process.platform;
  const processEnv = options.env ?? process.env;
  const run = options.runCommand ?? runCommand;
  const configuredCommand = checkedClaudeCommand(options.claudeCommand);
  const installCommand = options.claudeInstallCommand ?? defaultInstallCommand(platform);

  // Every command gets the environment a run will get, so the answers describe how a run will really sign in.
  const commandEnvironment = scrubClaudeEnvironment(processEnv);

  async function resolveCommand(): Promise<string[] | null> {
    if (configuredCommand !== null) return configuredCommand;
    const found = findClaudeProgram({ platform, env: processEnv });
    return found === null ? null : [found];
  }

  async function readVersion(command: string[]): Promise<string | null> {
    const result = await run([...command, "--version"], { env: commandEnvironment, timeoutMs: VERSION_TIMEOUT_MS });
    if (!result.started || result.exitCode !== 0) return null;
    return parseClaudeVersion(result.stdout);
  }

  async function authStatus(): Promise<ClaudeAuth> {
    const command = await resolveCommand();
    if (command === null) return SIGNED_OUT;

    // The real command exits non-zero when signed out but still prints its JSON, so stdout is read first.
    const result = await run([...command, "auth", "status"], { env: commandEnvironment, timeoutMs: AUTH_STATUS_TIMEOUT_MS });
    return readAuthStatus(result.stdout);
  }

  async function status(): Promise<ClaudeStatus> {
    const installText = describeCommand(installCommand);

    const command = await resolveCommand();
    if (command === null) return buildStatus({ state: "not-installed", installText });

    const version = await readVersion(command);
    // A program that does not run is as good as missing.
    if (version === null) return buildStatus({ state: "not-installed", installText });
    if (!isVersionAtLeast(version, MINIMUM_CLAUDE_VERSION)) {
      return buildStatus({ state: "update-needed", version, installText });
    }

    const auth = await authStatus();
    if (!isSignedInWithClaudePlan(auth)) return buildStatus({ state: "signed-out", version, installText });
    return buildStatus({ state: "connected", version, plan: auth.plan, installText });
  }

  // The status afterwards decides whether it worked, not the exit code: an installer can report an error and
  // still have installed Claude Code, or report success and leave it where Jobgoblin can't find it.
  async function install(): Promise<ClaudeStatus> {
    const result = await run(installCommand, { env: commandEnvironment, timeoutMs: INSTALL_TIMEOUT_MS });
    const after = await status();
    if (after.state === "not-installed" || after.state === "update-needed") throw installFailure(result, after);
    return after;
  }

  async function signIn(): Promise<ClaudeStatus> {
    const command = await resolveCommand();
    if (command !== null) {
      await run([...command, "auth", "login"], { env: commandEnvironment, timeoutMs: SIGN_IN_TIMEOUT_MS });
    }
    return status();
  }

  return { resolveCommand, status, install, signIn, authStatus };
}

type StatusParts = {
  state: ClaudeStatus["state"];
  installText: string;
  version?: string;
  plan?: string | null;
};

function buildStatus(parts: StatusParts): ClaudeStatus {
  return {
    state: parts.state,
    version: parts.version ?? null,
    minimumVersion: MINIMUM_CLAUDE_VERSION,
    installCommand: parts.installText,
    signInCommand: SIGN_IN_COMMAND_TEXT,
    plan: parts.plan ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// The configured program
// ---------------------------------------------------------------------------------------------

// Relative paths are refused (decision D21 and the launch rule): the program's place must not depend on the
// folder the server happened to start in. The array is the program and any script it runs, such as the fake.
function checkedClaudeCommand(command: string[] | null): string[] | null {
  if (command === null) return null;
  if (command.length === 0 || !command.every((part) => path.isAbsolute(part))) {
    throw new Error("The Claude command must be a list of absolute paths.");
  }
  return command;
}

// ---------------------------------------------------------------------------------------------
// Version, sign-in and install text
// ---------------------------------------------------------------------------------------------

// "2.1.99 (Claude Code)" -> "2.1.99"
export function parseClaudeVersion(output: string): string | null {
  return /(\d+)\.(\d+)\.(\d+)/.exec(output)?.[0] ?? null;
}

export function isVersionAtLeast(version: string, minimum: string): boolean {
  const have = version.split(".").map(Number);
  const need = minimum.split(".").map(Number);
  for (let place = 0; place < need.length; place += 1) {
    const difference = (have[place] ?? 0) - (need[place] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

const SIGNED_OUT: ClaudeAuth = { loggedIn: false, authMethod: null, plan: null };

// Only these fields are kept. The real command also prints the person's e-mail address, which is never stored.
const AuthStatusJson = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string().optional(),
  subscriptionType: z.string().optional(),
});

function readAuthStatus(stdout: string): ClaudeAuth {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return SIGNED_OUT;
  }

  const parsed = AuthStatusJson.safeParse(json);
  if (!parsed.success) return SIGNED_OUT;
  return {
    loggedIn: parsed.data.loggedIn,
    authMethod: parsed.data.authMethod ?? null,
    plan: parsed.data.subscriptionType ?? null,
  };
}

// Runs need the person's Claude plan, not an API key or a cloud account, so any other sign-in counts as signed out.
export function isSignedInWithClaudePlan(auth: ClaudeAuth): boolean {
  return auth.loggedIn && auth.authMethod === REQUIRED_AUTH_METHOD;
}

function defaultInstallCommand(platform: NodeJS.Platform): string[] {
  return platform === "win32" ? WINGET_INSTALL_COMMAND : SCRIPT_INSTALL_COMMAND;
}

// Why Claude Code is still missing or too old after the install command ran, and what to do next. A copy that
// is still too old means it was an update, which is the button the person pressed.
function installFailure(result: CommandResult, after: ClaudeStatus): ServiceError {
  const isUpdate = after.state === "update-needed";
  const code = isUpdate ? "claude-update-failed" : "claude-install-failed";
  const what = isUpdate ? "update" : "install";
  const byHand = 'run the command under "See exactly what this does" yourself, then press Check again.';
  const tryAgain = `Press ${isUpdate ? "Update Claude Code" : "Install Claude Code"} to try again. If it fails again, ${byHand}`;

  // Pressing the button again would fail the same way, so the only next step is the command itself.
  if (!result.started) return unavailable(code, `Jobgoblin couldn't start the Claude Code ${what}.`, `You can ${byHand}`);
  if (result.timedOut) {
    const minutes = INSTALL_TIMEOUT_MS / 60_000;
    return unavailable(code, `The Claude Code ${what} took longer than ${minutes} minutes, so Jobgoblin stopped it.`, tryAgain);
  }
  if (result.exitCode !== 0) {
    return unavailable(code, `The Claude Code ${what} stopped with an error (code ${result.exitCode}).`, tryAgain);
  }
  if (isUpdate) {
    const message = `The update finished, but Claude Code is still version ${after.version}. Jobgoblin needs ${after.minimumVersion} or newer.`;
    return unavailable(code, message, tryAgain);
  }
  return unavailable(code, "The install finished, but Jobgoblin still can't find Claude Code.", tryAgain);
}

// The command as the person reads it before it runs.
export function describeCommand(command: readonly string[]): string {
  const [program, flag, script] = command;
  const isShellScript = flag === "-c" && script !== undefined && program !== undefined && /(^|[\\/])(ba)?sh$/.test(program);
  if (isShellScript) return script;

  return command.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(" ");
}
