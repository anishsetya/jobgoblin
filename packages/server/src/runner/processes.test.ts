import { describe, expect, it } from "vitest";
import {
  isProcessAlive,
  killProcessTree,
  parsePsImageName,
  parseTasklistImageName,
  processImageName,
  runCommand,
  spawnRun,
  taskkillArguments,
} from "./processes";

const NODE = process.execPath;

// A small node program, so these tests need nothing installed. Scripts use single quotes only, so no
// operating system has to unpick nested double quotes.
function nodeProgram(script: string): { command: string[]; args: string[] } {
  return { command: [NODE], args: ["-e", script] };
}

function startRun(script: string, stdinText = "") {
  const lines: string[] = [];
  const { command, args } = nodeProgram(script);
  const run = spawnRun({ command, args, cwd: process.cwd(), env: process.env, stdinText, onStdoutLine: (line) => lines.push(line) });
  return { run, lines };
}

describe("spawnRun", () => {
  it("delivers stdout line by line, with line endings removed and a last line that has none", async () => {
    const { run, lines } = startRun("process.stdout.write('first\\r\\nsecond\\nlast')");

    const exit = await run.exit;

    expect(lines).toEqual(["first", "second", "last"]);
    expect(exit).toMatchObject({ exitCode: 0, startError: null });
    expect(run.pid).toBeGreaterThan(0);
  });

  it("writes the playbook to the program's stdin", async () => {
    const script = "let t='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>t+=c);process.stdin.on('end',()=>console.log('got:'+t.trim()))";
    const { run, lines } = startRun(script, "# Playbook\nDo the work.\n");

    await run.exit;

    expect(lines).toEqual(["got:# Playbook", "Do the work."]);
  });

  it("reports the exit code and the end of stderr", async () => {
    const { run } = startRun("console.error('something went wrong');process.exit(3)");

    const exit = await run.exit;

    expect(exit.exitCode).toBe(3);
    expect(exit.stderrTail).toContain("something went wrong");
  });

  it("keeps only the end of a very long stderr", async () => {
    const { run } = startRun("process.stderr.write('a'.repeat(20000)+'END')");

    const exit = await run.exit;

    expect(exit.stderrTail.length).toBeLessThanOrEqual(4000);
    expect(exit.stderrTail.endsWith("END")).toBe(true);
  });

  it("settles with a start error, not a crash, when the program does not exist", async () => {
    const run = spawnRun({
      command: ["jobgoblin-no-such-program-xyz"],
      args: [],
      cwd: process.cwd(),
      env: process.env,
      stdinText: "playbook",
      onStdoutLine: () => undefined,
    });

    const exit = await run.exit;

    expect(run.pid).toBeNull();
    expect(exit.exitCode).toBeNull();
    expect(exit.startError).toMatch(/ENOENT/);
  });

  it("does not give a shell the arguments: shell characters in an argument stay plain text", async () => {
    const { command } = nodeProgram("");
    const lines: string[] = [];
    const run = spawnRun({
      command,
      args: ["-e", "console.log(process.argv[1])", "a & b | c"],
      cwd: process.cwd(),
      env: process.env,
      stdinText: "",
      onStdoutLine: (line) => lines.push(line),
    });

    await run.exit;

    expect(lines).toEqual(["a & b | c"]);
  });
});

describe("stopping and finding a process", () => {
  it("stops a running process with killProcessTree and then sees it is gone", async () => {
    const { run, lines } = startRun("console.log('ready');setInterval(()=>{},1000)");
    await waitUntil(() => lines.includes("ready"));
    const pid = run.pid ?? -1;
    expect(isProcessAlive(pid)).toBe(true);

    const stopped = await killProcessTree(pid, { force: true });
    const exit = await run.exit;

    expect(stopped).toBe(true);
    expect(exit.exitCode === 0).toBe(false);
    expect(isProcessAlive(pid)).toBe(false);
  });

  it("says a process that is already gone could not be stopped", async () => {
    const { run } = startRun("process.exit(0)");
    await run.exit;

    expect(await killProcessTree(run.pid ?? -1, { force: true })).toBe(false);
  });

  it("knows this very process is alive, and refuses nonsense process ids", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-5)).toBe(false);
    expect(isProcessAlive(1.5)).toBe(false);
  });

  it("names the program of a running process", async () => {
    const image = await processImageName(process.pid);

    expect(image).toMatch(/node/i);
  });

  it("returns null for a process that does not exist", async () => {
    const { run } = startRun("process.exit(0)");
    await run.exit;

    expect(await processImageName(run.pid ?? -1)).toBeNull();
  });
});

describe("the command parsers", () => {
  it("builds taskkill arguments that stop the whole tree, forcing only when asked", () => {
    expect(taskkillArguments(4321, false)).toEqual(["/PID", "4321", "/T"]);
    expect(taskkillArguments(4321, true)).toEqual(["/PID", "4321", "/T", "/F"]);
  });

  it("reads the image name from tasklist's CSV line", () => {
    expect(parseTasklistImageName('"claude.exe","1234","Console","1","85,000 K"\r\n')).toBe("claude.exe");
  });

  it("reads no image name when tasklist finds nothing", () => {
    expect(parseTasklistImageName("INFO: No tasks are running which match the specified criteria.\r\n")).toBeNull();
    expect(parseTasklistImageName("")).toBeNull();
  });

  it("reads the image name from ps, or none when ps prints nothing", () => {
    expect(parsePsImageName("claude\n")).toBe("claude");
    expect(parsePsImageName("/Users/alex/.local/bin/claude\n")).toBe("/Users/alex/.local/bin/claude");
    expect(parsePsImageName("")).toBeNull();
  });
});

describe("runCommand", () => {
  it("returns the output and exit code of a short command", async () => {
    const { command, args } = nodeProgram("console.log('hello');process.exit(2)");

    const result = await runCommand([...command, ...args]);

    expect(result).toMatchObject({ started: true, exitCode: 2, stdout: "hello\n", timedOut: false });
  });

  it("says the program did not start when it does not exist", async () => {
    const result = await runCommand(["jobgoblin-no-such-program-xyz", "--version"]);

    expect(result).toMatchObject({ started: false, exitCode: null });
  });

  it("stops a command that runs too long", async () => {
    const { command, args } = nodeProgram("setTimeout(()=>{},10000)");

    const result = await runCommand([...command, ...args], { timeoutMs: 300 });

    expect(result).toMatchObject({ started: true, timedOut: true, exitCode: null });
  });

  it("passes the environment it is given and nothing else", async () => {
    const { command, args } = nodeProgram("console.log(process.env.ONLY_THIS+','+process.env.ANTHROPIC_API_KEY)");

    const result = await runCommand([...command, ...args], { env: { ONLY_THIS: "yes", SystemRoot: process.env.SystemRoot } });

    expect(result.stdout.trim()).toBe("yes,undefined");
  });
});

async function waitUntil(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("The condition was not met in time.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
