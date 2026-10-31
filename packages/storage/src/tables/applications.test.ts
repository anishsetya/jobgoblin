import { ApplicationStatus } from "@jobgoblin/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { StaleStatusError } from "../errors";
import { anApplication, anApplicationInDatabase, openTestDatabase, removeTempDirs } from "../testSupport";
import {
  countApplicationsByStatus,
  countApplicationsCreatedSince,
  getApplication,
  getApplicationByJobId,
  listApplicationsByCompany,
  listApplicationsByStatus,
  listLimitCandidates,
  updateApplicationFields,
  updateApplicationStatus,
} from "./applications";
import { listHistoryEvents } from "./historyEvents";

afterEach(removeTempDirs);

const LATER = "2026-11-01T10:00:00.000Z";

describe("applications", () => {
  it("saves an application and reads it back unchanged", () => {
    const db = openTestDatabase();
    const application = anApplicationInDatabase(db, { fitScore: 82, band: "apply", status: "Scored" });

    expect(getApplication(db, application.id)).toEqual(application);
    db.close();
  });

  it("returns null for an application that does not exist", () => {
    const db = openTestDatabase();

    expect(getApplication(db, "nothing")).toBeNull();
    db.close();
  });

  it("refuses an application for a job that was never saved", () => {
    const db = openTestDatabase();

    const insertWithoutJob = () => db.sqlite.prepare(
      "INSERT INTO applications (id, job_id, company, title, status, submit_mode, created_at, updated_at) VALUES ('a', 'no:such:job', 'c', 't', 'Found', 'manual', 'x', 'x')",
    ).run();

    expect(insertWithoutJob).toThrow(/FOREIGN KEY/);
    db.close();
  });

  it("refuses a status that is not one of the 20", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db);

    const setBadStatus = () => db.sqlite.prepare("UPDATE applications SET status = 'Almost applied'").run();

    expect(setBadStatus).toThrow(/CHECK/);
    db.close();
  });

  it("finds the newest application for a job", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db, { id: "app-old", createdAt: "2026-07-01T00:00:00.000Z" });
    anApplicationInDatabase(db, { id: "app-new", createdAt: "2026-10-31T00:00:00.000Z" });

    expect(getApplicationByJobId(db, anApplication().jobId)?.id).toBe("app-new");
    expect(getApplicationByJobId(db, "no:such:job")).toBeNull();
    db.close();
  });

  it("lists applications by status and by company, ignoring capital letters in the company", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db, { id: "app-1", jobId: "greenhouse:acme:1", status: "Tailored" });
    anApplicationInDatabase(db, { id: "app-2", jobId: "greenhouse:acme:2", status: "Scored", createdAt: LATER });
    anApplicationInDatabase(db, { id: "app-3", jobId: "lever:other:3", company: "Other Co", status: "Scored", createdAt: LATER });

    expect(listApplicationsByStatus(db, ["Scored"]).map((a) => a.id)).toEqual(["app-2", "app-3"]);
    expect(listApplicationsByStatus(db, [])).toEqual([]);
    expect(listApplicationsByCompany(db, "ACME CLOUD").map((a) => a.id)).toEqual(["app-1", "app-2"]);
    db.close();
  });

  it("counts applications for every status, including those with none", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db, { id: "app-1", jobId: "greenhouse:acme:1", status: "Applied" });
    anApplicationInDatabase(db, { id: "app-2", jobId: "greenhouse:acme:2", status: "Applied" });

    const counts = countApplicationsByStatus(db);

    expect(Object.keys(counts)).toHaveLength(ApplicationStatus.options.length);
    expect(counts.Applied).toBe(2);
    expect(counts.Offer).toBe(0);
    db.close();
  });

  it("counts the applications created since a time", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db, { id: "app-1", jobId: "greenhouse:acme:1", createdAt: "2026-10-30T00:00:00.000Z" });
    anApplicationInDatabase(db, { id: "app-2", jobId: "greenhouse:acme:2", createdAt: LATER });

    expect(countApplicationsCreatedSince(db, "2026-10-31T00:00:00.000Z")).toBe(1);
    db.close();
  });

  it("gives the limit check the other applications at the company and for the same role", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db, { id: "app-1", jobId: "greenhouse:acme:1", status: "Applied", appliedAt: LATER });
    anApplicationInDatabase(
      db,
      { id: "app-2", jobId: "hn:whoishiring:5", company: "Reposted Inc" },
      { dedupeKey: "acme cloud|backend engineer|remote" },
    );
    anApplicationInDatabase(db, { id: "app-3", jobId: "lever:far:9", company: "Far Away Ltd" }, { dedupeKey: "something else" });

    const candidates = listLimitCandidates(db, { company: "acme cloud", dedupeKey: "acme cloud|backend engineer|remote" });

    expect(candidates.map((candidate) => candidate.id).sort()).toEqual(["app-1", "app-2"]);
    expect(candidates.find((candidate) => candidate.id === "app-1")).toMatchObject({ status: "Applied", appliedAt: LATER });
    db.close();
  });
});

