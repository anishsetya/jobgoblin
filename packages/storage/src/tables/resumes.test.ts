import { afterEach, describe, expect, it } from "vitest";
import { ApprovedFileConflictError } from "../errors";
import { sha256OfBytes } from "../hash";
import {
  aResumeVersion,
  anApplicationInDatabase,
  aVersionId,
  PDF_BYTES,
  PDF_SHA256,
  openTestDatabase,
  removeTempDirs,
  TEST_TIMESTAMP,
} from "../testSupport";
import {
  findApprovedPdfForVersion,
  getApplicationResume,
  getApprovedPdf,
  getResumeVersion,
  getResumeVersionByShortId,
  insertApplicationResumeIfNew,
  insertResumeVersionIfNew,
  listApplicationResumes,
  markResumeApproved,
} from "./resumes";

afterEach(removeTempDirs);

function setUpDraft(db: ReturnType<typeof openTestDatabase>): void {
  anApplicationInDatabase(db);
  insertResumeVersionIfNew(db, aResumeVersion());
  insertApplicationResumeIfNew(db, { applicationId: "app-1", versionId: aVersionId("a"), createdAt: TEST_TIMESTAMP });
}

const approveWith = (bytes: Uint8Array) => ({
  applicationId: "app-1",
  versionId: aVersionId("a"),
  pdfSha256: sha256OfBytes(bytes),
  pdfBytes: bytes,
});

describe("resume versions", () => {
  it("saves a version and reads it back unchanged, by id and by short id", () => {
    const db = openTestDatabase();
    const version = aResumeVersion();

    const added = insertResumeVersionIfNew(db, version);

    expect(added).toBe(true);
    expect(getResumeVersion(db, version.versionId)).toEqual(version);
    expect(getResumeVersionByShortId(db, "r-aaaaaaaa")).toEqual(version);
    expect(getResumeVersion(db, aVersionId("f"))).toBeNull();
    db.close();
  });

  it("keeps the first copy when the same version is saved again", () => {
    const db = openTestDatabase();
    insertResumeVersionIfNew(db, aResumeVersion());

    const addedAgain = insertResumeVersionIfNew(db, aResumeVersion());

    expect(addedAgain).toBe(false);
    db.close();
  });

  it("refuses a different version that would take the same short id", () => {
    const db = openTestDatabase();
    insertResumeVersionIfNew(db, aResumeVersion());

    const clash = () => insertResumeVersionIfNew(db, aResumeVersion({ versionId: aVersionId("c"), shortId: "r-aaaaaaaa" }));

    expect(clash).toThrow(/UNIQUE/);
    db.close();
  });
});

describe("an application's use of a resume", () => {
  it("starts as a draft with no file", () => {
    const db = openTestDatabase();
    setUpDraft(db);

    expect(getApplicationResume(db, "app-1", aVersionId("a"))).toEqual({
      applicationId: "app-1",
      versionId: aVersionId("a"),
      shortId: "r-aaaaaaaa",
      state: "draft",
      pdfSha256: null,
      createdAt: TEST_TIMESTAMP,
    });
    expect(getApprovedPdf(db, "app-1", aVersionId("a"))).toBeNull();
    db.close();
  });

  it("lists every resume an application has used, oldest first", () => {
    const db = openTestDatabase();
    setUpDraft(db);
    insertResumeVersionIfNew(db, aResumeVersion({ versionId: aVersionId("d"), shortId: "r-dddddddd" }));
    insertApplicationResumeIfNew(db, { applicationId: "app-1", versionId: aVersionId("d"), createdAt: "2026-11-01T10:00:00.000Z" });

    const versions = listApplicationResumes(db, "app-1");

    expect(versions.map((version) => version.shortId)).toEqual(["r-aaaaaaaa", "r-dddddddd"]);
    db.close();
  });

  it("does not turn an approved resume back into a draft when the same draft is submitted again", () => {
    const db = openTestDatabase();
    setUpDraft(db);
    markResumeApproved(db, approveWith(PDF_BYTES));

    insertApplicationResumeIfNew(db, { applicationId: "app-1", versionId: aVersionId("a"), createdAt: "2026-11-01T10:00:00.000Z" });

    expect(getApplicationResume(db, "app-1", aVersionId("a"))?.state).toBe("approved");
    db.close();
  });
});

describe("approved resume files", () => {
  it("freezes the draft with its PDF bytes and fingerprint", () => {
    const db = openTestDatabase();
    setUpDraft(db);

    markResumeApproved(db, approveWith(PDF_BYTES));

    expect(getApplicationResume(db, "app-1", aVersionId("a"))).toMatchObject({ state: "approved", pdfSha256: PDF_SHA256 });
    const stored = getApprovedPdf(db, "app-1", aVersionId("a"));
    expect(stored?.pdfSha256).toBe(PDF_SHA256);
    expect(Array.from(stored?.pdfBytes ?? [])).toEqual(Array.from(PDF_BYTES));
    db.close();
  });

  it("accepts the same bytes again without changing anything", () => {
    const db = openTestDatabase();
    setUpDraft(db);
    markResumeApproved(db, approveWith(PDF_BYTES));

    const approveAgain = () => markResumeApproved(db, approveWith(PDF_BYTES));

    expect(approveAgain).not.toThrow();
    db.close();
  });

  it("refuses different bytes for a resume that is already approved", () => {
    const db = openTestDatabase();
    setUpDraft(db);
    markResumeApproved(db, approveWith(PDF_BYTES));
    const differentBytes = new TextEncoder().encode("%PDF-1.7 a rebuilt resume");

    const replace = () => markResumeApproved(db, approveWith(differentBytes));

    expect(replace).toThrow(ApprovedFileConflictError);
    expect(getApprovedPdf(db, "app-1", aVersionId("a"))?.pdfSha256).toBe(PDF_SHA256);
    db.close();
  });

  it("refuses a fingerprint that does not describe the bytes", () => {
    const db = openTestDatabase();
    setUpDraft(db);

    const wrongFingerprint = () => markResumeApproved(db, { ...approveWith(PDF_BYTES), pdfSha256: "0".repeat(64) });

    expect(wrongFingerprint).toThrow(/fingerprint/);
    expect(getApplicationResume(db, "app-1", aVersionId("a"))?.state).toBe("draft");
    db.close();
  });

  it("refuses to approve a resume the application never used", () => {
    const db = openTestDatabase();
    anApplicationInDatabase(db);

    const approveUnknown = () => markResumeApproved(db, approveWith(PDF_BYTES));

    expect(approveUnknown).toThrow(/No resume/);
    db.close();
  });

  it("lets the database itself refuse an approved row without its file", () => {
    const db = openTestDatabase();
    setUpDraft(db);

    const approveWithoutFile = () =>
      db.sqlite.prepare("UPDATE application_resumes SET state = 'approved'").run();

    expect(approveWithoutFile).toThrow(/CHECK/);
    db.close();
  });

  it("finds an approved file for a version through any application", () => {
    const db = openTestDatabase();
    setUpDraft(db);
    markResumeApproved(db, approveWith(PDF_BYTES));

    const found = findApprovedPdfForVersion(db, aVersionId("a"));

    expect(found?.pdfSha256).toBe(PDF_SHA256);
    expect(findApprovedPdfForVersion(db, aVersionId("e"))).toBeNull();
    db.close();
  });
});
