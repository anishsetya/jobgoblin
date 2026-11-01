// Setup: importing the person's resume (and an optional LinkedIn PDF), and finishing the wizard.
// The contact details are taken out of the resume text by code before any run sees it (decision D10): what
// was found fills the empty contact fields, and the run reads the text with {placeholders} in their place.
// Spec: ARCHITECTURE.md decisions D7 and D10, and section 11 (POST /api/import-resume, POST /api/setup/finish).
import path from "node:path";
import {
  type ContactSection,
  type ImportResumeOutput,
  type ImportResumeResponse,
  type SettingsResponse,
  type UploadKind,
  TODO,
} from "@jobgoblin/schemas";
import { buildMasterResume, redactContactDetails } from "@jobgoblin/core";
import { extractResumeText, ResumeFileError } from "@jobgoblin/render";
import {
  getProfileSection,
  insertUpload,
  listLatestUploads,
  listRunsByStatus,
  listStoryItemsByStatus,
  newId,
  saveMasterResume,
  saveProfileSection,
  setSetting,
  type Upload,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { announceProfileChange, saveChangesSoon } from "./changes";
import { voidChangedApprovals } from "./approvalVoiding";
import { queueRun } from "./runs";
import { getSettingsResponse } from "./settings";
import { invalid, ourFault, unavailable, type ServiceError } from "./serviceError";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const NO_TEXT_MESSAGE = "This file has no readable text. Try a PDF exported from Word or Google Docs.";

export type ResumeUpload = { fileName: string; bytes: Uint8Array; kind: UploadKind };

export async function importResume(ctx: ServerContext, upload: ResumeUpload): Promise<ImportResumeResponse> {
  if (upload.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw invalid("file-too-large", "That file is larger than 10 MB.", "Choose a smaller PDF or Word file.");
  }
  const fileName = path.basename(upload.fileName);
  const text = await readText(ctx, upload.bytes, fileName);

  const { redacted, found } = redactContactDetails(text);
  // The original file is never stored: only the text, with contact details already removed.
  insertUpload(ctx.db, {
    id: newId(),
    kind: upload.kind,
    fileName,
    redactedText: redacted,
    uploadedAt: ctx.now().toISOString(),
  });
  fillEmptyContactFields(ctx, found);

  // The LinkedIn file only adds to what the resume says, so the run waits for the resume.
  if (upload.kind === "linkedin") return { runId: null };
  return { runId: setupRunFor(ctx) };
}

async function readText(ctx: ServerContext, bytes: Uint8Array, fileName: string): Promise<string> {
  let text: string;
  try {
    text = await extractResumeText(bytes, fileName);
  } catch (error) {
    if (error instanceof ResumeFileError) throw explainUnreadableFile(ctx, error);
    throw error;
  }
  if (text.trim() === "") {
    ctx.logger.warn({ code: "no-readable-text" }, "A resume file had no readable text.");
    throw invalid("no-readable-text", NO_TEXT_MESSAGE, "Choose another file.");
  }
  return text;
}

// ResumeFileError words are plain and ready to show. The reader's own error goes to the log (its name and
// text, never the file's contents), so a failure on our side, like the PDF reader not starting inside the
// desktop app, can be found afterwards. Only "read-failed" is our fault, so only it is a server error (500).
function explainUnreadableFile(ctx: ServerContext, error: ResumeFileError): ServiceError {
  ctx.logger.warn({ code: error.code, cause: String(error.cause) }, "A resume file could not be read.");
  if (error.code === "read-failed") return ourFault(error.code, error.message, error.action);
  return invalid(error.code, error.message, error.action);
}

// What the code found in the header of the resume goes into contact fields that are still empty.
// Something the person already typed is never overwritten.
function fillEmptyContactFields(ctx: ServerContext, found: Partial<ContactSection>): void {
  const current = getProfileSection(ctx.db, "contact");
  const updated: ContactSection = { ...current };
  let changed = false;

  for (const key of Object.keys(found) as (keyof ContactSection)[]) {
    const foundValue = found[key];
    const currentValue = current[key];
    const isEmpty = currentValue === undefined || currentValue === TODO || currentValue.trim() === "";
    if (foundValue !== undefined && foundValue.trim() !== "" && isEmpty) {
      updated[key] = foundValue;
      changed = true;
    }
  }
  if (!changed) return;

  saveProfileSection(ctx.db, "contact", updated, ctx.now().toISOString());
  voidChangedApprovals(ctx);
  announceProfileChange(ctx);
}

// One setup run at a time: uploading twice joins the run that is already waiting or going.
function setupRunFor(ctx: ServerContext): string {
  const active = listRunsByStatus(ctx.db, ["queued", "running"]).find((run) => run.kind === "setup");
  if (active !== undefined) return active.id;
  return queueRun(ctx, { kind: "setup", applicationIds: [], input: {} }).id;
}

// The text of the latest resume and LinkedIn upload, already redacted, for the setup run (import_resume).
export function getUploadsForRun(ctx: ServerContext): ImportResumeOutput {
  return {
    uploads: listLatestUploads(ctx.db).map((upload) => ({
      kind: upload.kind,
      fileName: neutralFileName(upload),
      text: upload.redactedText,
    })),
  };
}

// The person's own file name ("Alex Rivera - Resume.pdf") usually contains their name, and contact
// details must never reach a run (D10). The run gets "resume.pdf" or "linkedin.pdf" instead.
function neutralFileName(upload: Upload): string {
  return upload.kind + path.extname(upload.fileName);
}

// The last step of the wizard: the master resume is built from the confirmed items, and setup is done.
export function finishSetup(ctx: ServerContext): SettingsResponse {
  if (ctx.folder === null) {
    throw unavailable("no-person-folder", "Choose where Jobgoblin keeps your files first.", "Go back to the folder step.");
  }
  const confirmed = listStoryItemsByStatus(ctx.db, "confirmed");
  saveMasterResume(ctx.db, buildMasterResume(confirmed), ctx.now().toISOString());
  setSetting(ctx.db, "setupComplete", true);

  ctx.bus.emit({ type: "needs-you.changed" });
  saveChangesSoon(ctx); // the first backup and tracker file of a finished setup
  return getSettingsResponse(ctx);
}
