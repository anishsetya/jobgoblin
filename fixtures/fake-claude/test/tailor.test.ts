// Scripted tailor runs against a stub server: the work-queue loop, the draft the fake builds from the
// master resume, the edit note, the repair after a refused draft, and the question to the person.
import type { GetTailoringContextOutput, ResumeBody } from "@jobgoblin/schemas";
import { RUN_KIND_TOOLS } from "@jobgoblin/schemas";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ALEX_STORY_ITEMS, aMasterResume, traceDraftLikeTheServer } from "./aDemoPerson";
import { assertBuiltCliIsCurrent } from "./builtCli";
import { aPlaybook, runScriptedRun } from "./runFakeClaude";
import type { ScriptedRun } from "./runFakeClaude";
import { inputsOf, ok, refused, startStubServer } from "./stubJobgoblinServer";
import type { StubServer, ToolHandlers } from "./stubJobgoblinServer";

const TAILOR_ALLOWED_TOOLS = RUN_KIND_TOOLS.tailor.map((tool) => `mcp__jobgoblin__${tool}`);
const A_VERSION_ID = `r-${"b".repeat(64)}`;

type TailorScenario = {
  applicationIds?: string[];
  editNote?: string | null;
  answeredQuestions?: GetTailoringContextOutput["answeredQuestions"];
  acceptEverything?: boolean; // a broken server that skips the truth trace
};

// The server side of a tailor run: a queue of applications, the master resume, and a truth trace.
function tailorHandlers(scenario: TailorScenario): ToolHandlers {
  const queue = [...(scenario.applicationIds ?? ["app-1", "app-2"])];

  return {
    next_task: () => ok({ applicationId: queue.shift() ?? null }),
    get_tailoring_context: (input) =>
      ok({
        application: { id: input.applicationId, company: "Acme Cloud", title: "Backend Engineer" },
        master: aMasterResume(),
        storyItems: ALEX_STORY_ITEMS,
        mustHaves: ["Kubernetes"],
        gaps: [],
        bannedTerms: [],
        jobSummary: "A backend role.",
        editNote: scenario.editNote ?? null,
        answeredQuestions: scenario.answeredQuestions ?? [],
      }),
    submit_resume_draft: (input) => {
      const errors = scenario.acceptEverything ? [] : traceDraftLikeTheServer(input.body);
      if (errors.length > 0) return refused(errors);
      return ok({ versionId: A_VERSION_ID, shortId: "r-bbbbbbbb", status: "Awaiting approval" });
    },
    ask_person: () => ok({ questionId: "question-1" }),
    complete_task: (input) => ok({ done: input.outcome === "done" ? 1 : 0, total: 2 }),
  };
}

function submittedDrafts(server: StubServer): ResumeBody[] {
  return inputsOf(server, "submit_resume_draft").map((input) => input.body);
}

function bulletIds(draft: ResumeBody, entryIndex: number): string[] {
  return (draft.sections.experience[entryIndex]?.bullets ?? []).map((bullet) => bullet.src);
}

