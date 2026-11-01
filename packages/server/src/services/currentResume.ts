// An application's resume as it would be printed right now. The top of a resume (name, email, phone...)
// comes from the contact section, and the version id covers it (decision D18). So if the person changes
// their phone number after a draft was made, the same body has a new version id. This works out which one,
// so the data sheet shown for review and the PDF made on approval always describe the same resume.
// Spec: ARCHITECTURE.md section 5.6 (version ids) and decision D18.
import type { Application, ResumeHeader, ResumeVersion, ResumeVersionId } from "@jobgoblin/schemas";
import { getProfileSection, getResumeVersion } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { buildResumeHeader, versionIdFor } from "./resumeVersions";

export type CurrentResume = {
  stored: ResumeVersion; // the version saved with the application
  header: ResumeHeader; // built from the contact section as it is now
  versionId: ResumeVersionId; // the id the body has with that header: equal to stored.versionId unless contact details changed
};

// Null while the application has no resume yet.
export function resolveCurrentResume(ctx: ServerContext, application: Application): CurrentResume | null {
  if (application.resumeVersion === null) return null;
  const stored = getResumeVersion(ctx.db, application.resumeVersion);
  if (stored === null) return null;

  const header = buildResumeHeader(getProfileSection(ctx.db, "contact"));
  return { stored, header, versionId: versionIdFor(stored.body, header) };
}
