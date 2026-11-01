import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileSha256, sha256OfBytes } from "./hash";
import { createPersonFolder } from "./personFolder";
import { updateApplicationFields } from "./tables/applications";
import { insertApproval } from "./tables/approvals";
import { insertApplicationResumeIfNew, insertResumeVersionIfNew, markResumeApproved } from "./tables/resumes";
import {
  aResumeVersion,
  anApplicationInDatabase,
  anApproval,
  aVersionId,
  makeTempDir,
  openTestDatabase,
  PDF_BYTES,
  PDF_SHA256,
  removeTempDirs,
  TEST_TIMESTAMP,
} from "./testSupport";
import { verifyApprovedFiles } from "./verifyApprovedFiles";

afterEach(removeTempDirs);

const APPLICATION_FOLDER = "Applications/2026-10-31 Acme Cloud - Backend Engineer";

// An application that was approved the way the server does it: version, frozen PDF, approval, and files on disk.
function setUpApprovedApplication() {
  const db = openTestDatabase();
  const folder = createPersonFolder(path.join(makeTempDir(), "Jobgoblin"));
  const version = aResumeVersion();
  anApplicationInDatabase(db, { status: "Approved", resumeVersion: null });
  insertResumeVersionIfNew(db, version);
  insertApplicationResumeIfNew(db, { applicationId: "app-1", versionId: version.versionId, createdAt: TEST_TIMESTAMP });
  markResumeApproved(db, { applicationId: "app-1", versionId: version.versionId, pdfSha256: PDF_SHA256, pdfBytes: PDF_BYTES });
  insertApproval(db, anApproval());
  updateApplicationFields(db, "app-1", { resumeVersion: version.versionId, folder: APPLICATION_FOLDER }, TEST_TIMESTAMP);
  const written = folder.writeApprovedResume({
    bytes: PDF_BYTES,
    shortId: version.shortId,
    folder: APPLICATION_FOLDER,
    fileName: "Alex Rivera - Resume.pdf",
  });
  return { db, folder, written };
}

describe("verifyApprovedFiles", () => {
  it("finds nothing to do when every approved file is where it should be", () => {
    const { db, folder } = setUpApprovedApplication();

    const report = verifyApprovedFiles(db, folder);

    expect(report).toEqual({ checked: 2, rewritten: [], mismatched: [], refused: [] });
    db.close();
  });

  it("writes missing files again from the database, byte for byte", () => {
    const { db, folder, written } = setUpApprovedApplication();
    fs.rmSync(folder.absolutePath(written.resumePath));
    fs.rmSync(folder.absolutePath(written.copyPath));

    const report = verifyApprovedFiles(db, folder);

    expect(report.rewritten.sort()).toEqual([written.copyPath, written.resumePath].sort());
    expect(fileSha256(folder.absolutePath(written.resumePath))).toBe(PDF_SHA256);
    expect(fileSha256(folder.absolutePath(written.copyPath))).toBe(PDF_SHA256);
    db.close();
  });

  it("restores the whole folder on a new computer, where only the database was brought over", () => {
    const { db } = setUpApprovedApplication();
    const newComputersFolder = createPersonFolder(path.join(makeTempDir(), "Jobgoblin"));

    const report = verifyApprovedFiles(db, newComputersFolder);

    expect(report.rewritten).toHaveLength(2);
    expect(fs.existsSync(path.join(newComputersFolder.root, "Resumes", "r-aaaaaaaa.pdf"))).toBe(true);
    expect(fs.existsSync(path.join(newComputersFolder.root, ...APPLICATION_FOLDER.split("/"), "Alex Rivera - Resume.pdf"))).toBe(true);
    db.close();
  });

  it("leaves a file alone when its content differs from what was approved, and says so", () => {
    const { db, folder, written } = setUpApprovedApplication();
    const editedBytes = new TextEncoder().encode("%PDF-1.7 the person replaced this file");
    fs.writeFileSync(folder.absolutePath(written.copyPath), editedBytes);

    const report = verifyApprovedFiles(db, folder);

    expect(report.mismatched).toEqual([written.copyPath]);
    expect(report.rewritten).toEqual([]);
    expect(sha256OfBytes(fs.readFileSync(folder.absolutePath(written.copyPath)))).toBe(sha256OfBytes(editedBytes));
    db.close();
  });

  it("checks only Resumes for an older approved version, not the application's folder", () => {
    const { db, folder } = setUpApprovedApplication();
    const olderBytes = new TextEncoder().encode("%PDF-1.7 the first approved resume");
    const older = aResumeVersion({ versionId: aVersionId("d"), shortId: "r-dddddddd" });
    insertResumeVersionIfNew(db, older);
    insertApplicationResumeIfNew(db, { applicationId: "app-1", versionId: older.versionId, createdAt: TEST_TIMESTAMP });
    markResumeApproved(db, { applicationId: "app-1", versionId: older.versionId, pdfSha256: sha256OfBytes(olderBytes), pdfBytes: olderBytes });

    const report = verifyApprovedFiles(db, folder);

    expect(report.rewritten).toEqual(["Resumes/r-dddddddd.pdf"]);
    expect(report.checked).toBe(3);
    db.close();
  });

  it("refuses to write outside the person's folder when a stored path climbs out of it", () => {
    const { db, folder } = setUpApprovedApplication();
    updateApplicationFields(db, "app-1", { folder: "../../outside" }, TEST_TIMESTAMP);

    const report = verifyApprovedFiles(db, folder);

    expect(report.refused).toEqual(["../../outside/Alex Rivera - Resume.pdf"]);
    expect(fs.existsSync(path.join(folder.root, "..", "..", "outside"))).toBe(false);
    db.close();
  });
});
