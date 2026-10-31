// The fake's side of the conversation with the Jobgoblin server: reads --mcp-config, connects to /mcp
// with the run token, and calls one tool at a time. Everything that comes back is checked with the tool's
// own output schema, so a server that answers in a shape the schemas do not allow fails the run loudly.
// Spec: ARCHITECTURE.md sections 9 (the endpoint and ToolReply) and 10 (step 3, mcp.json).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolError } from "@jobgoblin/schemas";
import type { ToolReply } from "@jobgoblin/schemas";
import { z } from "zod";
import { FAKE_CLAUDE_VERSION } from "./version";
import { TOOL_SCHEMAS } from "./toolSchemas";
import type { ToolInput, ToolName, ToolOutput } from "./toolSchemas";

export type McpConnection = {
  callTool<Name extends ToolName>(name: Name, input: ToolInput<Name>): Promise<ToolReply<ToolOutput<Name>>>;
  close(): Promise<void>;
};

const JobgoblinServerConfig = z.object({
  type: z.literal("http"),
  url: z.url(),
  headers: z.record(z.string(), z.string()).default({}),
});
type JobgoblinServerConfig = z.infer<typeof JobgoblinServerConfig>;

// The part of mcp.json that matters: the "jobgoblin" server. Other servers in the file are ignored.
const McpConfigFile = z.object({
  mcpServers: z.object({ jobgoblin: JobgoblinServerConfig }),
});

// A header value such as "Bearer ${JOBGOBLIN_RUN_TOKEN}": the token is in the environment, not in the file.
const ENVIRONMENT_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export async function connectToJobgoblin(configPath: string, env: NodeJS.ProcessEnv): Promise<McpConnection> {
  const server = readJobgoblinServerConfig(configPath);
  const headers = expandHeaders(server.headers, env);

  const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } });
  const client = new Client({ name: "fake-claude", version: FAKE_CLAUDE_VERSION });
  await client.connect(transport);

  return {
    async callTool(name, input) {
      const validInput = TOOL_SCHEMAS[name].input.parse(input); // a broken script fails here, not at the server
      const result = await client.callTool({ name, arguments: validInput as Record<string, unknown> });
      return parseToolReply(name, result);
    },
    close: () => client.close(),
  };
}

// The path is relative to the current directory: the runner starts the fake inside the run directory.
function readJobgoblinServerConfig(configPath: string): JobgoblinServerConfig {
  const absolutePath = resolve(process.cwd(), configPath);
  const raw: unknown = JSON.parse(readFileSync(absolutePath, "utf8"));
  return McpConfigFile.parse(raw).mcpServers.jobgoblin;
}

function expandHeaders(headers: Record<string, string>, env: NodeJS.ProcessEnv): Record<string, string> {
  const expanded: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    expanded[name] = expandEnvironmentReferences(value, env);
  }
  return expanded;
}

function expandEnvironmentReferences(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(ENVIRONMENT_REFERENCE, (_reference, variableName: string) => {
    const variableValue = env[variableName];
    if (variableValue === undefined) {
      throw new Error(`mcp.json uses \${${variableName}}, but ${variableName} is not set in the environment.`);
    }
    return variableValue;
  });
}

// What the SDK hands back for a tool call, narrowed to the one thing the fake reads: content[0].text.
const ToolCallResult = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).min(1),
  isError: z.boolean().optional(),
});

// The text of every reply is a ToolReply as JSON: { ok, data, next } or { ok, errors, next }.
const ToolReplyEnvelope = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown(), next: z.string().nullable() }),
  z.object({ ok: z.literal(false), errors: z.array(ToolError), next: z.string().nullable() }),
]);

function parseToolReply<Name extends ToolName>(name: Name, result: unknown): ToolReply<ToolOutput<Name>> {
  const { content } = ToolCallResult.parse(result);
  const text = content[0]?.text ?? "";

  const reply = parseReplyEnvelope(name, text);
  if (!reply.ok) return reply;

  const checked = TOOL_SCHEMAS[name].output.safeParse(reply.data);
  if (!checked.success) {
    throw new Error(`The reply from ${name} does not match its output schema:\n${z.prettifyError(checked.error)}`);
  }
  // The schema was looked up by `name`, so its output is exactly ToolOutput<Name>; TypeScript cannot see that.
  return { ok: true, data: checked.data as ToolOutput<Name>, next: reply.next };
}

function parseReplyEnvelope(name: string, text: string): z.infer<typeof ToolReplyEnvelope> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON: the MCP layer itself refused the call (an unknown tool, or an input it could not read).
    throw new Error(`The server refused ${name}: ${text}`);
  }

  const envelope = ToolReplyEnvelope.safeParse(json);
  if (!envelope.success) {
    throw new Error(`The reply from ${name} is not a ToolReply:\n${z.prettifyError(envelope.error)}`);
  }
  return envelope.data;
}
