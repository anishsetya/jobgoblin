import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createClaudeCli,
  describeCommand,
  isSignedInWithClaudePlan,
  isVersionAtLeast,
  MINIMUM_CLAUDE_VERSION,
  parseClaudeVersion,
} from "./claudeCli";
import type { ClaudeCliOptions } from "./claudeCli";
import type { CommandOptions, CommandResult, CommandRunner } from "./processes";
import { makeTempDir, removeTempDirs } from "./testSupport";

afterEach(removeTempDirs);

// ---------------------------------------------------------------------------------------------
// A command runner that answers from a script and records every call: no real process starts.
// ---------------------------------------------------------------------------------------------

type Call = { command: readonly string[]; options: CommandOptions | undefined };

function scriptedRunner(answer: (command: readonly string[]) => Partial<CommandResult> | undefined) {
  const calls: Call[] = [];
  const runner: CommandRunner = async (command, options) => {
    calls.push({ command, options });
    const partial = answer(command);
    if (partial === undefined) return { started: false, exitCode: null, stdout: "", stderr: "", timedOut: false };
    return { started: true, exitCode: 0, stdout: "", stderr: "", timedOut: false, ...partial };
  };
  return { runner, calls };
}

// An absolute path on every system. Nothing is ever started from it: the command runner is scripted.
const CLAUDE_PATH = path.join(os.tmpdir(), "claude-for-tests");
const SIGNED_IN = '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"pro","email":"someone@example.com"}';
const SIGNED_OUT = '{"loggedIn":false,"authMethod":"none"}';

// Claude Code installed at CLAUDE_PATH, with the version and auth output given.
function installedClaude(versionText: string, authText: string) {
  return scriptedRunner((command) => {
    if (command.at(-1) === "--version") return { stdout: versionText };
    if (command.at(-1) === "status") return { stdout: authText, exitCode: authText === SIGNED_OUT ? 1 : 0 };
    return { stdout: "" };
  });
}

function aCli(overrides: Partial<ClaudeCliOptions>) {
  return createClaudeCli({
    claudeCommand: [CLAUDE_PATH],
    claudeInstallCommand: null,
    platform: "win32",
    env: {},
    ...overrides,
  });
}

describe("status", () => {
  it("is not-installed when Claude Code is nowhere to be found, and runs nothing", async () => {
    const { runner, calls } = scriptedRunner(() => undefined);
    const emptyFolder = makeTempDir();

    const status = await aCli({ claudeCommand: null, runCommand: runner, env: { PATH: emptyFolder, USERPROFILE: emptyFolder } }).status();

    expect(status).toMatchObject({ state: "not-installed", version: null, minimumVersion: MINIMUM_CLAUDE_VERSION, plan: null });
    expect(status.installCommand).toBe(
      "winget install --id Anthropic.ClaudeCode -e --accept-source-agreements --accept-package-agreements",
    );
    expect(status.signInCommand).toBe("claude auth login");
    expect(calls).toEqual([]);
  });

  it("is not-installed when the program is there but does not run", async () => {
    const { runner } = scriptedRunner(() => undefined);

    expect((await aCli({ runCommand: runner }).status()).state).toBe("not-installed");
  });

  it("is update-needed when the version is below the minimum, without asking about sign-in", async () => {
    const { runner, calls } = installedClaude("2.0.9 (Claude Code)\n", SIGNED_IN);

    const status = await aCli({ runCommand: runner }).status();

    expect(status).toMatchObject({ state: "update-needed", version: "2.0.9" });
    expect(calls.map((call) => call.command.at(-1))).toEqual(["--version"]);
  });

  it("is signed-out when auth status says so, even though the command exits with an error", async () => {
    const { runner } = installedClaude("2.1.99 (Claude Code)\n", SIGNED_OUT);

    const status = await aCli({ runCommand: runner }).status();

    expect(status).toMatchObject({ state: "signed-out", version: "2.1.99", plan: null });
  });

  it("is signed-out when the person is signed in some way other than their Claude plan", async () => {
    const apiKey = '{"loggedIn":true,"authMethod":"api_key"}';
    const { runner } = installedClaude("2.1.99 (Claude Code)\n", apiKey);

    expect((await aCli({ runCommand: runner }).status()).state).toBe("signed-out");
  });

  it("is connected, with the plan name, when the version is current and the person is signed in with Claude", async () => {
    const { runner } = installedClaude("2.1.99 (Claude Code)\n", SIGNED_IN);

    const status = await aCli({ runCommand: runner }).status();

    expect(status).toMatchObject({ state: "connected", version: "2.1.99", plan: "pro" });
  });

  it("accepts a version equal to the minimum", async () => {
    const { runner } = installedClaude(`${MINIMUM_CLAUDE_VERSION} (Claude Code)\n`, SIGNED_IN);

    expect((await aCli({ runCommand: runner }).status()).state).toBe("connected");
  });

  it("shows the macOS installer script as the install command on macOS", async () => {
    const { runner } = scriptedRunner(() => undefined);

    const status = await aCli({ platform: "darwin", runCommand: runner }).status();

    expect(status.installCommand).toBe("curl -fsSL https://claude.ai/install.sh | bash");
  });

  it("shows the install command from the start options when there is one", async () => {
    const { runner } = scriptedRunner(() => undefined);
    const installCommand = [path.join(makeTempDir(), "my installer.exe"), "--quiet"];

    const status = await aCli({ claudeInstallCommand: installCommand, runCommand: runner }).status();

    expect(status.installCommand).toBe(`"${installCommand[0]}" --quiet`);
  });

  it("never gives the person's API key or cloud settings to a claude command", async () => {
    const { runner, calls } = installedClaude("2.1.99 (Claude Code)\n", SIGNED_IN);
    const env = { PATH: "x", ANTHROPIC_API_KEY: "sk-ant", ANTHROPIC_BASE_URL: "http://127.0.0.1:9", CLAUDE_CODE_USE_BEDROCK: "1" };

    await aCli({ runCommand: runner, env }).status();

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.options?.env).toEqual({ PATH: "x" });
    }
  });
});

