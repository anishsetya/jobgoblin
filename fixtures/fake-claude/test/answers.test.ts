// A scripted answers run against a stub server: it answers from the data sheet and keeps personal values
// as placeholders, because the real server never lets a run see them.
import { RUN_KIND_TOOLS } from "@jobgoblin/schemas";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { aDataSheet } from "./aDemoPerson";
import { assertBuiltCliIsCurrent } from "./builtCli";
import { aPlaybook, runScriptedRun } from "./runFakeClaude";
import { inputsOf, ok, startStubServer } from "./stubJobgoblinServer";
import type { StubServer } from "./stubJobgoblinServer";

const ANSWERS_ALLOWED_TOOLS = RUN_KIND_TOOLS.answers.map((tool) => `mcp__jobgoblin__${tool}`);

const SCREENING_QUESTIONS = [
  "Will you now or in the future require visa sponsorship?",
  "What are your salary expectations?",
  "Are you willing to relocate?",
  "What is your notice period?",
  "Why do you want to work at Acme Cloud?",
];

describe("a scripted answers run", () => {
  let server: StubServer;

  beforeAll(assertBuiltCliIsCurrent);
  afterEach(() => server.close());

  async function runAnswers(env: Record<string, string> = {}) {
    const queue = ["app-1"];
    server = await startStubServer({
      next_task: () => ok({ applicationId: queue.shift() ?? null }),
      get_approved: (input) =>
        ok({
          application: { id: input.applicationId, company: "Acme Cloud", title: "Backend Engineer" },
          jobSummary: "A backend role.",
          questions: SCREENING_QUESTIONS,
          dataSheet: aDataSheet(input.applicationId),
          answeredQuestions: [],
        }),
      save_answers: (input) => ok({ saved: input.answers.length }),
      ask_person: () => ok({ questionId: "question-1" }),
      complete_task: () => ok({ done: 1, total: 1 }),
    });

    return runScriptedRun({ playbook: aPlaybook("answers"), server, env, allowedTools: ANSWERS_ALLOWED_TOOLS });
  }

  it("reads the approved application, saves its answers and completes the task", async () => {
    const run = await runAnswers();

    expect(run.toolUses.map((toolUse) => toolUse.name)).toEqual([
      "next_task", "get_approved", "save_answers", "complete_task", "next_task",
    ]);
    expect(inputsOf(server, "complete_task")).toEqual([{ applicationId: "app-1", outcome: "done" }]);
    expect(run.result).toMatchObject({ subtype: "success", is_error: false });
  });

  it("answers every question, from the data sheet where it can", async () => {
    await runAnswers();
    const [saved] = inputsOf(server, "save_answers");
    const answerTo = (question: string) => saved?.answers.find((answer) => answer.question === question)?.answer;

    expect(saved?.answers.map((answer) => answer.question)).toEqual(SCREENING_QUESTIONS);
    expect(answerTo("Will you now or in the future require visa sponsorship?")).toBe("No");
    expect(answerTo("Are you willing to relocate?")).toBe("Yes");
    expect(answerTo("What is your notice period?")).toBe("2 weeks");
    expect(answerTo("Why do you want to work at Acme Cloud?")).toContain("Backend Engineer role at Acme Cloud");
  });

  it("keeps personal values as placeholders and never sends a real one", async () => {
    await runAnswers();
    const [saved] = inputsOf(server, "save_answers");

    expect(saved?.answers.find((answer) => answer.question.includes("salary"))?.answer).toBe("{expectedBase}");
    expect(JSON.stringify(saved)).toContain("{firstName}");
    expect(JSON.stringify(server.calls)).not.toMatch(/alex\.rivera@example\.com|555 0100/);
  });

  it("with FAKE_CLAUDE_ASK_FIRST=1, asks before answering and completes the task as waiting", async () => {
    const run = await runAnswers({ FAKE_CLAUDE_ASK_FIRST: "1" });

    expect(run.toolUses.map((toolUse) => toolUse.name)).toEqual([
      "next_task", "get_approved", "ask_person", "complete_task", "next_task",
    ]);
    expect(inputsOf(server, "complete_task")[0]?.outcome).toBe("waiting");
    expect(inputsOf(server, "save_answers")).toEqual([]);
  });
});
