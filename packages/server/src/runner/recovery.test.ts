import { getRun, insertRun } from "@jobgoblin/storage";
import type { Database } from "@jobgoblin/storage";
import { afterEach, describe, expect, it } from "vitest";
import { findLeftoverRuns, imageNamesOfCommand, INTERRUPTED_MESSAGE, recoverLeftoverRuns } from "./recovery";
import type { RecoveryInput } from "./recovery";
import { aRun, openTestDatabase, removeTempDirs } from "./testSupport";

afterEach(removeTempDirs);

const NOW = new Date("2026-10-31T15:00:00.000Z");

// Process functions that record what they were asked and answer from a table: no real process is touched.
function fakeProcesses(table: Record<number, string | null>) {
  const asked = { isAlive: [] as number[], imageName: [] as number[], killed: [] as number[] };
  const functions: Pick<RecoveryInput, "isAlive" | "imageName" | "kill"> = {
    isAlive: (pid) => {
      asked.isAlive.push(pid);
      return pid in table;
    },
    imageName: async (pid) => {
      asked.imageName.push(pid);
      return table[pid] ?? null;
    },
    kill: async (pid) => {
      asked.killed.push(pid);
    },
  };
  return { asked, functions };
}

function recover(db: Database, table: Record<number, string | null>, expectedImageNames = ["claude"]) {
  const processes = fakeProcesses(table);
  const report = recoverLeftoverRuns({ db, ...processes.functions, expectedImageNames, now: () => NOW });
  return { report, asked: processes.asked };
}

describe("findLeftoverRuns", () => {
  it("returns running runs only, not waiting, queued or finished ones", () => {
    const db = openTestDatabase();
    for (const [id, status] of [["a", "running"], ["b", "waiting"], ["c", "queued"], ["d", "done"], ["e", "failed"], ["f", "interrupted"]] as const) {
      insertRun(db, aRun({ id, status }), []);
    }

    expect(findLeftoverRuns(db).map((run) => run.id)).toEqual(["a"]);
  });
});

describe("recoverLeftoverRuns", () => {
  it("marks a running run interrupted, clears its pid and step, and records when", async () => {
    const db = openTestDatabase();
    insertRun(db, aRun({ id: "run-1", status: "running", pid: 4321 }), []);

    await recover(db, {}).report;

    expect(getRun(db, "run-1")).toMatchObject({
      status: "interrupted",
      outcomeMessage: INTERRUPTED_MESSAGE,
      pid: null,
      step: null,
      endedAt: NOW.toISOString(),
    });
  });

  it("stops a live process whose program is Claude Code, then marks the run interrupted", async () => {
    const db = openTestDatabase();
    insertRun(db, aRun({ id: "run-1", pid: 4321 }), []);

    const { report, asked } = recover(db, { 4321: "claude.exe" });

    expect(await report).toEqual([{ runId: "run-1", pid: 4321, decision: "killed" }]);
    expect(asked.killed).toEqual([4321]);
    expect(getRun(db, "run-1")?.status).toBe("interrupted");
  });

  it("leaves a live process alone when it is a different program that was given the dead run's process id", async () => {
    const db = openTestDatabase();
    insertRun(db, aRun({ id: "run-1", pid: 4321 }), []);

    const { report, asked } = recover(db, { 4321: "chrome.exe" });

    expect(await report).toEqual([{ runId: "run-1", pid: 4321, decision: "other-program" }]);
    expect(asked.killed).toEqual([]);
    expect(getRun(db, "run-1")?.status).toBe("interrupted");
  });

  it("leaves a live process alone when its program name cannot be read", async () => {
    const db = openTestDatabase();
    insertRun(db, aRun({ pid: 4321 }), []);

    const { report, asked } = recover(db, { 4321: null });

    expect(await report).toMatchObject([{ decision: "other-program" }]);
    expect(asked.killed).toEqual([]);
  });

  it("does not look at the program of a process that is no longer alive", async () => {
    const db = openTestDatabase();
    insertRun(db, aRun({ pid: 4321 }), []);

    const { report, asked } = recover(db, {});

    expect(await report).toMatchObject([{ decision: "not-running" }]);
    expect(asked.imageName).toEqual([]);
    expect(asked.killed).toEqual([]);
  });

  it("marks a run interrupted even when no process id was ever saved for it", async () => {
    const db = openTestDatabase();
    insertRun(db, aRun({ id: "run-1", pid: null }), []);

    const { report, asked } = recover(db, {});

    expect(await report).toEqual([{ runId: "run-1", pid: null, decision: "no-process-recorded" }]);
    expect(asked.isAlive).toEqual([]);
    expect(getRun(db, "run-1")?.status).toBe("interrupted");
  });

  it("leaves waiting, queued and finished runs as they are", async () => {
    const db = openTestDatabase();
    insertRun(db, aRun({ id: "waiting-run", status: "waiting", pid: null }), []);
    insertRun(db, aRun({ id: "queued-run", status: "queued", pid: null, startedAt: null }), []);
    insertRun(db, aRun({ id: "done-run", status: "done", pid: 22 }), []);

    await recover(db, {}).report;

    expect(getRun(db, "waiting-run")?.status).toBe("waiting");
    expect(getRun(db, "queued-run")?.status).toBe("queued");
    expect(getRun(db, "done-run")).toMatchObject({ status: "done", pid: 22 });
  });

  it("counts node as Claude Code when the Claude command is node running the fake claude", async () => {
    const db = openTestDatabase();
    insertRun(db, aRun({ pid: 4321 }), []);
    const expected = imageNamesOfCommand(["C:\\Program Files\\nodejs\\node.exe", "C:\\repo\\fixtures\\fake-claude\\dist\\cli.mjs"]);

    const { report, asked } = recover(db, { 4321: "node.exe" }, expected);

    expect(await report).toMatchObject([{ decision: "killed" }]);
    expect(asked.killed).toEqual([4321]);
  });

  it("stops nothing at all when no program is expected, such as when Claude Code is not installed", async () => {
    const db = openTestDatabase();
    insertRun(db, aRun({ pid: 4321 }), []);

    const { report, asked } = recover(db, { 4321: "claude.exe" }, []);

    expect(await report).toMatchObject([{ decision: "other-program" }]);
    expect(asked.killed).toEqual([]);
  });

  it("does nothing when there are no leftover runs", async () => {
    const db = openTestDatabase();

    const { report, asked } = recover(db, {});

    expect(await report).toEqual([]);
    expect(asked.isAlive).toEqual([]);
  });
});

describe("imageNamesOfCommand", () => {
  it("takes the first part of the command, ignoring folder, case and .exe", () => {
    expect(imageNamesOfCommand(["C:\\Users\\alex\\.local\\bin\\Claude.EXE"])).toEqual(["claude"]);
    expect(imageNamesOfCommand(["/usr/local/bin/claude"])).toEqual(["claude"]);
  });

  it("expects nothing when there is no command", () => {
    expect(imageNamesOfCommand(null)).toEqual([]);
    expect(imageNamesOfCommand([])).toEqual([]);
  });
});
