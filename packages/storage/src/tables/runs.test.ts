import { afterEach, describe, expect, it } from "vitest";
import { aRun, anApplicationInDatabase, openTestDatabase, removeTempDirs } from "../testSupport";
import { insertQuestion, answerQuestion } from "./questions";
import {
  addRunTask,
  countRunTasksByState,
  findActiveRunForApplication,
  findOldestQueuedRun,
  getNextPendingRunTask,
  getRun,
  insertRun,
  listRecentRuns,
  listRunTasks,
  listRunTasksByState,
  listRunsByStatus,
  setRunTaskState,
  updateRun,
} from "./runs";

afterEach(removeTempDirs);

function saveTwoApplications(db: ReturnType<typeof openTestDatabase>): void {
  anApplicationInDatabase(db, { id: "app-1", jobId: "greenhouse:acme:1" });
  anApplicationInDatabase(db, { id: "app-2", jobId: "greenhouse:acme:2" });
}

describe("runs", () => {
  it("saves a run and reads it back unchanged", () => {
    const db = openTestDatabase();
    const run = aRun({ kind: "paste", model: "haiku", input: { jobId: "pasted:gridline:1" } });

    insertRun(db, run, []);

    expect(getRun(db, "run-1")).toEqual(run);
    expect(getRun(db, "nothing")).toBeNull();
    db.close();
  });

  it("saves the run and one pending task per application together", () => {
    const db = openTestDatabase();
    saveTwoApplications(db);

    insertRun(db, aRun(), ["app-1", "app-2"]);

    expect(listRunTasks(db, "run-1")).toEqual([
      { runId: "run-1", applicationId: "app-1", state: "pending", note: null },
      { runId: "run-1", applicationId: "app-2", state: "pending", note: null },
    ]);
    db.close();
  });

  it("saves no run at all when one of its applications does not exist", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db, { id: "app-1" });

    const insertWithMissingApplication = () => insertRun(db, aRun(), ["app-1", "no-such-application"]);

    expect(insertWithMissingApplication).toThrow(/FOREIGN KEY/);
    expect(getRun(db, "run-1")).toBeNull();
    db.close();
  });

  it("lists runs by status in the order they were queued, and recent runs newest first", () => {
    const db = openTestDatabase();
    insertRun(db, aRun({ id: "run-a", queuedAt: "2026-10-31T10:00:00.000Z" }), []);
    insertRun(db, aRun({ id: "run-b", queuedAt: "2026-10-31T11:00:00.000Z" }), []);
    insertRun(db, aRun({ id: "run-c", queuedAt: "2026-10-31T12:00:00.000Z", status: "running" }), []);

    expect(listRunsByStatus(db, ["queued"]).map((run) => run.id)).toEqual(["run-a", "run-b"]);
    expect(listRunsByStatus(db, ["queued", "running"]).map((run) => run.id)).toEqual(["run-a", "run-b", "run-c"]);
    expect(listRunsByStatus(db, [])).toEqual([]);
    expect(listRecentRuns(db, 2).map((run) => run.id)).toEqual(["run-c", "run-b"]);
    db.close();
  });

  it("finds the oldest queued run of a kind", () => {
    const db = openTestDatabase();
    insertRun(db, aRun({ id: "run-a", kind: "answers", queuedAt: "2026-10-31T10:00:00.000Z" }), []);
    insertRun(db, aRun({ id: "run-b", kind: "tailor", queuedAt: "2026-10-31T11:00:00.000Z" }), []);
    insertRun(db, aRun({ id: "run-c", kind: "tailor", queuedAt: "2026-10-31T12:00:00.000Z" }), []);

    expect(findOldestQueuedRun(db, "tailor")?.id).toBe("run-b");
    expect(findOldestQueuedRun(db, "ask")).toBeNull();
    db.close();
  });

  it("changes the given fields of a run and leaves the rest", () => {
    const db = openTestDatabase();
    insertRun(db, aRun({ step: "Checking job boards" }), []);

    const updated = updateRun(db, "run-1", {
      status: "running",
      pid: 4321,
      sessionId: "session-abc",
      startedAt: "2026-10-31T14:06:00.000Z",
      step: null,
    });

    expect(updated).toMatchObject({ status: "running", pid: 4321, sessionId: "session-abc", step: null, kind: "tailor" });
    expect(updateRun(db, "nothing", { status: "done" })).toBeNull();
    db.close();
  });

  it("refuses a run status that is not one of the 8", () => {
    const db = openTestDatabase();
    insertRun(db, aRun(), []);

    const setBadStatus = () => db.sqlite.prepare("UPDATE runs SET status = 'paused'").run();

    expect(setBadStatus).toThrow(/CHECK/);
    db.close();
  });
});

