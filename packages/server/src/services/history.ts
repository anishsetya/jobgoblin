// Writes one row of the change log for events that are not a status move (a move logs itself through
// storage.updateApplicationStatus). Rows are only ever added; the database refuses edits and deletes.
// Spec: ARCHITECTURE.md section 5.9 (history event types) and 7.
import type { Actor, HistoryEventType } from "@jobgoblin/schemas";
import { insertHistoryEvent, newId } from "@jobgoblin/storage";
import type { ServerContext } from "../context";

export type HistoryNote = {
  applicationId: string;
  actor: Actor;
  type: HistoryEventType;
  detail?: string | null;
};

export function recordHistory(ctx: ServerContext, note: HistoryNote): void {
  insertHistoryEvent(ctx.db, {
    id: newId(),
    ts: ctx.now().toISOString(),
    actor: note.actor,
    applicationId: note.applicationId,
    type: note.type,
    from: null,
    to: null,
    detail: note.detail ?? null,
  });
}
