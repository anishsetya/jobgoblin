// Runs (background Claude sessions) and the questions they ask.
// Routes: POST /api/runs, POST /api/runs/:id/retry and /dismiss, DELETE /api/runs/:id,
// POST /api/questions/:id/answer. Spec: ARCHITECTURE.md sections 5.8 and 11.
import { Question, Run } from "@jobgoblin/schemas";
import { skipToken, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { invalidateApplicationLists } from "./invalidate";
import { queryKeys } from "./keys";
import { useToday } from "./today";

// Keeps the newest state of a run in the cache, so a card can show its progress without asking for it.
// Called with every run the server sends back and with every "run.updated" live update.
export function rememberRun(queryClient: QueryClient, run: Run): void {
  queryClient.setQueryData(queryKeys.run(run.id), run);
}

// The latest state of one run, or null until the first update has arrived.
// The server has no route to fetch a single run, so this query never fetches (skipToken):
// its data only ever comes from rememberRun.
export function useLiveRun(runId: string | null): Run | null {
  const query = useQuery<Run>({
    queryKey: queryKeys.run(runId ?? "none"),
    queryFn: skipToken,
  });
  return runId === null ? null : (query.data ?? null);
}

// The run that reads the person's resume during setup. If the page was reloaded the run id is lost,
// so fall back to the setup run listed on Today.
export function useSetupRun(runId: string | null): Run | null {
  const liveRun = useLiveRun(runId);
  const today = useToday();
  const listedRun = today.data?.running.find((run) => run.kind === "setup") ?? null;
  return liveRun ?? listedRun;
}

// The "Find jobs" button.
export function useStartHunt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch("/api/runs", { method: "POST", json: { kind: "hunt" }, schema: Run }),
    onSuccess: async (run) => {
      rememberRun(queryClient, run);
      await invalidateApplicationLists(queryClient);
    },
  });
}

function useRunAction(path: (runId: string) => string, method: "POST" | "DELETE") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => apiFetch(path(runId), { method, schema: Run }),
    onSuccess: async (run) => {
      rememberRun(queryClient, run);
      await invalidateApplicationLists(queryClient);
    },
  });
}

export function useCancelRun() {
  return useRunAction((runId) => `/api/runs/${encodeURIComponent(runId)}`, "DELETE");
}

// Retrying starts a new run; the response is that new run.
export function useRetryRun() {
  return useRunAction((runId) => `/api/runs/${encodeURIComponent(runId)}/retry`, "POST");
}

// Clears a finished run's card from Today.
export function useDismissRun() {
  return useRunAction((runId) => `/api/runs/${encodeURIComponent(runId)}/dismiss`, "POST");
}

// Answers a question a run asked. That one application goes back in the queue (decision D8).
export function useAnswerQuestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { questionId: string; answer: string }) =>
      apiFetch(`/api/questions/${encodeURIComponent(variables.questionId)}/answer`, {
        method: "POST",
        json: { answer: variables.answer },
        schema: Question,
      }),
    onSuccess: async (question) => {
      await Promise.all([
        invalidateApplicationLists(queryClient),
        queryClient.invalidateQueries({ queryKey: queryKeys.application(question.applicationId) }),
      ]);
    },
  });
}
