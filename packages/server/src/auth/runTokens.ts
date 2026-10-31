// Run tokens: one secret per run, handed to the Claude Code process through its environment and accepted
// only at /mcp. The registry is in memory, so a restart invalidates every token (a run does not survive
// a restart anyway). The session token never works at /mcp, and a run token never works at /api.
// Spec: ARCHITECTURE.md section 9 and tech spec "Local HTTP API and authentication".
import { createRunToken, tokensMatch } from "./tokens";

export type RunTokens = {
  // Makes a new token for the run. Any earlier token of the same run stops working.
  issue(runId: string): string;
  // Called when the run ends: its token stops working at once.
  revoke(runId: string): void;
  // The run this token belongs to, or null for an unknown or revoked token.
  runIdFor(token: string): string | null;
};

export function createRunTokens(): RunTokens {
  const tokenByRunId = new Map<string, string>();

  return {
    issue(runId) {
      const token = createRunToken();
      tokenByRunId.set(runId, token);
      return token;
    },

    revoke(runId) {
      tokenByRunId.delete(runId);
    },

    runIdFor(token) {
      // Every stored token is compared, with the same cost each time. There are at most a couple of runs,
      // so this is cheaper to reason about than a lookup keyed by the secret itself.
      let found: string | null = null;
      for (const [runId, storedToken] of tokenByRunId) {
        if (tokensMatch(token, storedToken)) found = runId;
      }
      return found;
    },
  };
}
