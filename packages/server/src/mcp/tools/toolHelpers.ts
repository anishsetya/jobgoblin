// Small helpers the tool files share: building a ToolReply, and the rule that a run only touches its own work.
// Spec: ARCHITECTURE.md section 9; packages/server/README.md ("The services behind the 21 MCP tools").
import type { ToolReply } from "@jobgoblin/schemas";
import { assertApplicationInRun } from "../../services/runTasks";
import { conflict, type Outcome } from "../../services/serviceError";
import type { ToolCall } from "./defineTool";

export function succeededWith<T>(data: T, next: string | null): ToolReply<T> {
  return { ok: true, data, next };
}

// A service that can refuse in a way the run can fix returns an Outcome. Its value or its errors become the
// reply as they are, so the run gets every problem at once. `next` says what to do in each case.
export function replyFromOutcome<T>(outcome: Outcome<T>, nextWhenOk: string | null, nextWhenRefused: string | null): ToolReply<T> {
  if (outcome.ok) return { ok: true, data: outcome.value, next: nextWhenOk };
  return { ok: false, errors: outcome.errors, next: nextWhenRefused };
}

// Threat stopped: one run reaching into another's work. A tailor or answers run may only touch the applications
// in its own queue; a paste run only the one in its input. Throws a ServiceError, which the tool turns into ok:false.
export function assertRunMayUseApplication(call: ToolCall, applicationId: string): void {
  if (call.run.kind === "paste") {
    if (call.run.input.applicationId !== applicationId) {
      throw conflict("not-in-this-run", "That application is not the one this run is about.", "Use the application named in your input.");
    }
    return;
  }
  assertApplicationInRun(call.ctx, call.run.id, applicationId);
}
