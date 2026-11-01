// The connection to the person's Claude Code: is it installed, up to date and signed in?
// Routes: GET /api/claude/status, POST /api/claude/install, POST /api/claude/sign-in.
// Spec: ARCHITECTURE.md sections 10 (claudeCli.ts) and 11.
import { ClaudeStatus } from "@jobgoblin/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { queryKeys } from "./keys";

const RECHECK_EVERY_MS = 4_000;

// With `recheckUntilConnected`, the status is asked again every few seconds while it is not
// "connected". That is how the screen notices the person finished signing in on Anthropic's page.
export function useClaudeStatus(options: { recheckUntilConnected?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.claudeStatus(),
    queryFn: () => apiFetch("/api/claude/status", { schema: ClaudeStatus }),
    refetchInterval: (query) =>
      options.recheckUntilConnected === true && query.state.data?.state !== "connected" ? RECHECK_EVERY_MS : false,
  });
}

function useClaudeAction(path: "/api/claude/install" | "/api/claude/sign-in") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch(path, { method: "POST", json: {}, schema: ClaudeStatus }),
    onSuccess: (status) => queryClient.setQueryData(queryKeys.claudeStatus(), status),
  });
}

// Installs or updates Claude Code (winget on Windows). Can take a minute.
export function useInstallClaude() {
  return useClaudeAction("/api/claude/install");
}

// Opens Anthropic's own sign-in page. Jobgoblin never sees the password.
export function useSignInToClaude() {
  return useClaudeAction("/api/claude/sign-in");
}
