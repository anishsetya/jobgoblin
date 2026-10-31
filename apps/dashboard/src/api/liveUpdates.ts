// Keeps every screen current without the person pressing refresh.
// The server says what changed ("run.updated", "application.updated", ...) and this file marks the
// matching cached data stale; React Query then fetches it again for whichever screens are showing it.
// The events carry no data of their own beyond a run's progress: the facts always come from the normal routes.
// Spec: ARCHITECTURE.md sections 5.10 and 12.
import type { Run, ServerEvent } from "@jobgoblin/schemas";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { subscribeToServerEvents } from "./events";
import {
  invalidateApplication,
  invalidateApplicationLists,
  invalidateEverything,
  invalidateProfileData,
} from "./invalidate";
import { queryKeys } from "./keys";
import { rememberRun } from "./runs";

const ACTIVE_RUN_STATUSES: readonly Run["status"][] = ["queued", "running"];

// Call once, near the top of the app.
export function useLiveUpdates(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let hasConnectedBefore = false;

    return subscribeToServerEvents({
      onEvent: (event) => refreshForEvent(queryClient, event),
      onConnected: () => {
        // Updates sent while the connection was down are gone, so after a reconnect refresh everything.
        if (hasConnectedBefore) void invalidateEverything(queryClient);
        hasConnectedBefore = true;
      },
    });
  }, [queryClient]);
}

function refreshForEvent(queryClient: QueryClient, event: ServerEvent): void {
  switch (event.type) {
    case "run.updated":
      refreshForRun(queryClient, event.run);
      return;
    case "application.updated":
      void invalidateApplication(queryClient, event.applicationId);
      return;
    case "needs-you.changed":
      void queryClient.invalidateQueries({ queryKey: queryKeys.today() });
      return;
    case "profile.updated":
      void invalidateProfileData(queryClient);
      return;
    case "backup.done":
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.backups() });
      return;
    default:
      return assertNever(event);
  }
}

// A run reports progress many times; each report updates its card. When a run stops, what it
// produced (new story items, drafts, answers to a question) is fetched too.
function refreshForRun(queryClient: QueryClient, run: Run): void {
  rememberRun(queryClient, run);
  void invalidateApplicationLists(queryClient);

  if (ACTIVE_RUN_STATUSES.includes(run.status)) return;
  void queryClient.invalidateQueries({ queryKey: queryKeys.application() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.story() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.profile() });
}

// If a new event type is added to the schemas and not handled above, this line stops the build.
function assertNever(event: never): never {
  throw new Error(`Unhandled live update: ${JSON.stringify(event)}`);
}
