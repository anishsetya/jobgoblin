// The tools that keep a run on its queue: next_task (which application is next), complete_task (how it ended)
// and ask_person (one question to the person, which never changes the application's status, decision D17).
// A question puts that one application aside: the run reports it as waiting and moves on.
// Spec: ARCHITECTURE.md section 9 (ask_person, next_task, complete_task).
import {
  AskPersonInput,
  AskPersonOutput,
  CompleteTaskInput,
  CompleteTaskOutput,
  NextTaskInput,
  NextTaskOutput,
} from "@jobgoblin/schemas";
import { askPerson } from "../../services/questions";
import { completeTask, nextTask } from "../../services/runTasks";
import { defineTool } from "./defineTool";
import { assertRunMayUseApplication, replyFromOutcome, succeededWith } from "./toolHelpers";

export const nextTaskTool = defineTool({
  name: "next_task",
  description: "Get the next application in your queue, or null when the queue is empty.",
  input: NextTaskInput,
  output: NextTaskOutput,
  readOnly: true,
  handle: ({ ctx, run }) => {
    const task = nextTask(ctx, run.id);
    const next =
      task.applicationId === null
        ? "Your queue is empty. Write your final message."
        : "Work on this application, then call complete_task for it.";
    return succeededWith(task, next);
  },
});

export const completeTaskTool = defineTool({
  name: "complete_task",
  description: "Report how one application in your queue ended: done, failed (with a short note) or waiting (after ask_person).",
  input: CompleteTaskInput,
  output: CompleteTaskOutput,
  readOnly: false,
  handle: ({ ctx, run }, input) =>
    replyFromOutcome(
      completeTask(ctx, { runId: run.id, ...input }),
      "Call next_task for the next application.",
      "Check the applicationId and the outcome, and call complete_task again.",
    ),
});

export const askPersonTool = defineTool({
  name: "ask_person",
  description:
    "Ask the person one plain question about one application, only when you cannot go on without something only they know. Ask once per application.",
  input: AskPersonInput,
  output: AskPersonOutput,
  readOnly: false,
  handle: (call, input) => {
    assertRunMayUseApplication(call, input.applicationId);
    const hasQueue = call.run.kind === "tailor" || call.run.kind === "answers";
    const nextWhenAsked = hasQueue
      ? "Call complete_task for this application with outcome waiting, then call next_task. Do not wait for the answer."
      : "The question is saved. Finish what you can without the answer, then write your final message.";
    return replyFromOutcome(
      askPerson(call.ctx, { runId: call.run.id, ...input }),
      nextWhenAsked,
      "Do not ask again. Carry on with the next application.",
    );
  },
});
