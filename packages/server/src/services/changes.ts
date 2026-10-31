// What every change does after it is saved: tell the dashboard what to refetch, rewrite the tracker files
// soon, and make a backup soon. Services call these only after their transaction has committed, so a
// listener that refetches always sees the new data.
// Spec: ARCHITECTURE.md sections 5.10, 7 (tracker, backups) and 8.
import type { Application, Run } from "@jobgoblin/schemas";
import { getApplication } from "@jobgoblin/storage";
import type { ServerContext } from "../context";

// An application changed (its status, resume, approval...). Reads the application again so the event
// carries the status as it is now.
export function announceApplication(ctx: ServerContext, applicationId: string): Application | null {
  const application = getApplication(ctx.db, applicationId);
  if (application !== null) {
    ctx.bus.emit({ type: "application.updated", applicationId, status: application.status });
  }
  ctx.bus.emit({ type: "needs-you.changed" });
  return application;
}

export function announceRun(ctx: ServerContext, run: Run): void {
  ctx.bus.emit({ type: "run.updated", run });
  ctx.bus.emit({ type: "needs-you.changed" });
}

export function announceProfileChange(ctx: ServerContext): void {
  ctx.bus.emit({ type: "profile.updated" });
  ctx.bus.emit({ type: "needs-you.changed" });
}

// The tracker spreadsheet and the backup are both rewritten after a short pause (see storage).
export function saveChangesSoon(ctx: ServerContext): void {
  ctx.tracker.schedule();
  ctx.backups.scheduleAfterChange();
}

// The usual ending of a service that changed one application.
export function finishApplicationChange(ctx: ServerContext, applicationId: string): Application | null {
  const application = announceApplication(ctx, applicationId);
  saveChangesSoon(ctx);
  return application;
}
