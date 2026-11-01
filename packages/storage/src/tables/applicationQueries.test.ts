import { afterEach, describe, expect, it } from "vitest";
import { aResumeVersion, anApplicationInDatabase, openTestDatabase, removeTempDirs } from "../testSupport";
import { listApplications, listFollowUpsDue, listTrackerRows } from "./applicationQueries";
import { insertResumeVersionIfNew } from "./resumes";

afterEach(removeTempDirs);

const TODAY = "2026-11-10";

// Five applications that between them exercise every filter.
function saveSomeApplications(db: ReturnType<typeof openTestDatabase>): void {
  anApplicationInDatabase(
    db,
    { id: "app-1", jobId: "greenhouse:acme:1", status: "Applied", band: "apply", fitScore: 88, followUpOn: "2026-11-07", updatedAt: "2026-11-01T00:00:00.000Z" },
    { location: "Remote - US", region: "US" },
  );
  anApplicationInDatabase(
    db,
    { id: "app-2", jobId: "lever:bright:2", company: "Brightpath", title: "Platform Engineer", status: "Tailored", band: "stretch", fitScore: 68, updatedAt: "2026-11-02T00:00:00.000Z" },
    { location: "New York, NY", region: "US" },
  );
  anApplicationInDatabase(
    db,
    { id: "app-3", jobId: "ashby:copper:3", company: "Copperleaf AI", title: "100% Remote Engineer", status: "Rejected", band: "apply", followUpOn: "2026-11-01", updatedAt: "2026-11-03T00:00:00.000Z" },
    { location: "San Francisco, CA", region: "US" },
  );
  anApplicationInDatabase(
    db,
    { id: "app-4", jobId: "greenhouse:acme:4", status: "Applied", band: "apply", followUpOn: "2026-11-10", updatedAt: "2026-11-04T00:00:00.000Z" },
    { location: "Bengaluru", region: "IN" },
  );
  anApplicationInDatabase(db, { id: "app-5", jobId: "greenhouse:acme:5", status: "Found", updatedAt: "2026-11-05T00:00:00.000Z" });
}

describe("listApplications (the Pipeline list)", () => {
  it("lists every application, newest change first, with the job's location and region", () => {
    const db = openTestDatabase();
    saveSomeApplications(db);

    const rows = listApplications(db, {}, TODAY);

    expect(rows.map((row) => row.id)).toEqual(["app-5", "app-4", "app-3", "app-2", "app-1"]);
    expect(rows.find((row) => row.id === "app-4")).toMatchObject({ location: "Bengaluru", region: "IN" });
    db.close();
  });

  it("filters by status and by band", () => {
    const db = openTestDatabase();
    saveSomeApplications(db);

    const applied = listApplications(db, { status: ["Applied"] }, TODAY);
    const stretch = listApplications(db, { band: ["stretch"] }, TODAY);

    expect(applied.map((row) => row.id)).toEqual(["app-4", "app-1"]);
    expect(stretch.map((row) => row.id)).toEqual(["app-2"]);
    db.close();
  });

  it("searches company, title and location without caring about capital letters", () => {
    const db = openTestDatabase();
    saveSomeApplications(db);

    const byCompany = listApplications(db, { search: "brightpath" }, TODAY);
    const byLocation = listApplications(db, { search: "bengaluru" }, TODAY);

    expect(byCompany.map((row) => row.id)).toEqual(["app-2"]);
    expect(byLocation.map((row) => row.id)).toEqual(["app-4"]);
    db.close();
  });

  it("treats % in a search as a plain character", () => {
    const db = openTestDatabase();
    saveSomeApplications(db);

    const percentOnly = listApplications(db, { search: "%" }, TODAY);
    const hundredPercent = listApplications(db, { search: "100%" }, TODAY);

    expect(percentOnly.map((row) => row.id)).toEqual(["app-3"]);
    expect(hundredPercent.map((row) => row.id)).toEqual(["app-3"]);
    db.close();
  });

  it("marks a follow-up overdue only after its day has passed and only while the application is open", () => {
    const db = openTestDatabase();
    saveSomeApplications(db);

    const rows = listApplications(db, {}, TODAY);
    const overdueById = Object.fromEntries(rows.map((row) => [row.id, row.overdue]));

    expect(overdueById["app-1"]).toBe(true); // follow up on 7 Nov, today is 10 Nov
    expect(overdueById["app-3"]).toBe(false); // the day passed, but it was rejected
    expect(overdueById["app-4"]).toBe(false); // due today is due, not overdue
    expect(overdueById["app-5"]).toBe(false); // no follow-up day
    db.close();
  });

  it("can show only the overdue ones", () => {
    const db = openTestDatabase();
    saveSomeApplications(db);

    const overdue = listApplications(db, { overdueOnly: true }, TODAY);

    expect(overdue.map((row) => row.id)).toEqual(["app-1"]);
    db.close();
  });
});

describe("listFollowUpsDue", () => {
  it("lists open applications whose follow-up day is today or earlier, soonest first", () => {
    const db = openTestDatabase();
    saveSomeApplications(db);

    const due = listFollowUpsDue(db, TODAY);

    expect(due.map((application) => application.id)).toEqual(["app-1", "app-4"]);
    db.close();
  });
});

describe("listTrackerRows", () => {
  it("gives one row per application with the posting link and the short resume id", () => {
    const db = openTestDatabase();
    const version = aResumeVersion();
    insertResumeVersionIfNew(db, version);
    anApplicationInDatabase(db, {
      id: "app-1",
      status: "Applied",
      fitScore: 82,
      band: "apply",
      resumeVersion: version.versionId,
      appliedAt: "2026-11-01T09:00:00.000Z",
      followUpOn: "2026-11-08",
      folder: "Applications/2026-11-01 Acme Cloud - Backend Engineer",
    });

    const rows = listTrackerRows(db);

    expect(rows).toEqual([
      {
        company: "Acme Cloud",
        role: "Backend Engineer",
        status: "Applied",
        fitScore: 82,
        band: "apply",
        resumeShortId: "r-aaaaaaaa",
        appliedAt: "2026-11-01T09:00:00.000Z",
        followUpOn: "2026-11-08",
        postingUrl: "https://boards.example.com/acmecloud/jobs/4012345",
        folder: "Applications/2026-11-01 Acme Cloud - Backend Engineer",
        updatedAt: "2026-10-31T14:05:00.000Z",
      },
    ]);
    db.close();
  });
});
