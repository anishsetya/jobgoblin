// Table `answers`: the screening answers an answers run writes after the person approves an application.
// Personal values stay as {placeholders} here; code fills them in only when it writes Answers.md.
// Spec: ARCHITECTURE.md sections 5.7 and 9 (save_answers).
import { Answer } from "@jobgoblin/schemas";
import { atomically, type Database } from "../database";

// Saves the full set of answers for an application, replacing any earlier set, in the order given.
// A question that appears twice keeps its last answer.
export function replaceAnswers(db: Database, applicationId: string, answers: readonly Answer[], savedAt: string): void {
  const validAnswers = answers.map((answer) => Answer.parse(answer));

  atomically(db, () => {
    db.sqlite.prepare("DELETE FROM answers WHERE application_id = ?").run(applicationId);
    const insert = db.sqlite.prepare(
      `INSERT INTO answers (application_id, question, answer, saved_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (application_id, question) DO UPDATE SET answer = excluded.answer, saved_at = excluded.saved_at`,
    );
    for (const answer of validAnswers) {
      insert.run(applicationId, answer.question, answer.answer, savedAt);
    }
  });
}

// The application's answers in the order they were saved.
export function listAnswers(db: Database, applicationId: string): Answer[] {
  const rows = db.sqlite
    .prepare("SELECT question, answer FROM answers WHERE application_id = ? ORDER BY rowid")
    .all(applicationId);
  return rows.map((row) => Answer.parse({ question: row.question, answer: row.answer }));
}
