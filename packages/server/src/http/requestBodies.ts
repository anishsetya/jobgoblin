// The small request bodies that have no schema in @jobgoblin/schemas (they are one or two fields each).
// Messages are written in plain words, as custom checks, so the error handler can show them as they are.
import { z } from "zod";

function nonEmptyText(message: string): z.ZodType<string> {
  return z.string().refine((text) => text.trim() !== "", message).transform((text) => text.trim());
}

export const NoteBody = z.object({ note: nonEmptyText("Say what you would like changed.") });
export const OptionalNoteBody = z.object({ note: z.string().optional() });
export const QuestionBody = z.object({ question: nonEmptyText("Type your question.") });
export const AnswerBody = z.object({ answer: nonEmptyText("Type your answer.") });
export const PathBody = z.object({ path: nonEmptyText("Choose a folder or a file.") });
// Settings are checked key by key in the service, because a missing key must stay missing (not become a default).
export const SettingsChangesBody = z.record(z.string(), z.unknown());
