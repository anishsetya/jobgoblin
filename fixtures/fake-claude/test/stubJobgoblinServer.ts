// A tiny stand-in for the Jobgoblin server's /mcp endpoint, for the fake's own tests. It is built like the
// real one (decision section 9): Streamable HTTP in stateless mode, a fresh McpServer for every request,
// a bearer token checked first, and every reply a ToolReply as JSON text. Each test says how the tools it
// needs behave; any tool without a handler does not exist, so a script that calls it fails loudly.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ToolReply } from "@jobgoblin/schemas";
import type { z } from "zod";
import { TOOL_SCHEMAS } from "../src/toolSchemas";
import type { ToolName, ToolOutput } from "../src/toolSchemas";

// What a handler receives: the tool's input after the server parsed it (defaults filled in).
type ParsedInput<Name extends ToolName> = z.output<(typeof TOOL_SCHEMAS)[Name]["input"]>;
type Handler<Name extends ToolName> = (input: ParsedInput<Name>) => ToolReply<ToolOutput<Name>>;
export type ToolHandlers = { [Name in ToolName]?: Handler<Name> };

export type RecordedCall = { tool: ToolName; input: unknown };

export type StubServer = {
  url: string;
  token: string;
  calls: RecordedCall[]; // every tool call, in order
  authorizationHeaders: (string | undefined)[]; // the Authorization header of every HTTP request
  close(): Promise<void>;
};

export function ok<T>(data: T, next: string | null = null): ToolReply<T> {
  return { ok: true, data, next };
}

export async function startStubServer(handlers: ToolHandlers, token = "run-token-for-tests"): Promise<StubServer> {
  const calls: RecordedCall[] = [];
  const authorizationHeaders: (string | undefined)[] = [];

  const httpServer = createServer((request, response) => {
    authorizationHeaders.push(request.headers.authorization);
    answerRequest(request, response, { handlers, token, calls }).catch((error: unknown) => {
      response.writeHead(500).end(String(error));
    });
  });
  await listenOnFreePort(httpServer);

  const { port } = httpServer.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    calls,
    authorizationHeaders,
    close: () => closeServer(httpServer),
  };
}

type RequestContext = { handlers: ToolHandlers; token: string; calls: RecordedCall[] };

async function answerRequest(request: IncomingMessage, response: ServerResponse, context: RequestContext): Promise<void> {
  // The real endpoint answers 401 to an unknown token before it looks at anything else.
  if (request.headers.authorization !== `Bearer ${context.token}`) {
    response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const mcpServer = new McpServer({ name: "stub-jobgoblin", version: "0.0.0" });
  registerHandlers(mcpServer, context);

  // Stateless: no session id, and everything is thrown away when the request ends.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  response.on("close", () => {
    void transport.close();
    void mcpServer.close();
  });
  await mcpServer.connect(transport);
  await transport.handleRequest(request, response);
}

function registerHandlers(mcpServer: McpServer, context: RequestContext): void {
  for (const name of Object.keys(context.handlers) as ToolName[]) {
    const handler = context.handlers[name];
    if (handler === undefined) continue;

    // The handler stored under `name` takes that tool's input; TypeScript cannot follow the key.
    registerTool(mcpServer, name, handler as Handler<ToolName>, context.calls);
  }
}

function registerTool(mcpServer: McpServer, name: ToolName, handler: Handler<ToolName>, calls: RecordedCall[]): void {
  mcpServer.registerTool(
    name,
    // The tool's real input schema, so the stub refuses a bad input exactly as the real server will.
    { description: `Stub of ${name}`, inputSchema: TOOL_SCHEMAS[name].input },
    async (input: unknown) => {
      calls.push({ tool: name, input });
      const reply = handler(input as ParsedInput<ToolName>);
      return { content: [{ type: "text" as const, text: JSON.stringify(reply) }] };
    },
  );
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
