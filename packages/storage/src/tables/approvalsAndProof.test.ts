// Round trips for the tables that record the person's decisions: fits, approvals, submissions and answers.
import { afterEach, describe, expect, it } from "vitest";
import {
  aFit,
  aResumeVersion,
  aSubmission,
  anApplicationInDatabase,
  anApproval,
  aVersionId,
  openTestDatabase,
  removeTempDirs,
} from "../testSupport";
import { listAnswers, replaceAnswers } from "./answers";
import {
  getApproval,
  getLatestApproval,
  getLiveApproval,
  insertApproval,
  listLiveApprovals,
  markApprovalUsed,
  voidApproval,
} from "./approvals";
import { getFit, saveFit } from "./fits";
import { insertResumeVersionIfNew } from "./resumes";
import { getSubmissionForApplication, insertSubmission } from "./submissions";

afterEach(removeTempDirs);

function setUpApplication(db: ReturnType<typeof openTestDatabase>): void {
  anApplicationInDatabase(db);
  insertResumeVersionIfNew(db, aResumeVersion());
}

describe("fits", () => {
  it("saves a fit and reads it back, with the job id taken from the application", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db);
    const fit = aFit();

    saveFit(db, fit);

    expect(getFit(db, "app-1")).toEqual(fit);
    expect(getFit(db, "nothing")).toBeNull();
    db.close();
  });

  it("replaces the earlier fit when a job is scored again", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db);
    saveFit(db, aFit());

    saveFit(db, aFit({ score: 61, band: "stretch", gaps: [], reason: "Less Python than I thought." }));

    expect(getFit(db, "app-1")).toMatchObject({ score: 61, band: "stretch", gaps: [], reason: "Less Python than I thought." });
    db.close();
  });
});

describe("approvals", () => {
  it("saves an approval with its frozen data sheet and reads it back unchanged", () => {
    const db = openTestDatabase();
    setUpApplication(db);
    const approval = anApproval();

    insertApproval(db, approval);

    expect(getApproval(db, "approval-1")).toEqual(approval);
    expect(getLiveApproval(db, "app-1")).toEqual(approval);
    expect(getApproval(db, "nothing")).toBeNull();
    db.close();
  });

  it("allows only one live approval per application", () => {
    const db = openTestDatabase();
    setUpApplication(db);
    insertApproval(db, anApproval());

    const secondLiveApproval = () => insertApproval(db, anApproval({ id: "approval-2" }));

    expect(secondLiveApproval).toThrow(/UNIQUE/);
    db.close();
  });

  it("stops counting an approval once it is voided, and allows a new one", () => {
    const db = openTestDatabase();
    setUpApplication(db);
    insertApproval(db, anApproval());

    const voided = voidApproval(db, "approval-1", "2026-11-01T10:00:00.000Z");
    insertApproval(db, anApproval({ id: "approval-2", approvedAt: "2026-11-01T11:00:00.000Z" }));

    expect(voided).toBe(true);
    expect(getLiveApproval(db, "app-1")?.id).toBe("approval-2");
    expect(getApproval(db, "approval-1")?.voidedAt).toBe("2026-11-01T10:00:00.000Z");
    expect(listLiveApprovals(db).map((approval) => approval.id)).toEqual(["approval-2"]);
    db.close();
  });

  it("uses an approval up once, and never again", () => {
    const db = openTestDatabase();
    setUpApplication(db);
    insertApproval(db, anApproval());

    const usedFirst = markApprovalUsed(db, "approval-1", "2026-11-01T10:00:00.000Z");
    const usedAgain = markApprovalUsed(db, "approval-1", "2026-11-02T10:00:00.000Z");
    const voidedAfterUse = voidApproval(db, "approval-1", "2026-11-02T10:00:00.000Z");

    expect(usedFirst).toBe(true);
    expect(usedAgain).toBe(false);
    expect(voidedAfterUse).toBe(false);
    expect(getLiveApproval(db, "app-1")).toBeNull();
    expect(getLatestApproval(db, "app-1")?.usedAt).toBe("2026-11-01T10:00:00.000Z");
    db.close();
  });

  it("refuses an approval for a resume version that was never saved", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db);

    const approve = () => insertApproval(db, anApproval({ resumeVersion: aVersionId("9") }));

    expect(approve).toThrow(/FOREIGN KEY/);
    db.close();
  });
});

describe("submissions", () => {
  it("saves the proof of a submission and reads it back unchanged", () => {
    const db = openTestDatabase();
    setUpApplication(db);
    const submission = aSubmission();

    insertSubmission(db, submission);

    expect(getSubmissionForApplication(db, "app-1")).toEqual(submission);
    db.close();
  });

  it("returns null for an application that was not submitted", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db);

    expect(getSubmissionForApplication(db, "app-1")).toBeNull();
    db.close();
  });
});

describe("answers", () => {
  const firstSet = [
    { question: "Why Acme Cloud?", answer: "I like reliable systems. Reach me at {email}." },
    { question: "Notice period?", answer: "{noticePeriod}" },
  ];

  it("saves answers and lists them in the order they were saved, placeholders intact", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db);

    replaceAnswers(db, "app-1", firstSet, "2026-11-01T10:00:00.000Z");

    expect(listAnswers(db, "app-1")).toEqual(firstSet);
    db.close();
  });

  it("replaces the whole earlier set when answers are saved again", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db);
    replaceAnswers(db, "app-1", firstSet, "2026-11-01T10:00:00.000Z");

    replaceAnswers(db, "app-1", [{ question: "Salary?", answer: "{expectedBase}" }], "2026-11-02T10:00:00.000Z");

    expect(listAnswers(db, "app-1")).toEqual([{ question: "Salary?", answer: "{expectedBase}" }]);
    db.close();
  });

  it("keeps the last answer when a question appears twice", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db);

    replaceAnswers(db, "app-1", [{ question: "Q", answer: "first" }, { question: "Q", answer: "second" }], "2026-11-01T10:00:00.000Z");

    expect(listAnswers(db, "app-1")).toEqual([{ question: "Q", answer: "second" }]);
    db.close();
  });

  it("keeps the earlier answers when saving the new set fails", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db);
    replaceAnswers(db, "app-1", firstSet, "2026-11-01T10:00:00.000Z");

    const saveBadSet = () => replaceAnswers(db, "app-1", [{ question: "ok", answer: "" }], "2026-11-02T10:00:00.000Z");

    expect(saveBadSet).toThrow();
    expect(listAnswers(db, "app-1")).toEqual(firstSet);
    db.close();
  });
});
