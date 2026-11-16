// The answers run, scripted: what the fake saves for a job with screening questions and what it does for a
// job with none. With FAKE_CLAUDE_NO_QUESTIONS=1 it follows playbooks/answers.md (save nothing, complete the
// task as done with "No screening questions"); without the switch it answers one made-up question.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GetApprovedOutput } from "@jobgoblin/schemas";
import { assertBuiltCliIsCurrent } from "./builtCli";
import { aPlaybook, runScriptedRun } from "./runFakeClaude";
import { ok, startStubServer } from "./stubJobgoblinServer";
import type { RecordedCall, StubServer } from "./stubJobgoblinServer";

const ANSWERS_PLAYBOOK = aPlaybook("answers");

function anApprovedApplication(questions: string[]): GetApprovedOutput {
  return {
    application: { id: "app-1", company: "Acme Cloud", title: "Backend Engineer" },
    jobSummary: "Backend Engineer at Acme Cloud.",
    questions,
    dataSheet: {
      applicationId: "app-1",
      region: "US",
      fields: [
        { key: "requiresSponsorship", label: "Needs visa sponsorship", value: "No", personal: false, required: false, missing: false },
      ],
      resumeVersion: `r-${"a".repeat(64)}`,
      resumeFileName: "Alex Rivera - Resume.pdf",
    },
    answeredQuestions: [],
  };
}

describe("the fake claude's answers run", () => {
  let server: StubServer;

  beforeAll(assertBuiltCliIsCurrent);
  afterEach(() => server.close());

  // A queue with one application in it, for a job with these screening questions.
  async function startServer(questions: string[]): Promise<StubServer> {
    let tasksHandedOut = 0;
    server = await startStubServer({
      next_task: () => {
        tasksHandedOut += 1;
        return ok({ applicationId: tasksHandedOut === 1 ? "app-1" : null });
      },
      get_approved: () => ok(anApprovedApplication(questions)),
      save_answers: (input) => ok({ saved: input.answers.length }),
      complete_task: () => ok({ done: 1, total: 1 }),
    });
    return server;
  }

  function callsTo(tool: RecordedCall["tool"]): unknown[] {
    return server.calls.filter((call) => call.tool === tool).map((call) => call.input);
  }

  it("with FAKE_CLAUDE_NO_QUESTIONS=1, saves nothing for a job with no questions and says so when it completes the task", async () => {
    await startServer([]);

    const run = await runScriptedRun({ playbook: ANSWERS_PLAYBOOK, server, env: { FAKE_CLAUDE_NO_QUESTIONS: "1" } });

    expect(server.calls.map((call) => call.tool)).toEqual(["next_task", "get_approved", "complete_task", "next_task"]);
    expect(callsTo("complete_task")).toEqual([{ applicationId: "app-1", outcome: "done", note: "No screening questions" }]);
    expect(run.result).toMatchObject({ subtype: "success", is_error: false });
  });

  it("with FAKE_CLAUDE_NO_QUESTIONS=1, still answers every question of a job that has some", async () => {
    await startServer(["Do you need visa sponsorship?"]);

    await runScriptedRun({ playbook: ANSWERS_PLAYBOOK, server, env: { FAKE_CLAUDE_NO_QUESTIONS: "1" } });

    expect(callsTo("save_answers")).toEqual([
      { applicationId: "app-1", answers: [{ question: "Do you need visa sponsorship?", answer: "No" }] },
    ]);
    expect(callsTo("complete_task")).toEqual([{ applicationId: "app-1", outcome: "done" }]);
  });

  it("without the switch, answers one made-up question for a job with none, so the stories that copy an answer have one", async () => {
    await startServer([]);

    await runScriptedRun({ playbook: ANSWERS_PLAYBOOK, server });

    expect(callsTo("save_answers")).toEqual([
      {
        applicationId: "app-1",
        answers: [{ question: "Why are you interested in this role?", answer: expect.stringContaining("{firstName}") }],
      },
    ]);
  });
});
