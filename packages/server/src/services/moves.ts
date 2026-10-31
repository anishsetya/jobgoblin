// The one way a service moves an application to another status: check the move against the state machine
// (core.assertTransition), then save it and log it (storage.updateApplicationStatus), together in one
// transaction. A caller that must also change other fields does so in the same transaction.
// Spec: ARCHITECTURE.md sections 6.1 and 7 (updateApplicationStatus), decision D16.
import type { Actor, Application, ApplicationStatus, HistoryEventType, TransitionVia } from "@jobgoblin/schemas";
import { assertTransition } from "@jobgoblin/core";
import { atomically, updateApplicationStatus } from "@jobgoblin/storage";
import type { ServerContext } from "../context";

export type Move = {
  application: Pick<Application, "id" | "status">;
  to: ApplicationStatus;
  actor: Actor;
  via: TransitionVia;
  type?: HistoryEventType; // what the history calls it; "status-changed" unless the move has its own word
  detail?: string | null;
};

// Throws a CoreError when the state machine forbids the move, and a StaleStatusError when the application
// is no longer in the status the caller read. Joins the caller's transaction when there is one.
export function moveApplication(ctx: ServerContext, move: Move): void {
  assertTransition(move.application.status, move.to, move.actor, move.via);
  atomically(ctx.db, () => {
    updateApplicationStatus(ctx.db, {
      applicationId: move.application.id,
      from: move.application.status,
      to: move.to,
      actor: move.actor,
      type: move.type ?? "status-changed",
      detail: move.detail ?? null,
      at: ctx.now().toISOString(),
    });
  });
}
