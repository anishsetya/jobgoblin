// A tiny stand-in for the server's /mcp endpoint, for the runner's integration test. It is built like the real one
// (ARCHITECTURE.md section 9): Streamable HTTP in stateless mode, a fresh McpServer per request, the bearer token
// checked first, and every reply a ToolReply as JSON text. It serves one tool, `next_task`, with an empty queue,
// which is enough for the fake claude to run a tailor run from start to finish.
// The pattern is copied from fixtures/fake-claude/test/stubJobgoblinServer.ts.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { NextTaskInput } from "@jobgoblin/schemas";
import type { NextTaskOutput, ToolReply } from "@jobgoblin/schemas";

export type StubMcpServer = {
  port: number;
  token: string;
  authorizationHeaders: (string | undefined)[]; // the Authorization header of every HTTP request
  toolCalls: string[]; // the name of every tool call, in order
  close(): Promise<void>;
};

export async function startStubMcpServer(token = "run-token-for-tests"): Promise<StubMcpServer> {
  const authorizationHeaders: (string | undefined)[] = [];
  const toolCalls: string[] = [];

  const httpServer = createServer((request, response) => {
    authorizationHeaders.push(request.headers.authorization);
    answerRequest(request, response, { token, toolCalls }).catch((error: unknown) => {
      response.writeHead(500).end(String(error));
    });
  });
  await listenOnFreePort(httpServer);

  const { port } = httpServer.address() as AddressInfo;
  return { port, token, authorizationHeaders, toolCalls, close: () => closeServer(httpServer) };
}

type RequestContext = { token: string; toolCalls: string[] };

async function answerRequest(request: IncomingMessage, response: ServerResponse, context: RequestContext): Promise<void> {
  // The real endpoint answers 401 to an unknown token before it looks at anything else.
  if (request.headers.authorization !== `Bearer ${context.token}`) {
    response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const mcpServer = new McpServer({ name: "stub-jobgoblin", version: "0.0.0" });
  mcpServer.registerTool("next_task", { description: "Stub of next_task", inputSchema: NextTaskInput }, async () => {
    context.toolCalls.push("next_task");
    const reply: ToolReply<NextTaskOutput> = { ok: true, data: { applicationId: null }, next: null };
    return { content: [{ type: "text" as const, text: JSON.stringify(reply) }] };
  });

  // Stateless: no session id, and everything is thrown away when the request ends.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  response.on("close", () => {
    void transport.close();
    void mcpServer.close();
  });
  await mcpServer.connect(transport);
  await transport.handleRequest(request, response);
}

function listenOnFreePort(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections(); // keep-alive connections would otherwise hold the server open
  });
}
