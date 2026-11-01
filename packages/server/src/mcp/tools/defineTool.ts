// The one place that turns a tool's few lines into a registered MCP tool, so each tool file is only: a name, the
// input and output schemas, and one call to a service. Around every call this helper
//   1. shows the run's step on its card ("Checking every bullet against your profile") and announces the run,
//   2. runs the adapter, and removes any key the output schema does not list (so a service can never leak a field),
//   3. turns a refusal (ServiceError) or an unexpected error into an ok:false ToolReply instead of an exception,
//   4. returns the ToolReply as JSON text in content[0].text.
// Spec: ARCHITECTURE.md section 9 ("Every tool parses its input, calls a service, returns ToolReply as JSON").
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { stepForTool } from "@jobgoblin/core";
import type { McpToolName, Run, ToolReply } from "@jobgoblin/schemas";
import { updateRun } from "@jobgoblin/storage";
import type { z } from "zod";
import type { ServerContext } from "../../context";
import { announceRun } from "../../services/changes";
import { ServiceError, toToolError } from "../../services/serviceError";

// What a tool adapter is given: the server's context and the run that is calling (found from its token).
export type ToolCall = { ctx: ServerContext; run: Run };

export type ToolSpec<Input extends z.ZodType, Output extends z.ZodType> = {
  name: McpToolName;
  description: string; // what the tool is for, in the words Claude reads when it picks a tool
  input: Input;
  output: Output; // the `data` of a successful reply; keys it does not list are removed
  readOnly: boolean; // true when the tool only reads, so Claude Code can treat it as safe
  handle(call: ToolCall, input: z.infer<Input>): ToolReply<z.infer<Output>> | Promise<ToolReply<z.infer<Output>>>;
};

// A tool with its types erased, so tools of different shapes can sit in one list.
export type ToolDefinition = { name: McpToolName; register(server: McpServer, call: ToolCall): void };

export function defineTool<Input extends z.ZodType, Output extends z.ZodType>(spec: ToolSpec<Input, Output>): ToolDefinition {
  return {
    name: spec.name,
    register(server, call) {
      // The SDK works out the callback's argument type from the schema's type, which it cannot do for a schema
      // that is a type parameter here. Every input schema is an object schema, so that is the type it is given.
      const inputSchema = spec.input as unknown as z.ZodObject;
      server.registerTool(
        spec.name,
        { description: spec.description, inputSchema, annotations: { readOnlyHint: spec.readOnly } },
        async (input: unknown) => {
          showStep(call, spec.name);
          // The SDK has already checked the input against spec.input, so this is the schema's own type.
          const reply = await answer(call, spec, input as z.infer<Input>);
          return { content: [{ type: "text" as const, text: JSON.stringify(reply) }] };
        },
      );
    },
  };
}

// Set before the call, not after: submit_resume_draft takes a few seconds to render, and the card should
// already say what is happening.
function showStep(call: ToolCall, name: McpToolName): void {
  const run = updateRun(call.ctx.db, call.run.id, { step: stepForTool(name) });
  if (run !== null) announceRun(call.ctx, run);
}

async function answer<Input extends z.ZodType, Output extends z.ZodType>(
  call: ToolCall,
  spec: ToolSpec<Input, Output>,
  input: z.infer<Input>,
): Promise<ToolReply<unknown>> {
  try {
    const reply = await spec.handle(call, input);
    if (!reply.ok) return reply;
    return { ok: true, data: spec.output.parse(reply.data), next: reply.next };
  } catch (error) {
    return replyForThrownError(call, spec.name, error);
  }
}

function replyForThrownError(call: ToolCall, name: McpToolName, error: unknown): ToolReply<never> {
  const next = nextAfterRefusal(call.run);
  if (error instanceof ServiceError) return { ok: false, errors: [toToolError(error)], next };

  // Never swallowed: the full error goes to the log. The run sees only calm words (no paths, no personal values).
  call.ctx.logger.error({ err: error, tool: name, runId: call.run.id }, "A tool call failed unexpectedly.");
  return {
    ok: false,
    errors: [{ code: "internal-error", message: "Something went wrong inside Jobgoblin. Move on to the next step." }],
    next,
  };
}

// A run that works through a queue should report the application it could not finish and carry on.
function nextAfterRefusal(run: Run): string {
  if (run.kind === "tailor" || run.kind === "answers") {
    return "If you cannot fix this, call complete_task with outcome failed and a short note, then call next_task.";
  }
  return "Read the problem above. If you cannot fix it, carry on with the rest of your playbook.";
}
