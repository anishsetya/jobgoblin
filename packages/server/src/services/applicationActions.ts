// Which buttons an application's screens may show right now. The server works this out with the rules in
// packages/core, so the dashboard only shows or hides buttons and never decides what is allowed.
// Spec: ARCHITECTURE.md section 5.9 (ApplicationActions).
import type { Application, ApplicationActions, HistoryEvent } from "@jobgoblin/schemas";
import { canTransition, statusBeforeSkip } from "@jobgoblin/core";
import { getLiveApproval } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { findRunHoldingApplication } from "./runs";

export function computeActions(ctx: ServerContext, application: Application, history: HistoryEvent[]): ApplicationActions {
  const { status } = application;
  const hasLiveApproval = getLiveApproval(ctx.db, application.id) !== null;
  const hasActiveRun = findRunHoldingApplication(ctx, application.id) !== null;
  const statusBeforeTheSkip = statusBeforeSkip(history);

  return {
    // Awaiting approval for a first approval; Approved without a live approval for approving again after a change of details.
    canApprove: status === "Awaiting approval" || (status === "Approved" && !hasLiveApproval),
    canSkip: canTransition(status, "Skipped", "person", "skip"),
    canUndoSkip: statusBeforeTheSkip !== null && canTransition(status, statusBeforeTheSkip, "person", "undo_skip"),
    canRequestEdit: canTransition(status, "Tailored", "person", "request_edit") && !hasActiveRun,
    canTailor: (status === "Scored" || status === "Long shot") && !hasActiveRun,
    canWithdraw: canTransition(status, "Withdrawn", "person", "withdraw"),
    canMarkSubmitted: (status === "Approved" || status === "Filling") && hasLiveApproval,
    canAsk: !hasActiveRun,
  };
}
