// The three small run kinds: setup, paste and ask.
import { RUN_KIND_TOOLS } from "@jobgoblin/schemas";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ALEX_PROFILE, ALEX_STORY_ITEMS, anApplication } from "./aDemoPerson";
import { assertBuiltCliIsCurrent } from "./builtCli";
import { aPlaybook, runScriptedRun } from "./runFakeClaude";
import { inputsOf, ok, startStubServer } from "./stubJobgoblinServer";
import type { StubServer } from "./stubJobgoblinServer";

function allowedToolsFor(kind: keyof typeof RUN_KIND_TOOLS): string[] {
  return RUN_KIND_TOOLS[kind].map((tool) => `mcp__jobgoblin__${tool}`);
}

describe("the other scripted runs", () => {
  let server: StubServer;

  beforeAll(assertBuiltCliIsCurrent);
  afterEach(() => server.close());

  describe("setup", () => {
    async function runSetup() {
      server = await startStubServer({
        import_resume: () => ok({ uploads: [{ kind: "resume", fileName: "alex-rivera.pdf", text: "Alex Rivera ..." }] }),
        propose_story_items: (input) => ok({ created: input.items.map((item) => ({ tempId: item.tempId, id: `id-${item.tempId}` })) }),
        save_profile_section: () => ok({ section: "employment", filledKeys: ["currentEmployer"] }),
      });
      return runScriptedRun({ playbook: aPlaybook("setup"), server, allowedTools: allowedToolsFor("setup") });
    }

    it("reads the resume, proposes Your story, then fills in the employment details", async () => {
      const run = await runSetup();

      expect(run.toolUses.map((toolUse) => toolUse.name)).toEqual([
        "import_resume", "propose_story_items", "save_profile_section",
      ]);
      expect(run.result).toMatchObject({ subtype: "success", is_error: false, num_turns: 3 });
      expect(run.result?.result).toContain("22 items");
    });

    it("proposes the same story items, with the same ids, as the profile fixture", async () => {
      await runSetup();
      const [proposal] = inputsOf(server, "propose_story_items");

      expect(proposal?.items.map((item) => [item.tempId, item.kind, item.parentTempId])).toEqual(
        ALEX_STORY_ITEMS.map((item) => [item.id, item.kind, item.parentId]),
      );
    });

    it("fills in only employment facts that the resume shows, none of them personal", async () => {
      await runSetup();

      expect(inputsOf(server, "save_profile_section")).toEqual([
        {
          section: "employment",
          data: { currentEmployer: "Northwind Logistics", currentTitle: "Software Engineer", yearsExperience: "2" },
        },
      ]);
      expect(JSON.stringify(server.calls)).not.toContain(ALEX_PROFILE.contact.email);
    });
  });

  describe("paste", () => {
    async function runPaste() {
      server = await startStubServer({
        get_job: (input) =>
          ok({
            jobId: input.jobId,
            company: "Gridline Energy",
            title: "Backend Engineer",
            location: "Remote - US",
            region: "US",
            url: null,
            text: "<untrusted_job_posting>Backend Engineer (Python, PostgreSQL)</untrusted_job_posting>",
            questions: [],
          }),
        get_fit_context: () => ok({ rubric: "Test rubric", targets: ALEX_PROFILE.targets, storyItems: ALEX_STORY_ITEMS }),
        record_fit: (input) => ok({ applicationId: `app-${input.jobId}`, band: "apply", status: "Scored" }),
      });
      return runScriptedRun({
        playbook: aPlaybook("paste", { jobId: "pasted:gridline:1" }),
        server,
        allowedTools: allowedToolsFor("paste"),
      });
    }

    it("reads the pasted job named in the run input, then scores it", async () => {
      const run = await runPaste();

      expect(run.toolUses.map((toolUse) => toolUse.name)).toEqual(["get_job", "get_fit_context", "record_fit"]);
      expect(inputsOf(server, "get_job")).toEqual([{ jobId: "pasted:gridline:1" }]);
    });

    it("gives Gridline Energy its fixed score of 78", async () => {
      const run = await runPaste();

      expect(inputsOf(server, "record_fit")[0]).toMatchObject({ jobId: "pasted:gridline:1", score: 78 });
      expect(run.result?.result).toBe("Scored Gridline Energy, Backend Engineer: 78 (apply).");
    });
  });

  describe("ask", () => {
    it("reads the application with get_application and answers in the result text", async () => {
      server = await startStubServer({
        get_application: () =>
          ok({ application: anApplication(), job: { company: "Acme Cloud", title: "Backend Engineer", location: "Remote - US", url: null }, fit: null, resume: null, answers: [], history: [] }),
      });

      const run = await runScriptedRun({
        playbook: aPlaybook("ask", { applicationId: "app-1", question: "How strong is this fit?" }),
        server,
        allowedTools: allowedToolsFor("ask"),
      });

      expect(run.toolUses.map((toolUse) => toolUse.name)).toEqual(["get_application"]);
      expect(inputsOf(server, "get_application")).toEqual([{ applicationId: "app-1" }]);
      expect(run.result?.result).toContain("Acme Cloud, Backend Engineer");
      expect(run.result?.result).toContain("fit score of 86");
      expect(run.result?.result).toContain("How strong is this fit?");
    });
  });
});
