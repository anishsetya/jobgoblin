// POST /mcp: the only door a Claude Code run has into Jobgoblin. Streamable HTTP in stateless mode, so every
// request gets its own McpServer and transport, thrown away when the answer is sent. The auth middleware has
// already turned the run token into `runId`; here the run is loaded and must still be running, and the server
// built for it offers only its kind's tools. GET and DELETE (a stream or a session) are refused with 405.
// Replies are plain JSON, not an event stream: every tool answers in one piece.
// Spec: ARCHITECTURE.md section 9.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getRun } from "@jobgoblin/storage";
import type { Run } from "@jobgoblin/schemas";
import { Hono } from "hono";
import type { ServerContext } from "../context";
import type { AppEnv } from "../http/app";
import { apiError } from "../http/errorHandler";
import { UNAUTHORIZED } from "../http/middleware/auth";
import { createRunServer } from "./runServer";

export function mcpRoutes(ctx: ServerContext): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post("/", async (c) => {
    const run = findRunningRun(ctx, c.get("runId"));
    // A token only works while its run is going: a finished, cancelled or unknown run gets the same answer as a wrong token.
    if (run === null) return c.json(UNAUTHORIZED, 401);
    return answerMcpRequest(ctx, run, c.req.raw);
  });

  routes.all("/", (c) =>
    c.json(apiError("method-not-allowed", "The tool endpoint only takes POST.", "Send the call as a POST."), 405, { Allow: "POST" }),
  );
  routes.all("/*", (c) => c.json(apiError("not-found", "Jobgoblin does not have that.", "Check the address and try again."), 404));
  return routes;
}

function findRunningRun(ctx: ServerContext, runId: string | undefined): Run | null {
  if (runId === undefined) return null;
  const run = getRun(ctx.db, runId);
  return run !== null && run.status === "running" ? run : null;
}

async function answerMcpRequest(ctx: ServerContext, run: Run, request: Request): Promise<Response> {
  const server = createRunServer(ctx, run);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close(); // also closes the transport
  }
}
