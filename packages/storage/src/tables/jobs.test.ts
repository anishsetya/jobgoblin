import { afterEach, describe, expect, it } from "vitest";
import { aJob, openTestDatabase, removeTempDirs } from "../testSupport";
import {
  countUnseenJobs,
  getJob,
  insertJobIfNew,
  listJobsByDedupeKey,
  listUnseenJobs,
  markJobsSeen,
} from "./jobs";

afterEach(removeTempDirs);

describe("jobs", () => {
  it("saves a job and reads it back unchanged, including its screening questions", () => {
    const db = openTestDatabase();
    const job = aJob();

    const added = insertJobIfNew(db, job);

    expect(added).toBe(true);
    expect(getJob(db, job.jobId)).toEqual(job);
    db.close();
  });

  it("keeps the first copy when the same job id is saved again", () => {
    const db = openTestDatabase();
    insertJobIfNew(db, aJob({ title: "Backend Engineer" }));

    const addedAgain = insertJobIfNew(db, aJob({ title: "Changed title" }));

    expect(addedAgain).toBe(false);
    expect(getJob(db, aJob().jobId)?.title).toBe("Backend Engineer");
    db.close();
  });

  it("refuses a posting link that is not a web link", () => {
    const db = openTestDatabase();

    const save = () => insertJobIfNew(db, aJob({ url: "javascript:alert(1)" }));

    expect(save).toThrow();
    db.close();
  });

  it("returns null for a job that does not exist", () => {
    const db = openTestDatabase();

    expect(getJob(db, "greenhouse:nothing:1")).toBeNull();
    db.close();
  });

  it("finds the same role listed on another site by its dedupe key", () => {
    const db = openTestDatabase();
    insertJobIfNew(db, aJob({ jobId: "greenhouse:acmecloud:1" }));
    insertJobIfNew(db, aJob({ jobId: "hn:whoishiring:77", source: "hn" }));
    insertJobIfNew(db, aJob({ jobId: "lever:other:2", dedupeKey: "another role" }));

    const sameRole = listJobsByDedupeKey(db, aJob().dedupeKey);

    expect(sameRole.map((job) => job.jobId).sort()).toEqual(["greenhouse:acmecloud:1", "hn:whoishiring:77"]);
    db.close();
  });
});

describe("jobs a hunt run may see", () => {
  function saveThreeJobs(db: ReturnType<typeof openTestDatabase>): void {
    insertJobIfNew(db, aJob({ jobId: "greenhouse:a:1", foundAt: "2026-10-31T08:00:00.000Z" }));
    insertJobIfNew(db, aJob({ jobId: "greenhouse:a:2", foundAt: "2026-10-31T09:00:00.000Z" }));
    insertJobIfNew(db, aJob({ jobId: "greenhouse:a:3", foundAt: "2026-10-31T10:00:00.000Z", filteredReason: "Role to avoid: QA" }));
  }

  it("lists unseen jobs oldest first and leaves out jobs the code filter dropped", () => {
    const db = openTestDatabase();
    saveThreeJobs(db);

    const unseen = listUnseenJobs(db, 10);

    expect(unseen.map((job) => job.jobId)).toEqual(["greenhouse:a:1", "greenhouse:a:2"]);
    expect(countUnseenJobs(db)).toBe(2);
    db.close();
  });

  it("respects the limit while the count still reports every unseen job", () => {
    const db = openTestDatabase();
    saveThreeJobs(db);

    const firstPage = listUnseenJobs(db, 1);

    expect(firstPage).toHaveLength(1);
    expect(countUnseenJobs(db)).toBe(2);
    db.close();
  });

  it("stops listing a job once it is marked seen, and remembers when it was first seen", () => {
    const db = openTestDatabase();
    saveThreeJobs(db);

    const markedFirst = markJobsSeen(db, ["greenhouse:a:1", "unknown:job:9"], "2026-11-01T08:00:00.000Z");
    const markedAgain = markJobsSeen(db, ["greenhouse:a:1"], "2026-11-02T08:00:00.000Z");

    expect(markedFirst).toBe(1);
    expect(markedAgain).toBe(0);
    expect(getJob(db, "greenhouse:a:1")?.seenAt).toBe("2026-11-01T08:00:00.000Z");
    expect(listUnseenJobs(db, 10).map((job) => job.jobId)).toEqual(["greenhouse:a:2"]);
    db.close();
  });
});
