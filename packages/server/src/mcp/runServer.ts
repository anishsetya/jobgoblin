// Builds the MCP server one request talks to. It offers ONLY the tools of the calling run's kind
// (RUN_KIND_TOOLS): a tool outside the list is not registered, so asking for it by name gets "not found".
// A fresh server is made for every request (stateless mode), so nothing is shared between runs.
// Spec: ARCHITECTURE.md section 9.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RUN_KIND_TOOLS, type Run } from "@jobgoblin/schemas";
import type { ServerContext } from "../context";
import { MCP_SERVER_NAME } from "../runner/runConstants";
import { TOOLS_BY_NAME } from "./tools/allTools";

export function createRunServer(ctx: ServerContext, run: Run): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: "0.1.0" });
  for (const toolName of RUN_KIND_TOOLS[run.kind]) {
    TOOLS_BY_NAME[toolName].register(server, { ctx, run });
  }
  return server;
}