describe("run tasks", () => {
  it("records how a task ended and lists tasks by state", () => {
    const db = openTestDatabase();
    saveTwoApplications(db);
    insertRun(db, aRun(), ["app-1", "app-2"]);

    const changed = setRunTaskState(db, { runId: "run-1", applicationId: "app-1", state: "failed", note: "Over the page limit" });
    const missing = setRunTaskState(db, { runId: "run-1", applicationId: "app-9", state: "done" });

    expect(changed).toBe(true);
    expect(missing).toBe(false);
    expect(listRunTasksByState(db, "run-1", "failed")).toEqual([
      { runId: "run-1", applicationId: "app-1", state: "failed", note: "Over the page limit" },
    ]);
    expect(countRunTasksByState(db, "run-1")).toEqual({ pending: 1, done: 0, failed: 1, waiting: 0 });
    db.close();
  });

  it("adds a task to a run once, even if asked twice", () => {
    const db = openTestDatabase();
    saveTwoApplications(db);
    insertRun(db, aRun(), ["app-1"]);

    addRunTask(db, "run-1", "app-2");
    addRunTask(db, "run-1", "app-2");

    expect(listRunTasks(db, "run-1")).toHaveLength(2);
    db.close();
  });

  it("offers the next pending task, skipping an application that has an unanswered question", () => {
    const db = openTestDatabase();
    saveTwoApplications(db);
    insertRun(db, aRun(), ["app-1", "app-2"]);
    insertQuestion(db, {
      id: "question-1", runId: "run-1", runKind: "tailor", applicationId: "app-1",
      text: "Which city do you prefer?", answer: null, askedAt: "2026-10-31T14:06:00.000Z", answeredAt: null,
    });

    const whileQuestionIsOpen = getNextPendingRunTask(db, "run-1");
    answerQuestion(db, { id: "question-1", answer: "Austin", answeredAt: "2026-10-31T15:00:00.000Z" });
    const afterAnswer = getNextPendingRunTask(db, "run-1");

    expect(whileQuestionIsOpen?.applicationId).toBe("app-2");
    expect(afterAnswer?.applicationId).toBe("app-1");
    db.close();
  });

  it("offers nothing when every task is done", () => {
    const db = openTestDatabase();
    saveTwoApplications(db);
    insertRun(db, aRun(), ["app-1"]);
    setRunTaskState(db, { runId: "run-1", applicationId: "app-1", state: "done" });

    expect(getNextPendingRunTask(db, "run-1")).toBeNull();
    db.close();
  });
});

describe("findActiveRunForApplication", () => {
  it("finds a queued or running run that still has work for the application", () => {
    const db = openTestDatabase();
    saveTwoApplications(db);
    insertRun(db, aRun({ id: "run-1", status: "running" }), ["app-1"]);

    expect(findActiveRunForApplication(db, "app-1")?.id).toBe("run-1");
    expect(findActiveRunForApplication(db, "app-2")).toBeNull();
    db.close();
  });

  it("lets go of an application once its task is done, though the run is still going", () => {
    const db = openTestDatabase();
    saveTwoApplications(db);
    insertRun(db, aRun({ status: "running" }), ["app-1", "app-2"]);

    setRunTaskState(db, { runId: "run-1", applicationId: "app-1", state: "done" });

    expect(findActiveRunForApplication(db, "app-1")).toBeNull();
    expect(findActiveRunForApplication(db, "app-2")?.id).toBe("run-1");
    db.close();
  });

  it("ignores runs that have ended", () => {
    const db = openTestDatabase();
    saveTwoApplications(db);
    insertRun(db, aRun({ status: "failed" }), ["app-1"]);

    expect(findActiveRunForApplication(db, "app-1")).toBeNull();
    db.close();
  });

  it("keeps a waiting task attached to its run, because the person's answer will resume it", () => {
    const db = openTestDatabase();
    saveTwoApplications(db);
    insertRun(db, aRun({ status: "waiting" }), ["app-1"]);
    setRunTaskState(db, { runId: "run-1", applicationId: "app-1", state: "waiting" });

    expect(findActiveRunForApplication(db, "app-1")?.id).toBe("run-1");
    db.close();
  });
});
