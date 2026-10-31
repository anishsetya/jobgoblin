// Resume PDFs on their way to the dashboard. An approved resume is served from the frozen bytes in the
// database. A draft is a preview: it is kept in <app data>/previews/<versionId>.pdf, rebuilt whenever it is
// missing or the contact details at the top have changed, and never sent anywhere but the dashboard.
// Spec: ARCHITECTURE.md section 8.4 (previews) and decision D19.
import fs from "node:fs";
import path from "node:path";
import { headerHash } from "@jobgoblin/core";
import {
  getApplicationResume,
  getApprovedPdf,
  getLatestApproval,
  getProfileSection,
  getResumeVersion,
  listStoryItems,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { loadApplicationOrFail } from "./loaders";
import { buildResumeHeader } from "./resumeVersions";
import { notFound } from "./serviceError";

export type ResumeFile = { bytes: Uint8Array; fileName: string };

const FALLBACK_FILE_NAME = "Resume.pdf";

function previewsDir(ctx: ServerContext): string {
  return path.join(ctx.appDataDir, "previews");
}

// versionId is "r-" and 64 hex characters, so it is always a safe file name.
function previewPath(ctx: ServerContext, versionId: string): string {
  return path.join(previewsDir(ctx), `${versionId}.pdf`);
}

export function savePreview(ctx: ServerContext, versionId: string, bytes: Uint8Array): void {
  fs.mkdirSync(previewsDir(ctx), { recursive: true });
  fs.writeFileSync(previewPath(ctx, versionId), bytes);
}

// `versionId` null means the application's current resume.
export async function getResumePdf(
  ctx: ServerContext,
  applicationId: string,
  versionId: string | null,
): Promise<ResumeFile> {
  const application = loadApplicationOrFail(ctx, applicationId);
  const wantedVersion = versionId ?? application.resumeVersion;
  if (wantedVersion === null) throw notFound("resume", "Wait for the resume to be made.");

  const use = getApplicationResume(ctx.db, applicationId, wantedVersion);
  if (use === null) throw notFound("resume");

  const fileName = getLatestApproval(ctx.db, applicationId)?.dataSheet.resumeFileName ?? FALLBACK_FILE_NAME;

  if (use.state === "approved") {
    const approved = getApprovedPdf(ctx.db, applicationId, wantedVersion);
    if (approved === null) throw notFound("approved resume file");
    return { bytes: approved.pdfBytes, fileName };
  }
  return { bytes: await readOrRenderPreview(ctx, wantedVersion), fileName };
}

async function readOrRenderPreview(ctx: ServerContext, versionId: string): Promise<Uint8Array> {
  const version = getResumeVersion(ctx.db, versionId);
  if (version === null) throw notFound("resume");

  const header = buildResumeHeader(getProfileSection(ctx.db, "contact"));
  // A saved preview is only right while the header is the one it was built with.
  const headerIsUnchanged = version.headerHash === headerHash(header);
  const savedPath = previewPath(ctx, versionId);
  if (headerIsUnchanged && fs.existsSync(savedPath)) return fs.readFileSync(savedPath);

  const bytes = await ctx.renderer.renderResumePdf({ header, body: version.body, storyItems: listStoryItems(ctx.db), versionId });
  if (headerIsUnchanged) savePreview(ctx, versionId, bytes);
  return bytes;
}
