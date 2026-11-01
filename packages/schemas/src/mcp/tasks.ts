// MCP tools for a run's work queue: next_task, complete_task and ask_person (tailor and answers runs; paste
// runs may also ask).
// Spec: ARCHITECTURE.md section 9.
import { z } from "zod";

// next_task: the next application in the run's work queue that has no open question.
export const NextTaskInput = z.object({});
export type NextTaskInput = z.infer<typeof NextTaskInput>;

export const NextTaskOutput = z.object({
  applicationId: z.string().nullable(), // null when the queue is empty
});
export type NextTaskOutput = z.infer<typeof NextTaskOutput>;

// complete_task: report how one application in the queue ended.
// "waiting" means the application now has an open question for the person (after ask_person).
export const TaskOutcome = z.enum(["done", "failed", "waiting"]);
export type TaskOutcome = z.infer<typeof TaskOutcome>;

export const CompleteTaskInput = z.object({
  applicationId: z.string(),
  outcome: TaskOutcome,
  note: z.string().optional().describe("A short plain-words note, especially when the outcome is failed."),
});
export type CompleteTaskInput = z.infer<typeof CompleteTaskInput>;

export const CompleteTaskOutput = z.object({
  done: z.number().int().nonnegative(), // tasks finished so far in this run
  total: z.number().int().nonnegative(), // tasks in this run
});
export type CompleteTaskOutput = z.infer<typeof CompleteTaskOutput>;

// ask_person: ask the person one question about one application. It never changes the application's
// status (decision D17). The reply's `next` tells the run to call complete_task with outcome
// "waiting" and move on to the next application.
export const AskPersonInput = z.object({
  applicationId: z.string(),
  question: z.string().min(1).describe("One question, in plain words, that only the person can answer."),
});
export type AskPersonInput = z.infer<typeof AskPersonInput>;

export const AskPersonOutput = z.object({
  questionId: z.string(),
});
export type AskPersonOutput = z.infer<typeof AskPersonOutput>;
