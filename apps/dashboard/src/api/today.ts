// Data for the Today screen: what needs the person, what is running, what got done, and adding a job.
// Routes: GET /api/today, POST /api/jobs. Spec: ARCHITECTURE.md section 11.
import { AddJobResponse, TodayResponse, type AddJobRequest } from "@jobgoblin/schemas";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { invalidateApplicationLists } from "./invalidate";
import { queryKeys } from "./keys";

// Also used by the router, which reads `setupComplete` before the first screen shows.
export function todayQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.today(),
    queryFn: () => apiFetch("/api/today", { schema: TodayResponse }),
  });
}

export function useToday() {
  return useQuery(todayQueryOptions());
}

// "Add a job": a link, or pasted text with its company and title. When a link needs a login the
// answer has needsText=true and the form asks for the text instead. The paste run's card appears
// on Today through the live updates.
export function useAddJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: AddJobRequest) =>
      apiFetch("/api/jobs", { method: "POST", json: request, schema: AddJobResponse }),
    onSuccess: () => invalidateApplicationLists(queryClient),
  });
}
