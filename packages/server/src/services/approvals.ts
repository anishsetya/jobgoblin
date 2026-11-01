// Approve (the person's decision, from the dashboard only): the person approves one exact data sheet and one
// exact resume file. The server rebuilds the sheet from the profile and refuses if it differs from the one
// the person saw, renders the final PDF once and freezes its bytes, and moves the application to Approved.
// Then it writes the files and queues an answers run for the screening questions.
// Threat stopped: an application going out with details or a resume the person did not approve.
// Spec: ARCHITECTURE.md section 8.5.
import type { Application, Approval, ApproveRequest, ResumeShortId, ResumeVersion } from "@jobgoblin/schemas";
import { findBannedTerms, headerHash, requiredMissing, sha256Hex } from "@jobgoblin/core";
import { readPdf, TEMPLATE_VERSION } from "@jobgoblin/render";
import {
  findApprovedPdfForVersion,
  getLiveApproval,
  getProfileSection,
  getApplicationResume,
  insertApplicationResumeIfNew,
  insertApproval,
  insertResumeVersionIfNew,
  listStoryItems,
  markResumeApproved,
  newId,
  updateApplicationFields,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { writeApprovedFiles } from "./approvalFiles";
import { finishApplicationChange } from "./changes";
import { resolveCurrentResume, type CurrentResume } from "./currentResume";
import { buildCurrentDataSheet, type CurrentDataSheet } from "./dataSheets";
import { recordHistory } from "./history";
import { loadApplicationOrFail, loadJobOfApplication } from "./loaders";
import { moveApplication } from "./moves";
import { chooseShortId } from "./resumeVersions";
import { announceQueuedRun, insertQueuedRun } from "./runs";
import { conflict, invalid, unavailable } from "./serviceError";

type FrozenPdf = { bytes: Uint8Array; sha256: string };

export async function approveApplication(
  ctx: ServerContext,
  request: ApproveRequest & { applicationId: string },
): Promise<Application> {
  const application = loadApplicationOrFail(ctx, request.applicationId);
  const isReapproval = refuseIfNotApprovable(ctx, application);
  const folder = requirePersonFolder(ctx);
  const job = loadJobOfApplication(ctx, application);
  const resume = resolveCurrentResume(ctx, application);
  if (resume === null) {
    throw conflict("no-resume", "This application has no resume yet.", "Wait for the resume to be made.");
  }

  const sheet = buildCurrentDataSheet(ctx, application, job, resume.versionId);
  refuseIfSheetChanged(sheet, request.dataSheetHash);
  refuseIfValuesMissing(sheet);
  refuseIfBannedInSheet(ctx, sheet);

  const pdf = await freezeFinalPdf(ctx, resume);
  const shortId = chooseShortId(ctx.db, resume.versionId);
  const applicationFolder = application.folder ?? folder.applicationFolderPath(folder.applicationFolderName(ctx.now(), application.company, application.title));

  saveApproval(ctx, { application, resume, shortId, sheet, pdf, applicationFolder, isReapproval, request });

  writeApprovedFiles(ctx, {
    bytes: pdf.bytes,
    shortId,
    applicationFolder,
    resumeFileName: sheet.dataSheet.resumeFileName,
    job,
  });
  if (!isReapproval) queueAnswersRun(ctx, application.id);

  const approved = finishApplicationChange(ctx, application.id);
  if (approved === null) throw new Error("The application was approved but cannot be read back.");
  return approved;
}

// ---------------------------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------------------------

// A first approval is for an application awaiting approval. An Approved application can be approved again
// only when its approval no longer counts (the person's details changed). Returns true for the second case.
function refuseIfNotApprovable(ctx: ServerContext, application: Application): boolean {
  if (application.status === "Awaiting approval") return false;
  if (application.status === "Approved" && getLiveApproval(ctx.db, application.id) === null) return true;
  throw conflict("not-approvable", `This application is "${application.status}", so it can't be approved now.`, "Open it from Pipeline.");
}

function requirePersonFolder(ctx: ServerContext) {
  if (ctx.folder === null) {
    throw unavailable("no-person-folder", "Choose your Jobgoblin folder first.", "Open Settings and choose a folder.");
  }
  return ctx.folder;
}

// The person approves the sheet they saw. If anything in the profile changed since, they must look again.
function refuseIfSheetChanged(sheet: CurrentDataSheet, seenHash: string): void {
  if (sheet.hash === seenHash) return;
  throw conflict("data-sheet-changed", "Your details changed since you opened this page.", "Review the application again.");
}

function refuseIfValuesMissing(sheet: CurrentDataSheet): void {
  const missing = requiredMissing(sheet.dataSheet);
  if (missing.length === 0) return;
  const names = missing.map((field) => field.label).join(", ");
  throw conflict("missing-values", `These details are still missing: ${names}.`, "Add them under Profile, then approve again.");
}

function refuseIfBannedInSheet(ctx: ServerContext, sheet: CurrentDataSheet): void {
  const texts = sheet.dataSheet.fields.map((field) => ({ path: `dataSheet.${field.key}`, text: field.value }));
  const problems = findBannedTerms(texts, getProfileSection(ctx.db, "rules").bannedTerms);
  if (problems.length === 0) return;
  throw invalid("banned-in-data-sheet", problems[0]?.message ?? "A banned word is in your details.", "Change that value under Profile.");
}

// ---------------------------------------------------------------------------------------------
// The final PDF
// ---------------------------------------------------------------------------------------------

// The approved file is built once. If this version was approved before (another application, or an earlier
// approval of this one), its frozen bytes are reused, so the fingerprint stays the same.
async function freezeFinalPdf(ctx: ServerContext, resume: CurrentResume): Promise<FrozenPdf> {
  const earlier = findApprovedPdfForVersion(ctx.db, resume.versionId);
  if (earlier !== null) return { bytes: earlier.pdfBytes, sha256: earlier.pdfSha256 };

  const bytes = await ctx.renderer.renderResumePdf({
    header: resume.header,
    body: resume.stored.body,
    storyItems: listStoryItems(ctx.db),
    versionId: resume.versionId,
  });
  const { pages, text } = await readPdf(bytes);
  if (pages !== 1) {
    throw invalid("resume-pages", `The resume is ${pages} pages long and must be exactly one.`, "Ask for an edit to shorten it.");
  }
  const banned = findBannedTerms([{ path: "resume.pdf", text }], getProfileSection(ctx.db, "rules").bannedTerms, "banned-in-pdf");
  if (banned.length > 0) {
    throw invalid("banned-in-resume", banned[0]?.message ?? "A banned word is in the resume.", "Ask for an edit that rewords it.");
  }
  return { bytes, sha256: sha256Hex(bytes) };
}

// ---------------------------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------------------------

type SaveInput = {
  application: Application;
  resume: CurrentResume;
  shortId: ResumeShortId; // chosen once in approveApplication and used for the file name, the history and the version row
  sheet: CurrentDataSheet;
  pdf: FrozenPdf;
  applicationFolder: string;
  isReapproval: boolean;
  request: ApproveRequest;
};

// One transaction: the approval, the frozen PDF, the folder, and the move to Approved (or a "re-approved" event).
function saveApproval(ctx: ServerContext, input: SaveInput): void {
  const { application, resume, shortId, sheet, pdf } = input;
  const now = ctx.now().toISOString();

  ctx.db.transaction(() => {
    switchToCurrentResumeVersion(ctx, application, resume, shortId);
    markResumeApproved(ctx.db, {
      applicationId: application.id,
      versionId: resume.versionId,
      pdfSha256: pdf.sha256,
      pdfBytes: pdf.bytes,
    });
    updateApplicationFields(ctx.db, application.id, { folder: input.applicationFolder }, now);
    insertApproval(ctx.db, approvalRecord(ctx, input));

    if (input.isReapproval) {
      recordHistory(ctx, { applicationId: application.id, actor: "person", type: "re-approved", detail: `Resume ${shortId}` });
    } else {
      moveApplication(ctx, {
        application,
        to: "Approved",
        actor: "person",
        via: "approve",
        type: "approved",
        detail: `Resume ${shortId}, data sheet ${sheet.hash.slice(0, 8)}`,
      });
    }
  });
}

function approvalRecord(ctx: ServerContext, input: SaveInput): Approval {
  return {
    id: newId(),
    applicationId: input.application.id,
    dataSheet: input.sheet.dataSheet,
    dataSheetHash: input.sheet.hash,
    resumeVersion: input.resume.versionId,
    pdfSha256: input.pdf.sha256,
    submitMode: input.request.submitMode,
    approvedAt: ctx.now().toISOString(),
    usedAt: null,
    voidedAt: null,
  };
}

// If the contact details changed since the draft, the same body has a new version id. The application
// then moves to that version (a new draft row), so the approved file and the version id describe each other.
function switchToCurrentResumeVersion(ctx: ServerContext, application: Application, resume: CurrentResume, shortId: ResumeShortId): void {
  if (resume.versionId === resume.stored.versionId) return;

  const version: ResumeVersion = {
    versionId: resume.versionId,
    shortId,
    body: resume.stored.body,
    headerHash: headerHash(resume.header),
    templateVersion: TEMPLATE_VERSION,
    createdAt: ctx.now().toISOString(),
  };
  insertResumeVersionIfNew(ctx.db, version);
  if (getApplicationResume(ctx.db, application.id, resume.versionId) === null) {
    insertApplicationResumeIfNew(ctx.db, { applicationId: application.id, versionId: resume.versionId, createdAt: version.createdAt });
  }
  updateApplicationFields(ctx.db, application.id, { resumeVersion: resume.versionId }, version.createdAt);
}

// The screening answers are written by a run, which sees only placeholders. If the run cannot be queued the
// approval still stands, so this is logged instead of failing the person's click.
function queueAnswersRun(ctx: ServerContext, applicationId: string): void {
  try {
    const run = ctx.db.transaction(() =>
      insertQueuedRun(ctx, { kind: "answers", applicationIds: [applicationId], input: {} }),
    );
    announceQueuedRun(ctx, run);
  } catch (error) {
    ctx.logger.warn({ err: error, applicationId }, "Could not queue the answers run after approval.");
  }
}
