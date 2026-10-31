// Authentication. Two kinds of caller, two kinds of token, and neither works on the other's door:
//   /api/*  the dashboard, with the session token.
//   /mcp    a Claude Code run, with that run's token (ctx.runTokens). The session token is refused here.
// Everything else (the dashboard's own files) needs no token: they hold no personal data.
// Threats stopped: a run reaching Approve; another program on this computer calling the API.
// Spec: ARCHITECTURE.md sections 9 and 11 (auth); tech spec "Local HTTP API and authentication".
import type { MiddlewareHandler } from "hono";
import type { ServerContext } from "../../context";
import { readBearerToken, tokensMatch } from "../../auth/tokens";
import { apiError } from "../errorHandler";

// What the /mcp route can read with c.get("runId") once this middleware has let a request through.
export type AuthVariables = { runId: string };

const UNAUTHORIZED = apiError(
  "unauthorized",
  "Jobgoblin did not recognise this request.",
  "Close Jobgoblin and open it again.",
);

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function auth(ctx: ServerContext): MiddlewareHandler<{ Variables: Partial<AuthVariables> }> {
  return async (c, next) => {
    const path = c.req.path;
    const token = readBearerToken(c.req.header("authorization"));

    if (isUnder(path, "/api")) {
      if (token === null || !tokensMatch(token, ctx.sessionToken)) return c.json(UNAUTHORIZED, 401);
    } else if (isUnder(path, "/mcp")) {
      const runId = token === null ? null : ctx.runTokens.runIdFor(token);
      if (runId === null) return c.json(UNAUTHORIZED, 401);
      c.set("runId", runId);
    }
    await next();
  };
}
