// Questions between a run and the person. A run asks one question about one application (ask_person); it
// never changes the application's status (decision D17): the run skips that application and the question
// shows in Needs you. When the person answers, that one application goes back in the queue (decision D8):
// it joins a queued run of the same kind, or a new run is queued. There is no resuming of the old session.
// Spec: ARCHITECTURE.md decisions D8 and D17; section 9 (ask_person).
import type { AskPersonOutput, Question } from "@jobgoblin/schemas";
import {
  saveQuestionAnswer,
  getQuestion,
  hasOpenQuestion,
  insertQuestion,
  listRunTasks,
  newId,
  setRunTaskState,
  updateRun,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { OUTCOME_MESSAGES } from "../runner/outcome";
import { announceApplication, announceRun } from "./changes";
import { recordHistory } from "./history";
import { loadApplicationOrFail, loadRunOrFail } from "./loaders";
import { announceQueuedRun, insertQueuedRun } from "./runs";
import { conflict, failed, notFound, succeeded, type Outcome } from "./serviceError";

// Only these runs may ask (the tool is not offered to the others).
const KINDS_THAT_MAY_ASK = ["paste", "tailor", "answers"];

export function askPerson(
  ctx: ServerContext,
  request: { runId: string; applicationId: string; question: string },
): Outcome<AskPersonOutput> {
  const run = loadRunOrFail(ctx, request.runId);
  const application = loadApplicationOrFail(ctx, request.applicationId);
  if (!KINDS_THAT_MAY_ASK.includes(run.kind)) {
    return failed([{ code: "may-not-ask", message: "This kind of run cannot ask the person a question." }]);
  }
  if (hasOpenQuestion(ctx.db, application.id)) {
    return failed([
      {
        code: "question-open",
        message: "This application already has a question waiting for the person. Move on to the next application.",
      },
    ]);
  }

  const question: Question = {
    id: newId(),
    runId: run.id,
    runKind: run.kind,
    applicationId: application.id,
    text: request.question,
    answer: null,
    askedAt: ctx.now().toISOString(),
    answeredAt: null,
  };
  ctx.db.transaction(() => {
    insertQuestion(ctx.db, question);
    recordHistory(ctx, { applicationId: application.id, actor: "run", type: "question-asked", detail: request.question });
  });
  announceApplication(ctx, application.id);
  return succeeded({ questionId: question.id });
}

export function answerQuestion(ctx: ServerContext, questionId: string, answer: string): Question {
  const question = getQuestion(ctx.db, questionId);
  if (question === null) throw notFound("question", "Reload Today and try again.");
  if (question.answer !== null) {
    throw conflict("already-answered", "This question has already been answered.", "Reload Today to see where it stands.");
  }

  const originalRun = loadRunOrFail(ctx, question.runId);
  const result = ctx.db.transaction(() => {
    const answered = saveQuestionAnswer(ctx.db, { id: questionId, answer, answeredAt: ctx.now().toISOString() });
    if (answered === null) throw conflict("already-answered", "This question has already been answered.", "Reload Today.");
    recordHistory(ctx, { applicationId: question.applicationId, actor: "person", type: "question-answered" });

    releaseFromOriginalRun(ctx, originalRun.id, question.applicationId);
    // The same input and model, so an edit note given with the first run still reaches the new one and a
    // tailor retry that had already moved up to sonnet does not fall back to haiku. A paste run has no tasks.
    const newRun = insertQueuedRun(ctx, {
      kind: question.runKind,
      applicationIds: question.runKind === "paste" ? [] : [question.applicationId],
      input: originalRun.input,
      model: originalRun.model,
    });
    return { answered, newRun };
  });

  announceApplication(ctx, question.applicationId);
  announceRun(ctx, loadRunOrFail(ctx, originalRun.id));
  announceQueuedRun(ctx, result.newRun);
  return result.answered;
}

// The old run no longer holds the application: its task is finished ("continued in a new run"), and a run
// that was only waiting for this answer is done.
function releaseFromOriginalRun(ctx: ServerContext, runId: string, applicationId: string): void {
  setRunTaskState(ctx.db, {
    runId,
    applicationId,
    state: "done",
    note: "Answered. Continued in a new run.",
  });

  const run = loadRunOrFail(ctx, runId);
  const stillWaiting = listRunTasks(ctx.db, runId).some((task) => task.state === "waiting" || task.state === "pending");
  if (run.status === "waiting" && !stillWaiting) {
    updateRun(ctx.db, runId, { status: "done", outcomeMessage: OUTCOME_MESSAGES.finishedAfterAnswer });
  }
}
