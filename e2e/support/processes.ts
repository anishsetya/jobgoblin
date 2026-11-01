// Looking at the computer's processes, for the one story about what a crash leaves behind:
// "no Claude process is left running". Only the tests use this; the app has its own check in runner/recovery.ts.
import { execFileSync } from "node:child_process";
import { FAKE_CLAUDE_CLI } from "./server";

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 only asks "does it exist?"
    return true;
  } catch {
    return false;
  }
}

// Process ids of every running copy of the fake claude (a node process whose command line names its cli.mjs).
export function runningFakeClaudeProcesses(): number[] {
  const output =
    process.platform === "win32"
      ? execFileSync(
          "powershell",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*fake-claude*cli.mjs*' } | ForEach-Object { $_.ProcessId }`,
          ],
          { encoding: "utf8" },
        )
      : pgrep(FAKE_CLAUDE_CLI);
  return output
    .split(/\s+/)
    .filter((text) => /^\d+$/.test(text))
    .map(Number);
}

function pgrep(pattern: string): string {
  try {
    return execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" });
  } catch {
    return ""; // pgrep exits 1 when nothing matches
  }
}
