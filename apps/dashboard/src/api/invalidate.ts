// "This changed, so fetch it again." Used by the mutation hooks after a click and by the live updates
// when the server says something changed. Marking a query stale makes every screen showing it reload.
import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./keys";

// One application changed: its own screens, the pipeline lists and the Today summary.
export function invalidateApplication(queryClient: QueryClient, applicationId: string): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.application(applicationId) }),
    invalidateApplicationLists(queryClient),
  ]).then(() => undefined);
}

// Something changed in the lists, such as a new application or a run that finished.
export function invalidateApplicationLists(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.pipeline() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.today() }),
  ]).then(() => undefined);
}

// The profile or Your story changed. Data sheets are built from the profile, so every
// open application can look different now.
export function invalidateProfileData(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.profile() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.story() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.application() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.today() }),
  ]).then(() => undefined);
}

// After a restore, or after the live connection was lost for a while: everything may be different.
export function invalidateEverything(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries();
}
