// The person's own decisions about an application: skip it, undo a skip, withdraw it, or record what
// happened after applying (OA, Phone screen, Offer, Rejected...). Each is checked against the state machine
// and saved in one transaction. The status route can never reach Approved or Applied (decision D16): those
// moves have their own "via" and their own services.
// Spec: ARCHITECTURE.md sections 6.1 and 11 (skip, undo-skip, withdraw, status).
import type { Application, StatusChangeRequest } from "@jobgoblin/schemas";
import { canTransition, statusBeforeSkip } from "@jobgoblin/core";
import { getLiveApproval, listHistoryEvents, updateApplicationFields, voidApproval } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { finishApplicationChange } from "./changes";
import { recordHistory } from "./history";
import { loadApplicationOrFail } from "./loaders";
import { moveApplication } from "./moves";
import { conflict } from "./serviceError";

function savedApplication(ctx: ServerContext, applicationId: string): Application {
  const application = finishApplicationChange(ctx, applicationId);
  if (application === null) throw new Error("The application was saved but cannot be read back.");
  return application;
}

export function skipApplication(ctx: ServerContext, applicationId: string): Application {
  const application = loadApplicationOrFail(ctx, applicationId);
  if (!canTransition(application.status, "Skipped", "person", "skip")) {
    throw conflict("not-skippable", `An application that is "${application.status}" can't be skipped.`, "Open it from Pipeline.");
  }
  moveApplication(ctx, { application, to: "Skipped", actor: "person", via: "skip" });
  return savedApplication(ctx, applicationId);
}

// Back to the status the application had just before its latest skip.
export function undoSkip(ctx: ServerContext, applicationId: string): Application {
  const application = loadApplicationOrFail(ctx, applicationId);
  const before = statusBeforeSkip(listHistoryEvents(ctx.db, applicationId));
  if (before === null || !canTransition(application.status, before, "person", "undo_skip")) {
    throw conflict("not-skipped", "This application was not skipped, so there is nothing to undo.", "Open it from Pipeline.");
  }
  moveApplication(ctx, { application, to: before, actor: "person", via: "undo_skip" });
  return savedApplication(ctx, applicationId);
}

// Withdrawing ends the application, so an approval that was still waiting to be used is voided too.
export function withdrawApplication(ctx: ServerContext, applicationId: string, note?: string): Application {
  const application = loadApplicationOrFail(ctx, applicationId);
  if (!canTransition(application.status, "Withdrawn", "person", "withdraw")) {
    throw conflict("not-withdrawable", `An application that is "${application.status}" can't be withdrawn.`, "Open it from Pipeline.");
  }

  ctx.db.transaction(() => {
    moveApplication(ctx, { application, to: "Withdrawn", actor: "person", via: "withdraw", detail: note ?? null });
    const approval = getLiveApproval(ctx.db, applicationId);
    if (approval !== null) {
      voidApproval(ctx.db, approval.id, ctx.now().toISOString());
      recordHistory(ctx, { applicationId, actor: "person", type: "approval-voided", detail: "The application was withdrawn." });
    }
  });
  return savedApplication(ctx, applicationId);
}

// What the person records after applying. Only the moves of the "status" action are allowed
// (core.assertTransition throws for any other, which the error handler reports as "not allowed").
export function changeStatus(ctx: ServerContext, applicationId: string, request: StatusChangeRequest): Application {
  const application = loadApplicationOrFail(ctx, applicationId);

  ctx.db.transaction(() => {
    moveApplication(ctx, { application, to: request.to, actor: "person", via: "status", detail: request.note ?? null });
    if (request.followUpOn !== undefined) {
      updateApplicationFields(ctx.db, applicationId, { followUpOn: request.followUpOn }, ctx.now().toISOString());
    }
  });
  return savedApplication(ctx, applicationId);
}
