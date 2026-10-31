// The one React Query client. It lives here, not inside a component, because the router also needs it
// (to check whether setup is finished before the first screen shows).
import { QueryClient } from "@tanstack/react-query";
import { ApiProblem } from "@/api/client";

const MAX_RETRIES = 2;
const HTTP_SERVER_ERROR = 500;

// Retry a failed read only when trying again could help: the server was unreachable or had a hiccup.
// A refusal (for example "not found" or "not allowed") will give the same answer again.
function shouldRetry(failureCount: number, error: Error): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  const isRefusal = error instanceof ApiProblem && error.status > 0 && error.status < HTTP_SERVER_ERROR;
  return !isRefusal;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      // Live updates keep data fresh, so there is no need to refetch every time a window gets focus.
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
    // A click that failed should say so once, not repeat itself.
    mutations: { retry: false },
  },
});
