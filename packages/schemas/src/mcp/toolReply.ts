// The reply every MCP tool returns: either the tool's data, or a list of problems the run can act on.
// Spec: ARCHITECTURE.md sections 5.11 and 9.
import { z } from "zod";

// One problem, in plain words a run can act on. `path` says where, when the problem is in a part of
// the input (a ResumeCheckError fits this shape, so resume errors are returned as they are).
export const ToolError = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
});
export type ToolError = z.infer<typeof ToolError>;

// Every tool replies with this, as JSON text. `next` names the call the run should make next, so it
// stays on its playbook; null when there is nothing more to do. Problems the run can fix (such as a
// resume that fails the truth trace) come back as ok: false with every error at once; they are values,
// not exceptions.
export type ToolReply<T> =
  | { ok: true; data: T; next: string | null }
  | { ok: false; errors: ToolError[]; next: string | null };
