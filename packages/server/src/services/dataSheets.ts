// Builds the data sheet of an application from the profile as it is right now, and its hash.
// The person approves one exact sheet by hash; if the profile changes, the hash changes, and approval
// says "your details changed".
// Spec: ARCHITECTURE.md sections 5.7 and 8.5.
import type { Application, DataSheet, Job, ResumeVersionId } from "@jobgoblin/schemas";
import { buildDataSheet, hashDataSheet } from "@jobgoblin/core";
import { getProfile } from "@jobgoblin/storage";
import type { ServerContext } from "../context";

export type CurrentDataSheet = { dataSheet: DataSheet; hash: string };

export function buildCurrentDataSheet(
  ctx: ServerContext,
  application: Pick<Application, "id">,
  job: Pick<Job, "region">,
  resumeVersion: ResumeVersionId,
): CurrentDataSheet {
  const dataSheet = buildDataSheet({
    applicationId: application.id,
    profile: getProfile(ctx.db),
    region: job.region,
    resumeVersion,
  });
  return { dataSheet, hash: hashDataSheet(dataSheet) };
}
