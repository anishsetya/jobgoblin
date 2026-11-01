// Round trips for questions and the history log.
import { afterEach, describe, expect, it } from "vitest";
import { aHistoryEvent, aRun, anApplicationInDatabase, openTestDatabase, removeTempDirs } from "../testSupport";
import { countStatusChangesSince, insertHistoryEvent, listHistoryEvents } from "./historyEvents";
import {
  saveQuestionAnswer,
  getQuestion,
  hasOpenQuestion,
  insertQuestion,
  listOpenQuestions,
  listQuestionsForApplication,
} from "./questions";
import { insertRun } from "./runs";

afterEach(removeTempDirs);

const aQuestion = (id: string, applicationId: string, askedAt: string) => ({
  id,
  runId: "run-1",
  runKind: "tailor" as const,
  applicationId,
  text: "Which city do you prefer?",
  answer: null,
  askedAt,
  answeredAt: null,
});

function setUp(db: ReturnType<typeof openTestDatabase>): void {
  anApplicationInDatabase(db, { id: "app-1", jobId: "greenhouse:acme:1" });
  anApplicationInDatabase(db, { id: "app-2", jobId: "greenhouse:acme:2" });
  insertRun(db, aRun(), ["app-1", "app-2"]);
}

describe("questions", () => {
  it("saves a question and reads it back unchanged", () => {
    const db = openTestDatabase();
    setUp(db);
    const question = aQuestion("q-1", "app-1", "2026-10-31T14:06:00.000Z");

    insertQuestion(db, question);

    expect(getQuestion(db, "q-1")).toEqual(question);
    expect(getQuestion(db, "nothing")).toBeNull();
    db.close();
  });

  it("lists the open questions oldest first and drops a question once it is answered", () => {
    const db = openTestDatabase();
    setUp(db);
    insertQuestion(db, aQuestion("q-late", "app-2", "2026-10-31T16:00:00.000Z"));
    insertQuestion(db, aQuestion("q-early", "app-1", "2026-10-31T14:00:00.000Z"));
    expect(listOpenQuestions(db).map((question) => question.id)).toEqual(["q-early", "q-late"]);
    expect(hasOpenQuestion(db, "app-1")).toBe(true);

    const answered = saveQuestionAnswer(db, { id: "q-early", answer: "Austin", answeredAt: "2026-10-31T17:00:00.000Z" });

    expect(answered).toMatchObject({ answer: "Austin", answeredAt: "2026-10-31T17:00:00.000Z" });
    expect(listOpenQuestions(db).map((question) => question.id)).toEqual(["q-late"]);
    expect(hasOpenQuestion(db, "app-1")).toBe(false);
    db.close();
  });

  it("keeps the first answer when a question is answered twice", () => {
    const db = openTestDatabase();
    setUp(db);
    insertQuestion(db, aQuestion("q-1", "app-1", "2026-10-31T14:00:00.000Z"));
    saveQuestionAnswer(db, { id: "q-1", answer: "Austin", answeredAt: "2026-10-31T17:00:00.000Z" });

    const secondAnswer = saveQuestionAnswer(db, { id: "q-1", answer: "Boston", answeredAt: "2026-10-31T18:00:00.000Z" });

    expect(secondAnswer).toBeNull();
    expect(getQuestion(db, "q-1")?.answer).toBe("Austin");
    db.close();
  });

  it("lists every question about one application, answered or not", () => {
    const db = openTestDatabase();
    setUp(db);
    insertQuestion(db, aQuestion("q-1", "app-1", "2026-10-31T14:00:00.000Z"));
    insertQuestion(db, aQuestion("q-2", "app-2", "2026-10-31T15:00:00.000Z"));
    saveQuestionAnswer(db, { id: "q-1", answer: "Austin", answeredAt: "2026-10-31T17:00:00.000Z" });

    expect(listQuestionsForApplication(db, "app-1").map((question) => question.id)).toEqual(["q-1"]);
    db.close();
  });
});

describe("history events", () => {
  it("saves events and lists one application's history oldest first", () => {
    const db = openTestDatabase();
    setUp(db);
    insertHistoryEvent(db, aHistoryEvent({ id: "e-2", ts: "2026-10-31T15:00:00.000Z", detail: "second" }));
    insertHistoryEvent(db, aHistoryEvent({ id: "e-1", ts: "2026-10-31T14:00:00.000Z", detail: "first" }));
    insertHistoryEvent(db, aHistoryEvent({ id: "e-3", applicationId: "app-2", detail: "other application" }));

    const history = listHistoryEvents(db, "app-1");

    expect(history.map((event) => event.detail)).toEqual(["first", "second"]);
    db.close();
  });

  it("refuses an event whose type is not in the closed list", () => {
    const db = openTestDatabase();
    setUp(db);

    const insertUnknownType = () => insertHistoryEvent(db, aHistoryEvent({ type: "mystery" as never }));

    expect(insertUnknownType).toThrow();
    db.close();
  });

  it("counts the moves into a status since a time, whatever type of event logged them", () => {
    const db = openTestDatabase();
    setUp(db);
    insertHistoryEvent(db, aHistoryEvent({ id: "e-1", type: "approved", from: "Awaiting approval", to: "Approved", ts: "2026-10-31T10:00:00.000Z" }));
    insertHistoryEvent(db, aHistoryEvent({ id: "e-2", type: "status-changed", from: "Awaiting approval", to: "Approved", ts: "2026-10-30T10:00:00.000Z" }));
    insertHistoryEvent(db, aHistoryEvent({ id: "e-3", type: "status-changed", from: "Found", to: "Scored", ts: "2026-10-31T11:00:00.000Z" }));

    const approvedToday = countStatusChangesSince(db, "Approved", "2026-10-31T00:00:00.000Z");

    expect(approvedToday).toBe(1);
    db.close();
  });
});