describe("authStatus", () => {
  it("reads the JSON on stdout before it looks at the exit code", async () => {
    const { runner } = installedClaude("2.1.99\n", SIGNED_OUT);

    expect(await aCli({ runCommand: runner }).authStatus()).toEqual({ loggedIn: false, authMethod: "none", plan: null });
  });

  it("keeps only the login state, the method and the plan: not the e-mail address", async () => {
    const { runner } = installedClaude("2.1.99\n", SIGNED_IN);

    const auth = await aCli({ runCommand: runner }).authStatus();

    expect(auth).toEqual({ loggedIn: true, authMethod: "claude.ai", plan: "pro" });
    expect(isSignedInWithClaudePlan(auth)).toBe(true);
  });

  it.each(["", "Not JSON at all", "[]", '{"loggedIn":"yes"}'])("reads %j as signed out", async (stdout) => {
    const { runner } = installedClaude("2.1.99\n", stdout);

    expect((await aCli({ runCommand: runner }).authStatus()).loggedIn).toBe(false);
  });

  it("is signed out when Claude Code is not installed", async () => {
    const { runner, calls } = scriptedRunner(() => undefined);
    const emptyFolder = makeTempDir();

    const auth = await aCli({ claudeCommand: null, runCommand: runner, env: { PATH: emptyFolder, USERPROFILE: emptyFolder } }).authStatus();

    expect(auth.loggedIn).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("install and signIn", () => {
  it("runs the winget command on Windows and then reports the new status", async () => {
    const { runner, calls } = installedClaude("2.1.99 (Claude Code)\n", SIGNED_OUT);

    const status = await aCli({ runCommand: runner }).install();

    expect(calls[0]?.command).toEqual([
      "winget", "install", "--id", "Anthropic.ClaudeCode", "-e", "--accept-source-agreements", "--accept-package-agreements",
    ]);
    expect(status.state).toBe("signed-out");
  });

  it("runs Anthropic's installer script on macOS", async () => {
    const { runner, calls } = scriptedRunner(() => undefined);

    await aCli({ platform: "darwin", runCommand: runner }).install();

    expect(calls[0]?.command).toEqual(["/bin/bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"]);
  });

  it("runs the install command from the start options instead of the default", async () => {
    const { runner, calls } = scriptedRunner(() => undefined);

    await aCli({ claudeInstallCommand: ["installer", "--now"], runCommand: runner }).install();

    expect(calls[0]?.command).toEqual(["installer", "--now"]);
  });

  it("signs in with `claude auth login` and then reports the status", async () => {
    const { runner, calls } = installedClaude("2.1.99 (Claude Code)\n", SIGNED_IN);

    const status = await aCli({ runCommand: runner }).signIn();

    expect(calls[0]?.command).toEqual([CLAUDE_PATH, "auth", "login"]);
    expect(status.state).toBe("connected");
  });

  it("does not try to sign in when Claude Code is not installed", async () => {
    const { runner, calls } = scriptedRunner(() => undefined);
    const emptyFolder = makeTempDir();

    const status = await aCli({ claudeCommand: null, runCommand: runner, env: { PATH: emptyFolder, USERPROFILE: emptyFolder } }).signIn();

    expect(status.state).toBe("not-installed");
    expect(calls).toEqual([]);
  });
});

describe("resolveCommand", () => {
  function touch(folder: string, fileName: string): string {
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, fileName);
    fs.writeFileSync(file, "");
    return file;
  }

  it("uses the command from the start options first, whatever else is installed", async () => {
    const pathFolder = makeTempDir();
    touch(pathFolder, "claude.exe");
    const command = [path.join(makeTempDir(), "node.exe"), path.join(makeTempDir(), "cli.mjs")];

    const resolved = await aCli({ claudeCommand: command, env: { PATH: pathFolder } }).resolveCommand();

    expect(resolved).toEqual(command);
  });

  it("refuses a Claude command that has a relative path", () => {
    expect(() => aCli({ claudeCommand: ["node", "cli.mjs"] })).toThrow(/absolute/);
    expect(() => aCli({ claudeCommand: [CLAUDE_PATH, "dist/cli.mjs"] })).toThrow(/absolute/);
    expect(() => aCli({ claudeCommand: [] })).toThrow(/absolute/);
  });

  it("finds claude.exe on PATH on Windows, even when the variable is spelled Path", async () => {
    const pathFolder = makeTempDir();
    const program = touch(pathFolder, "claude.exe");

    const resolved = await aCli({ claudeCommand: null, env: { Path: pathFolder } }).resolveCommand();

    expect(resolved).toEqual([program]);
  });

  it("never uses claude.cmd, which Node cannot start without a shell", async () => {
    const pathFolder = makeTempDir();
    touch(pathFolder, "claude.cmd");
    const home = makeTempDir();

    const resolved = await aCli({ claudeCommand: null, env: { PATH: pathFolder, USERPROFILE: home } }).resolveCommand();

    expect(resolved).toBeNull();
  });

  it("falls back to the native installer's folder, .local/bin in the person's home", async () => {
    const home = makeTempDir();
    const program = touch(path.join(home, ".local", "bin"), "claude.exe");

    const resolved = await aCli({ claudeCommand: null, env: { PATH: makeTempDir(), USERPROFILE: home } }).resolveCommand();

    expect(resolved).toEqual([program]);
  });

  it("prefers a program on PATH over the installer's folder", async () => {
    const pathFolder = makeTempDir();
    const onPath = touch(pathFolder, "claude.exe");
    const home = makeTempDir();
    touch(path.join(home, ".local", "bin"), "claude.exe");

    const resolved = await aCli({ claudeCommand: null, env: { PATH: pathFolder, USERPROFILE: home } }).resolveCommand();

    expect(resolved).toEqual([onPath]);
  });

  it("looks for a program called claude, not claude.exe, on macOS", async () => {
    const home = makeTempDir();
    touch(path.join(home, ".local", "bin"), "claude.exe");
    const program = touch(path.join(home, ".local", "bin"), "claude");

    const resolved = await aCli({ platform: "darwin", claudeCommand: null, env: { PATH: "", HOME: home } }).resolveCommand();

    expect(resolved).toEqual([program]);
  });

  it("finds the link winget makes, which the running server's PATH does not know yet", async () => {
    const localAppData = makeTempDir();
    const program = touch(path.join(localAppData, "Microsoft", "WinGet", "Links"), "claude.exe");

    const resolved = await aCli({
      claudeCommand: null,
      env: { PATH: "", USERPROFILE: makeTempDir(), LOCALAPPDATA: localAppData },
    }).resolveCommand();

    expect(resolved).toEqual([program]);
  });
});

describe("version helpers", () => {
  it("reads the version out of `claude --version`", () => {
    expect(parseClaudeVersion("2.1.99 (Claude Code)")).toBe("2.1.99");
    expect(parseClaudeVersion("Claude Code v10.20.30\n")).toBe("10.20.30");
    expect(parseClaudeVersion("no version here")).toBeNull();
  });

  it("compares versions number by number, not as text", () => {
    expect(isVersionAtLeast("2.1.0", "2.1.0")).toBe(true);
    expect(isVersionAtLeast("2.10.0", "2.9.0")).toBe(true);
    expect(isVersionAtLeast("2.0.99", "2.1.0")).toBe(false);
    expect(isVersionAtLeast("1.99.99", "2.1.0")).toBe(false);
    expect(isVersionAtLeast("3.0.0", "2.1.0")).toBe(true);
  });

  it("writes a command the way the person reads it, quoting parts that have spaces", () => {
    expect(describeCommand(["winget", "install", "Some Package"])).toBe('winget install "Some Package"');
    expect(describeCommand(["/bin/bash", "-c", "echo hi | cat"])).toBe("echo hi | cat");
  });
});