describe("a scripted tailor run", () => {
  let server: StubServer;

  beforeAll(assertBuiltCliIsCurrent);
  afterEach(() => server.close());

  async function runTailor(scenario: TailorScenario, env: Record<string, string> = {}, runInput = {}): Promise<ScriptedRun> {
    server = await startStubServer(tailorHandlers(scenario));
    return runScriptedRun({
      playbook: aPlaybook("tailor", runInput),
      server,
      env,
      allowedTools: TAILOR_ALLOWED_TOOLS,
    });
  }

  it("works through the queue, one application at a time, until next_task returns none", async () => {
    const run = await runTailor({});

    expect(run.toolUses.map((toolUse) => toolUse.name)).toEqual([
      "next_task", "get_tailoring_context", "submit_resume_draft", "complete_task",
      "next_task", "get_tailoring_context", "submit_resume_draft", "complete_task",
      "next_task",
    ]);
    expect(inputsOf(server, "complete_task").map((input) => input.outcome)).toEqual(["done", "done"]);
    expect(run.result).toMatchObject({ subtype: "success", is_error: false, num_turns: 9 });
    expect(run.result?.result).toContain("2 resumes tailored");
  });

  it("puts the bullets that mention a must-have first and invents nothing", async () => {
    await runTailor({ applicationIds: ["app-1"] });
    const [draft] = submittedDrafts(server);
    const master = aMasterResume();

    expect(bulletIds(draft!, 0)).toEqual([
      "ach-northwind-kubernetes",
      "ach-northwind-tracking-api",
      "ach-northwind-latency",
      "ach-northwind-oncall",
    ]);
    // Same parts, same words: only the order changed.
    expect(draft!.sections.projects).toEqual(master.sections.projects);
    expect(draft!.education).toEqual(master.education);
    expect(draft!.headline).toEqual(master.headline);
    expect(new Set(draft!.skills.map((skill) => skill.text))).toEqual(new Set(master.skills.map((skill) => skill.text)));
    expect(draft!.skills[0]?.text).toBe("Kubernetes");
  });

  it("drops the last bullet of the first entry when the person asked for an edit", async () => {
    await runTailor({ applicationIds: ["app-1"], editNote: "Make it shorter." });
    const [draft] = submittedDrafts(server);

    expect(bulletIds(draft!, 0)).toEqual([
      "ach-northwind-kubernetes",
      "ach-northwind-tracking-api",
      "ach-northwind-latency",
    ]);
  });

  it("also honours the edit note the run was started with", async () => {
    await runTailor({ applicationIds: ["app-1"] }, {}, { editNote: "Make it shorter." });
    const [draft] = submittedDrafts(server);

    expect(bulletIds(draft!, 0)).toHaveLength(3);
  });

  describe("with FAKE_CLAUDE_INVENT_BULLET=1", () => {
    it("submits a draft with made-up parts, then drops exactly those parts and submits again", async () => {
      const run = await runTailor({ applicationIds: ["app-1"] }, { FAKE_CLAUDE_INVENT_BULLET: "1" });
      const [firstDraft, secondDraft] = submittedDrafts(server);

      expect(run.toolUses.map((toolUse) => toolUse.name)).toEqual([
        "next_task", "get_tailoring_context", "submit_resume_draft", "submit_resume_draft", "complete_task", "next_task",
      ]);
      expect(JSON.stringify(firstDraft)).toContain("story-item-that-does-not-exist");
      expect(firstDraft!.sections.experience[0]?.bullets.some((bullet) => bullet.text.startsWith("Led the on-call"))).toBe(true);
      expect(traceDraftLikeTheServer(secondDraft!)).toEqual([]);
      expect(bulletIds(secondDraft!, 0)).toEqual([
        "ach-northwind-kubernetes",
        "ach-northwind-tracking-api",
        "ach-northwind-latency",
      ]);
      expect(inputsOf(server, "complete_task")[0]?.outcome).toBe("done");
    });

    it("fails the run when the server accepts a draft that cites a story item that does not exist", async () => {
      const run = await runTailor({ applicationIds: ["app-1"], acceptEverything: true }, { FAKE_CLAUDE_INVENT_BULLET: "1" });

      expect(run.result).toMatchObject({ subtype: "error_during_execution", is_error: true });
      expect(run.result?.result).toContain("not in Your story");
      expect(run.exitCode).toBe(1);
    });
  });

  describe("with FAKE_CLAUDE_ASK_FIRST=1", () => {
    it("asks about the first application, completes it as waiting, then carries on with the rest", async () => {
      const run = await runTailor({}, { FAKE_CLAUDE_ASK_FIRST: "1" });

      expect(run.toolUses.map((toolUse) => toolUse.name)).toEqual([
        "next_task", "get_tailoring_context", "ask_person", "complete_task",
        "next_task", "get_tailoring_context", "submit_resume_draft", "complete_task",
        "next_task",
      ]);
      expect(inputsOf(server, "ask_person")).toEqual([
        { applicationId: "app-1", question: expect.stringContaining("Acme Cloud") },
      ]);
      expect(inputsOf(server, "complete_task").map((input) => [input.applicationId, input.outcome])).toEqual([
        ["app-1", "waiting"],
        ["app-2", "done"],
      ]);
      expect(run.result?.result).toContain("1 waiting for an answer");
    });

    it("does not ask again once the person has answered", async () => {
      const run = await runTailor(
        { applicationIds: ["app-1"], answeredQuestions: [{ question: "Which one?", answer: "The API work." }] },
        { FAKE_CLAUDE_ASK_FIRST: "1" },
      );

      expect(run.toolUses.map((toolUse) => toolUse.name)).not.toContain("ask_person");
      expect(inputsOf(server, "complete_task")[0]?.outcome).toBe("done");
    });
  });
});
