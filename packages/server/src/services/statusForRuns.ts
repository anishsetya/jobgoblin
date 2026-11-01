// update_status for a run: the one status move a run may make, through the same state machine as the person's
// "status" route. No run kind is offered this tool in the proof of concept (RUN_KIND_TOOLS), so this exists
// to keep the tool list whole and the rule in one place: a run can only make moves the table gives to "run"
// with via "status" (an application that is Applied moving to OA, Phone screen or Onsite), never an approval.
// Truthfulness control: a run cannot mark an application Approved or Applied.
// Spec: ARCHITECTURE.md section 6.1 and section 9 (update_status).
import type { ApplicationStatus, UpdateStatusOutput } from "@jobgoblin/schemas";
import { canTransition } from "@jobgoblin/core";
import type { ServerContext } from "../context";
import { finishApplicationChange } from "./changes";
import { loadApplicationOrFail } from "./loaders";
import { moveApplication } from "./moves";
import { failed, succeeded, type Outcome } from "./serviceError";

export function updateStatusFromRun(
  ctx: ServerContext,
  request: { applicationId: string; to: ApplicationStatus },
): Outcome<UpdateStatusOutput> {
  const application = loadApplicationOrFail(ctx, request.applicationId);
  if (!canTransition(application.status, request.to, "run", "status")) {
    return failed([
      {
        code: "not-allowed",
        message: `An application that is "${application.status}" can't be moved to "${request.to}" by a run. Leave it as it is.`,
      },
    ]);
  }

  moveApplication(ctx, { application, to: request.to, actor: "run", via: "status" });
  const updated = finishApplicationChange(ctx, application.id);
  return succeeded({ status: updated?.status ?? request.to });
}