describe("updateApplicationFields", () => {
  it("sets the given fields, clears a field set to null, and stamps the time", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db, { tailorError: "Couldn't tailor this one: cap" });

    const updated = updateApplicationFields(
      db,
      "app-1",
      { followUpOn: "2026-11-07", folder: "Applications/2026-10-31 Acme Cloud - Backend Engineer", tailorError: null },
      LATER,
    );

    expect(updated).toMatchObject({
      followUpOn: "2026-11-07",
      folder: "Applications/2026-10-31 Acme Cloud - Backend Engineer",
      tailorError: null,
      updatedAt: LATER,
      status: "Found",
    });
    db.close();
  });

  it("only stamps the time when no field is given", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db, { fitScore: 70 });

    const updated = updateApplicationFields(db, "app-1", {}, LATER);

    expect(updated).toMatchObject({ fitScore: 70, updatedAt: LATER });
    db.close();
  });

  it("refuses a value the schema does not allow", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db);

    const setBadDay = () => updateApplicationFields(db, "app-1", { followUpOn: "next Tuesday" }, LATER);

    expect(setBadDay).toThrow();
    db.close();
  });
});

describe("updateApplicationStatus", () => {
  it("moves the application and writes the history event in the same step", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db, { status: "Awaiting approval" });

    updateApplicationStatus(db, {
      applicationId: "app-1",
      from: "Awaiting approval",
      to: "Approved",
      actor: "person",
      type: "approved",
      detail: "Approved from the Review screen",
      at: LATER,
    });

    expect(getApplication(db, "app-1")).toMatchObject({ status: "Approved", updatedAt: LATER });
    expect(listHistoryEvents(db, "app-1")).toMatchObject([
      { actor: "person", type: "approved", from: "Awaiting approval", to: "Approved", detail: "Approved from the Review screen", ts: LATER },
    ]);
    db.close();
  });

  it("refuses a move from a status the application is no longer in, and changes nothing", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db, { status: "Skipped" });

    const staleMove = () =>
      updateApplicationStatus(db, {
        applicationId: "app-1",
        from: "Awaiting approval",
        to: "Approved",
        actor: "person",
        type: "approved",
        at: LATER,
      });

    expect(staleMove).toThrow(StaleStatusError);
    expect(staleMove).toThrow(/"Skipped", not "Awaiting approval"/);
    expect(getApplication(db, "app-1")?.status).toBe("Skipped");
    expect(listHistoryEvents(db, "app-1")).toEqual([]);
    db.close();
  });

  it("says the application is missing when there is no such application", () => {
    const db = openTestDatabase();

    const move = () =>
      updateApplicationStatus(db, { applicationId: "nothing", from: "Found", to: "Scored", actor: "run", type: "status-changed", at: LATER });

    expect(move).toThrow(/missing/);
    db.close();
  });

  it("is undone together with the caller's other changes when the caller's transaction fails", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db, { status: "Found" });

    const approveThenFail = () =>
      db.transaction(() => {
        updateApplicationStatus(db, { applicationId: "app-1", from: "Found", to: "Scored", actor: "run", type: "status-changed", at: LATER });
        throw new Error("the rest of the action failed");
      });

    expect(approveThenFail).toThrow("the rest of the action failed");
    expect(getApplication(db, "app-1")?.status).toBe("Found");
    expect(listHistoryEvents(db, "app-1")).toEqual([]);
    db.close();
  });
});
