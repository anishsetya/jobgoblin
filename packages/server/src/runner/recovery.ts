// Crash recovery at server start. A run left `running` or `waiting` by a crash, a quit or a restart of the computer
// cannot still be in progress, so it is marked interrupted. If its Claude Code process is somehow still alive it
// is stopped first, but only after checking that the process really is Claude Code: a process id can be handed
// to an unrelated program after a restart, and stopping that would be a serious mistake.
// The process functions are passed in, so the decisions can be tested without starting a process.
// Spec: ARCHITECTURE.md section 10 (Recovery).
import path from "node:path";
import type { Run } from "@jobgoblin/schemas";
import { listRunsByStatus, updateRun } from "@jobgoblin/storage";
import type { Database } from "@jobgoblin/storage";

export const INTERRUPTED_MESSAGE = "This run was interrupted";

// What happened to one leftover run's process.
export type RecoveryDecision = "killed" | "not-running" | "other-program" | "no-process-recorded";

export type RecoveryReport = { runId: string; pid: number | null; decision: RecoveryDecision }[];

export type RecoveryInput = {
  db: Database;
  isAlive: (pid: number) => boolean;
  imageName: (pid: number) => Promise<string | null>;
  kill: (pid: number) => Promise<unknown>; // stops the process and its children, for good
  expectedImageNames: readonly string[]; // see imageNamesOfCommand
  now: () => Date;
};

// Runs that cannot still be going: the server that was running them is gone. Queued runs are left alone;
// they have not started and simply wait for the queue.
export function findLeftoverRuns(db: Database): Run[] {
  return listRunsByStatus(db, ["running", "waiting"]);
}

export async function recoverLeftoverRuns(input: RecoveryInput): Promise<RecoveryReport> {
  const report: RecoveryReport = [];

  for (const run of findLeftoverRuns(input.db)) {
    const decision = await stopLeftoverProcess(run, input);
    markInterrupted(run, input);
    report.push({ runId: run.id, pid: run.pid, decision });
  }
  return report;
}

async function stopLeftoverProcess(run: Run, input: RecoveryInput): Promise<RecoveryDecision> {
  if (run.pid === null) return "no-process-recorded";
  if (!input.isAlive(run.pid)) return "not-running";

  const image = await input.imageName(run.pid);
  if (image === null || !isExpectedImage(image, input.expectedImageNames)) return "other-program";

  await input.kill(run.pid);
  return "killed";
}

function markInterrupted(run: Run, input: RecoveryInput): void {
  updateRun(input.db, run.id, {
    status: "interrupted",
    outcomeMessage: INTERRUPTED_MESSAGE,
    endedAt: input.now().toISOString(),
    step: null,
    pid: null, // a process id left in the record could be handed to another program later
  });
}

// ---------------------------------------------------------------------------------------------
// Telling Claude Code's process from any other
// ---------------------------------------------------------------------------------------------

// The program names a leftover run's process may have: the first part of the Claude command. For the real
// Claude Code that is "claude"; for the fake claude (`node cli.mjs`) it is "node".
export function imageNamesOfCommand(claudeCommand: readonly string[] | null): string[] {
  const program = claudeCommand?.[0];
  return program === undefined ? [] : [normalizeImageName(program)];
}

function isExpectedImage(image: string, expectedImageNames: readonly string[]): boolean {
  return expectedImageNames.includes(normalizeImageName(image));
}

// "C:\Users\a\.local\bin\Claude.EXE", "/usr/bin/claude" and "claude.exe" are all "claude".
function normalizeImageName(image: string): string {
  const fileName = path.win32.basename(image);
  return fileName.toLowerCase().replace(/\.exe$/, "");
}
