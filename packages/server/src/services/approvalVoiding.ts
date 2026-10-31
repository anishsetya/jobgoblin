// A profile change voids every live approval whose data sheet would now be different. The application
// stays Approved, but its approval no longer counts: the Open application screen says "Your details
// changed since you approved. Review it again." and "I submitted" is refused until the person approves again.
// Threat stopped: an application going out with details the person did not approve.
// Spec: ARCHITECTURE.md section 8.5 (last paragraph).
import { getApplication, getJob, listLiveApprovals, voidApproval } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { announceApplication } from "./changes";
import { buildCurrentDataSheet } from "./dataSheets";
import { recordHistory } from "./history";

// Returns the ids of the applications whose approval was voided.
export function voidChangedApprovals(ctx: ServerContext): string[] {
  const voidedApplicationIds: string[] = [];

  for (const approval of listLiveApprovals(ctx.db)) {
    const application = getApplication(ctx.db, approval.applicationId);
    const job = application === null ? null : getJob(ctx.db, application.jobId);
    if (application === null || job === null) continue;

    // The approval's own resume version is used, so only a change to the details counts, not a newer resume.
    const rebuilt = buildCurrentDataSheet(ctx, application, job, approval.resumeVersion);
    if (rebuilt.hash === approval.dataSheetHash) continue;

    ctx.db.transaction(() => {
      voidApproval(ctx.db, approval.id, ctx.now().toISOString());
      recordHistory(ctx, {
        applicationId: application.id,
        actor: "server",
        type: "approval-voided",
        detail: "Your details changed after you approved this application.",
      });
    });
    voidedApplicationIds.push(application.id);
  }

  for (const applicationId of voidedApplicationIds) announceApplication(ctx, applicationId);
  return voidedApplicationIds;
}
