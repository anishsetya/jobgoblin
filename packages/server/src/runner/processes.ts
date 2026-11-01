// The only file that starts, inspects or stops operating-system processes for runs (dependency rule, ARCHITECTURE.md
// section 3), so there is one place to audit what Jobgoblin runs on the person's machine. Nothing here uses a shell:
// every program is started with an argument list, so no text from a job posting or a setting can become a command.
// Spec: ARCHITECTURE.md section 10 (launch step 6, cancel, recovery).
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const COMMAND_OUTPUT_LIMIT_BYTES = 10 * 1024 * 1024;
// How much of a run's stderr is kept for the log line when a run fails. The rest is dropped.
const STDERR_TAIL_CHARACTERS = 4_000;

// ---------------------------------------------------------------------------------------------
// Short commands that run to completion: `claude --version`, `taskkill`, `tasklist`, `winget install`
// ---------------------------------------------------------------------------------------------

export type CommandResult = {
  started: boolean; // false when the program could not be started at all (not found, not allowed)
  exitCode: number | null; // null when it did not start or was stopped by the timeout
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type CommandOptions = { timeoutMs?: number; env?: NodeJS.ProcessEnv };

// Injectable, so tests of the code that uses commands never start a real process.
export type CommandRunner = (command: readonly string[], options?: CommandOptions) => Promise<CommandResult>;

export const runCommand: CommandRunner = (command, options = {}) => {
  const [program, ...args] = command;
  if (program === undefined) return Promise.reject(new Error("runCommand needs a program to start."));

  return new Promise((resolve) => {
    execFile(
      program,
      args,
      {
        timeout: options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
        env: options.env,
        windowsHide: true,
        maxBuffer: COMMAND_OUTPUT_LIMIT_BYTES,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        resolve({
          started: !failedToStart(error),
          exitCode: exitCodeOf(error),
          stdout,
          stderr,
          timedOut: error?.killed === true,
        });
      },
    );
  });
};

type ExecError = { code?: number | string | null } | null;

// execFile reports a non-zero exit as a number and a failure to start as a string such as "ENOENT".
const START_FAILURE_CODES = new Set(["ENOENT", "EACCES", "EPERM", "EINVAL", "ENOTDIR", "EMFILE", "ENFILE", "EAGAIN"]);

function failedToStart(error: ExecError): boolean {
  return error !== null && typeof error.code === "string" && START_FAILURE_CODES.has(error.code);
}

function exitCodeOf(error: ExecError): number | null {
  if (error === null) return 0;
  return typeof error.code === "number" ? error.code : null;
}

// ---------------------------------------------------------------------------------------------
// The run itself: one long-lived `claude -p` process
// ---------------------------------------------------------------------------------------------

export type SpawnRunOptions = {
  command: readonly string[]; // the program and any fixed leading arguments, such as ["node", "cli.mjs"]
  args: readonly string[];
  cwd: string; // the run directory
  env: NodeJS.ProcessEnv;
  stdinText: string; // the playbook (decision D6): it avoids Windows quoting and length limits
  onStdoutLine: (line: string) => void; // one call per line, in order, with the line ending removed
};

export type RunExit = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string; // the end of stderr, for the log; may hold anything Claude Code printed
  startError: string | null; // set when the program could not be started (for example not found)
};

export type SpawnedRun = {
  pid: number | null; // null when the process could not be started
  exit: Promise<RunExit>; // settles once the process has ended and every stdout line was delivered
};

export function spawnRun(options: SpawnRunOptions): SpawnedRun {
  const [program, ...leadingArguments] = options.command;
  if (program === undefined) throw new Error("spawnRun needs a command to start.");

  const child = spawn(program, [...leadingArguments, ...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false, // never: a shell would parse the arguments again
    windowsHide: true,
  });

  // Every listener is attached right now, before any output can arrive, so no line is ever missed.
  const stdoutLines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  stdoutLines.on("line", options.onStdoutLine);
  const allLinesDelivered = once(stdoutLines, "close");

  const stderrTail = keepTail(child.stderr, STDERR_TAIL_CHARACTERS);
  const exit = waitForExit(child, allLinesDelivered, stderrTail);

  // A run that ends before it has read the whole playbook is a result to report, not a crash of the server.
  child.stdin.on("error", () => undefined);
  child.stdin.end(options.stdinText);

  return { pid: child.pid ?? null, exit };
}

async function waitForExit(
  child: ReturnType<typeof spawn>,
  allLinesDelivered: Promise<unknown>,
  stderrTail: () => string,
): Promise<RunExit> {
  let startError: string | null = null;
  child.on("error", (error) => {
    // Only a process that never got a pid failed to start; other errors (a failed kill) do not end the run.
    if (child.pid === undefined) startError = error.message;
  });

  const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("close", (closeCode, closeSignal) => resolve({ code: closeCode, signal: closeSignal }));
  });
  await allLinesDelivered;

  return { exitCode: startError === null ? code : null, signal, stderrTail: stderrTail(), startError };
}

function keepTail(stream: NodeJS.ReadableStream, limit: number): () => string {
  let text = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    text = (text + chunk).slice(-limit);
  });
  return () => text;
}

// ---------------------------------------------------------------------------------------------
// Stopping a run, and recognising a leftover one
// ---------------------------------------------------------------------------------------------

// `taskkill /T` also stops the children of the process. Without /F it asks politely first, and a console
// program such as claude.exe usually refuses, which is why cancel tries this and then forces it after 5 s.
export function taskkillArguments(pid: number, force: boolean): string[] {
  return ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
}

// Returns true when the stop signal was delivered, false when the process was already gone (or, on Windows
// without `force`, refused to close). Callers cancel with force false, wait 5 seconds, then call again with true.
export async function killProcessTree(pid: number, options: { force: boolean }): Promise<boolean> {
  if (process.platform === "win32") {
    const result = await runCommand(["taskkill", ...taskkillArguments(pid, options.force)]);
    return result.exitCode === 0;
  }

  try {
    process.kill(pid, options.force ? "SIGKILL" : "SIGTERM");
    return true;
  } catch (error) {
    if (isErrorWithCode(error, "ESRCH")) return false; // already gone
    throw error;
  }
}

// Signal 0 delivers nothing; it only asks the operating system whether the process exists. It works on Windows too.
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrorWithCode(error, "EPERM"); // it exists, but belongs to someone we may not signal
  }
}

// The program name of a running process, such as "claude.exe", or null when there is no such process.
// A restart uses it to avoid stopping an unrelated program that was given a dead run's process id.
export async function processImageName(pid: number): Promise<string | null> {
  if (process.platform === "win32") {
    const result = await runCommand(["tasklist", "/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
    return parseTasklistImageName(result.stdout);
  }

  const result = await runCommand(["ps", "-p", String(pid), "-o", "comm="]);
  return parsePsImageName(result.stdout);
}

// `"claude.exe","1234","Console","1","85,000 K"`. When nothing matches, tasklist prints a sentence instead.
export function parseTasklistImageName(output: string): string | null {
  const firstLine = output.trim().split(/\r?\n/)[0] ?? "";
  const match = /^"([^"]+)"/.exec(firstLine);
  return match?.[1] ?? null;
}

export function parsePsImageName(output: string): string | null {
  const firstLine = output.trim().split(/\r?\n/)[0]?.trim() ?? "";
  return firstLine === "" ? null : firstLine;
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
