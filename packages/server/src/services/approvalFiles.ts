// The readable files that appear in the person's folder when they approve an application:
//   Resumes/<shortId>.pdf              the approved resume, written once
//   Applications/<name>/<First Last - Resume.pdf>   the copy to attach
//   Applications/<name>/Job description.md
// They are written after the database change has committed. The approved bytes are also in the database
// (decision D19), so a file that fails to write is restored at the next start by verifyApprovedFiles.
// Spec: ARCHITECTURE.md section 8.5 (step 4).
import type { Job } from "@jobgoblin/schemas";
import type { ServerContext } from "../context";

export type ApprovedFileInput = {
  bytes: Uint8Array;
  shortId: string;
  applicationFolder: string; // relative to the person's folder, as stored in applications.folder
  resumeFileName: string;
  job: Job;
};

export function writeApprovedFiles(ctx: ServerContext, input: ApprovedFileInput): void {
  const folder = ctx.folder;
  if (folder === null) return;

  try {
    folder.writeApprovedResume({
      bytes: input.bytes,
      shortId: input.shortId,
      folder: input.applicationFolder,
      fileName: input.resumeFileName,
    });
    folder.writeJobDescription(input.applicationFolder, jobDescriptionMarkdown(input.job));
  } catch (error) {
    // The approval stands: the PDF is safe in the database and is written again at the next start.
    ctx.logger.error({ err: error, applicationFolder: input.applicationFolder }, "Could not write the approved files.");
  }
}

export function jobDescriptionMarkdown(job: Job): string {
  const lines = [`# ${job.title} at ${job.company}`, ""];
  if (job.location !== "") lines.push(`Location: ${job.location}`);
  if (job.url !== null) lines.push(`Posting: ${job.url}`);
  lines.push("", job.text, "");
  return lines.join("\n");
}
