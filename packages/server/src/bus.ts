// The event bus: services emit a ServerEvent when something changed, and the /api/events route (and
// later the runner) listens. Events only say what to refetch; the data itself comes from the normal routes.
// Spec: ARCHITECTURE.md sections 5.10 and 10 (EventBus).
import type { ServerEvent } from "@jobgoblin/schemas";

export type EventListener = (event: ServerEvent) => void;

export type EventBus = {
  emit(event: ServerEvent): void;
  // Returns the function that stops listening.
  subscribe(listener: EventListener): () => void;
};

// `reportListenerError` is where a failing listener goes. One broken listener (a closed browser tab, say)
// must never stop the others from hearing the event, and must never break the service that emitted it.
export function createEventBus(reportListenerError: (error: unknown) => void = () => undefined): EventBus {
  const listeners = new Set<EventListener>();

  return {
    emit(event) {
      // Copy first: a listener may unsubscribe itself while we are walking the set.
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (error) {
          reportListenerError(error);
        }
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
