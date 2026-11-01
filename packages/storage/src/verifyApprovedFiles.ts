// Startup check: every approved resume file must exist on disk, byte for byte as it was approved.
// The database keeps the approved PDF bytes (decision D19), so a file that is missing - deleted by mistake,
// or never copied to a new computer - is written again from there. A file that exists but differs is
// left alone and reported: it may be one the person replaced on purpose.
// Spec: ARCHITECTURE.md section 7 (verifyApprovedFiles) and decision D19.
import fs from "node:fs";
import type { Database } from "./database";
import { PathOutsideFolderError } from "./errors";
import { fileSha256 } from "./hash";
import { makeFileSystemSafe, RESUMES_DIR, writeFileAtomically, type PersonFolder } from "./personFolder";
import { getApprovedPdf, listApprovedResumeFiles } from "./tables/resumes";

// Paths are relative to the person's folder.
export type VerifyApprovedFilesReport = {
  checked: number; // files looked at
  rewritten: string[]; // were missing and have been written again
  mismatched: string[]; // exist, but their content is not what was approved; not touched
  refused: string[]; // stored paths that point outside the person's folder; not touched
};

export function verifyApprovedFiles(db: Database, folder: PersonFolder): VerifyApprovedFilesReport {
  const report: VerifyApprovedFilesReport = { checked: 0, rewritten: [], mismatched: [], refused: [] };

  for (const approved of listApprovedResumeFiles(db)) {
    // Every approved version has a file in Resumes/. Only the application's current version also has a copy in its folder.
    const relativePaths = [`${RESUMES_DIR}/${approved.shortId}.pdf`];
    if (approved.isCurrentResume && approved.applicationFolder !== null && approved.fileName !== null) {
      relativePaths.push(`${approved.applicationFolder}/${makeFileSystemSafe(approved.fileName)}`);
    }

    for (const relativePath of relativePaths) {
      report.checked += 1;
      checkFile(db, folder, relativePath, approved, report);
    }
  }
  return report;
}

type ApprovedFile = { applicationId: string; versionId: string; pdfSha256: string };

function checkFile(
  db: Database,
  folder: PersonFolder,
  relativePath: string,
  approved: ApprovedFile,
  report: VerifyApprovedFilesReport,
): void {
  let absolutePath: string;
  try {
    absolutePath = folder.absolutePath(relativePath);
  } catch (error) {
    if (!(error instanceof PathOutsideFolderError)) throw error;
    report.refused.push(relativePath);
    return;
  }

  if (fs.existsSync(absolutePath)) {
    if (fileSha256(absolutePath) !== approved.pdfSha256) report.mismatched.push(relativePath);
    return;
  }

  const pdf = getApprovedPdf(db, approved.applicationId, approved.versionId);
  if (pdf === null) return; // cannot happen: the list only holds approved rows
  writeFileAtomically(absolutePath, pdf.pdfBytes);
  report.rewritten.push(relativePath);
}
