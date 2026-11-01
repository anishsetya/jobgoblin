// Table `questions`: what a run asked the person about one application, and the answer once they give it.
// An open question never changes an application's status (decision D17); it only pauses that
// application's task and puts an item in Needs you.
// Spec: ARCHITECTURE.md sections 5.8 and 8.
import { Question } from "@jobgoblin/schemas";
import type { Database } from "../database";
import type { Row } from "../rows";

function toQuestion(row: Row): Question {
  return Question.parse({
    id: row.id,
    runId: row.run_id,
    runKind: row.run_kind,
    applicationId: row.application_id,
    text: row.text,
    answer: row.answer,
    askedAt: row.asked_at,
    answeredAt: row.answered_at,
  });
}

export function insertQuestion(db: Database, question: Question): void {
  const valid = Question.parse(question);
  db.sqlite
    .prepare(
      `INSERT INTO questions (id, run_id, run_kind, application_id, text, answer, asked_at, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(valid.id, valid.runId, valid.runKind, valid.applicationId, valid.text, valid.answer, valid.askedAt, valid.answeredAt);
}

export function getQuestion(db: Database, id: string): Question | null {
  const row = db.sqlite.prepare("SELECT * FROM questions WHERE id = ?").get(id);
  return row === undefined ? null : toQuestion(row);
}

// Stores the person's answer to a question that is still open. Returns the question, or null when there
// is no such question or it was already answered (the first answer stands).
export function saveQuestionAnswer(db: Database, input: { id: string; answer: string; answeredAt: string }): Question | null {
  const result = db.sqlite
    .prepare("UPDATE questions SET answer = ?, answered_at = ? WHERE id = ? AND answer IS NULL")
    .run(input.answer, input.answeredAt, input.id);
  if (result.changes === 0) return null;
  return getQuestion(db, input.id);
}

// Every question waiting for the person, oldest first.
export function listOpenQuestions(db: Database): Question[] {
  const rows = db.sqlite.prepare("SELECT * FROM questions WHERE answer IS NULL ORDER BY asked_at, rowid").all();
  return rows.map(toQuestion);
}

// All questions about one application, answered or not, oldest first.
export function listQuestionsForApplication(db: Database, applicationId: string): Question[] {
  const rows = db.sqlite
    .prepare("SELECT * FROM questions WHERE application_id = ? ORDER BY asked_at, rowid")
    .all(applicationId);
  return rows.map(toQuestion);
}

export function hasOpenQuestion(db: Database, applicationId: string): boolean {
  const row = db.sqlite
    .prepare("SELECT 1 AS found FROM questions WHERE application_id = ? AND answer IS NULL LIMIT 1")
    .get(applicationId);
  return row !== undefined;
}
