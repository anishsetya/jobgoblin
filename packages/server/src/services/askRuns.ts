// "Ask about this application": the person types a question, an ask run reads the application (read-only
// tools) and answers in plain words. The answer is the run's result text, shown on the application's page.
// Spec: ARCHITECTURE.md section 10 (ask) and decision D20.
import type { AskResult, Run } from "@jobgoblin/schemas";
import { listRunsByStatus } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { loadApplicationOrFail } from "./loaders";
import { queueRun } from "./runs";

export function startAsk(ctx: ServerContext, applicationId: string, question: string): Run {
  loadApplicationOrFail(ctx, applicationId);
  return queueRun(ctx, { kind: "ask", applicationIds: [], input: { applicationId, question } });
}

// Finished ask runs about this application, oldest first.
export function listAskResults(ctx: ServerContext, applicationId: string): AskResult[] {
  const results: AskResult[] = [];
  for (const run of listRunsByStatus(ctx.db, ["done"])) {
    const isAboutThisApplication = run.kind === "ask" && run.input.applicationId === applicationId;
    if (!isAboutThisApplication || run.resultText === null || run.endedAt === null) continue;
    results.push({ question: run.input.question ?? "", answer: run.resultText, at: run.endedAt });
  }
  return results;
}
