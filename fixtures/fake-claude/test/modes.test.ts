// The failure modes a test can switch on with FAKE_CLAUDE_MODE, and how the fake treats the command line
// and the connection. Each mode is what the runner has to survive: a signed-out account, a usage limit,
// a crash, a slow run to cancel, a run that runs out of turns, a run with a tool it must not have.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { anApplication, aMasterResume, ALEX_STORY_ITEMS } from "./aDemoPerson";
import { assertBuiltCliIsCurrent } from "./builtCli";
import { aPlaybook, runScriptedRun } from "./runFakeClaude";
import type { ScriptedRun, ScriptedRunOptions } from "./runFakeClaude";
import { ok, startStubServer } from "./stubJobgoblinServer";
import type { StubServer } from "./stubJobgoblinServer";

const ASK_PLAYBOOK = aPlaybook("ask", { applicationId: "app-1", question: "How is it going?" });
const TAILOR_PLAYBOOK = aPlaybook("tailor");

describe("the fake claude's failure modes", () => {
  let server: StubServer;

  beforeAll(assertBuiltCliIsCurrent);
  afterEach(() => server.close());

  // One stub that serves both an ask run (one call) and a tailor run (many calls).
  async function startServer(): Promise<StubServer> {
    server = await startStubServer({
      get_application: () =>
        ok({ application: anApplication(), job: { company: "Acme Cloud", title: "Backend Engineer", location: "Remote", url: null }, fit: null, resume: null, answers: [], history: [] }),
      next_task: () => ok({ applicationId: "app-1" }),
      get_tailoring_context: () =>
        ok({
          application: { id: "app-1", company: "Acme Cloud", title: "Backend Engineer" },
          master: aMasterResume(),
          storyItems: ALEX_STORY_ITEMS,
          mustHaves: [],
          gaps: [],
          bannedTerms: [],
          jobSummary: "",
          editNote: null,
          answeredQuestions: [],
        }),
      submit_resume_draft: () => ok({ versionId: `r-${"c".repeat(64)}`, shortId: "r-cccccccc", status: "Awaiting approval" }),
      complete_task: () => ok({ done: 1, total: 1 }),
    });
    return server;
  }

  async function runAsk(options: Partial<ScriptedRunOptions> = {}): Promise<ScriptedRun> {
    return runScriptedRun({ playbook: ASK_PLAYBOOK, server: await startServer(), allowedTools: ["mcp__jobgoblin__get_application"], ...options });
  }

  it("signed-out: prints only a result that says the person is not logged in, and exits 1", async () => {
    const run = await runAsk({ env: { FAKE_CLAUDE_MODE: "signed-out" } });

    expect(run.init).toBeUndefined();
    expect(run.result).toMatchObject({ is_error: true, result: "Not logged in · Please run /login" });
    expect(run.exitCode).toBe(1);
    expect(server.authorizationHeaders).toEqual([]); // it never even reached the server
  });

  it("usage-limit: ends with the usage limit message and a reset time one hour away", async () => {
    const run = await runAsk({ env: { FAKE_CLAUDE_MODE: "usage-limit" } });
    const resetsAt = Number(run.result?.result.split("|")[1]);
    const oneHourFromNow = Date.now() / 1000 + 3600;

    expect(run.result).toMatchObject({ is_error: true });
    expect(run.result?.result).toMatch(/^Claude AI usage limit reached\|\d+$/);
    expect(Math.abs(resetsAt - oneHourFromNow)).toBeLessThan(120);
    expect(run.exitCode).toBe(1);
    expect(server.calls).toEqual([]);
  });

  it("crash: exits 1 after the init line, with no result line", async () => {
    const run = await runAsk({ env: { FAKE_CLAUDE_MODE: "crash" } });

    expect(run.init).toBeDefined();
    expect(run.result).toBeUndefined();
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("crashing on purpose");
  });

  it("slow: waits two seconds before a tool call, so a cancel has time to arrive", async () => {
    const run = await runAsk({ env: { FAKE_CLAUDE_MODE: "slow" } });

    expect(run.elapsedMs).toBeGreaterThanOrEqual(1900);
    expect(run.result).toMatchObject({ subtype: "success", is_error: false });
  });

  it("max-turns: stops with error_max_turns after two tool calls", async () => {
    await startServer();
    const run = await runScriptedRun({ playbook: TAILOR_PLAYBOOK, server, env: { FAKE_CLAUDE_MODE: "max-turns" } });

    expect(run.toolUses.map((toolUse) => toolUse.name)).toEqual(["next_task", "get_tailoring_context"]);
    expect(run.result).toMatchObject({ subtype: "error_max_turns", is_error: true, num_turns: 2 });
    expect(run.exitCode).toBe(1);
  });

  it("extra-tools: lists a Bash tool in the init line, which the runner must refuse", async () => {
    const run = await runAsk({ env: { FAKE_CLAUDE_MODE: "extra-tools" } });

    expect(run.init?.tools).toEqual(["mcp__jobgoblin__get_application", "Bash"]);
  });

  it("stops at --max-turns even in normal mode", async () => {
    await startServer();
    const run = await runScriptedRun({ playbook: TAILOR_PLAYBOOK, server, maxTurns: 1 });

    expect(run.toolUses).toHaveLength(1);
    expect(run.result).toMatchObject({ subtype: "error_max_turns", is_error: true, num_turns: 1 });
  });

  it("ignores a flag it does not know and says so on stderr", async () => {
    const run = await runAsk({ extraArguments: ["--some-future-flag"] });

    expect(run.stderr).toContain("ignoring unknown flag --some-future-flag");
    expect(run.result).toMatchObject({ subtype: "success", is_error: false });
    expect(run.exitCode).toBe(0);
  });

  it("reports the server as failed, and the run as an error, when the token is wrong", async () => {
    const run = await runAsk({ runToken: "not-the-token" });

    expect(run.init?.mcp_servers).toEqual([{ name: "jobgoblin", status: "failed" }]);
    expect(run.result).toMatchObject({ subtype: "error_during_execution", is_error: true });
    expect(server.calls).toEqual([]);
    expect(run.exitCode).toBe(1);
  });

  it("reports the server as failed when the token is missing from the environment", async () => {
    const run = await runAsk({ runToken: null });

    expect(run.init?.mcp_servers).toEqual([{ name: "jobgoblin", status: "failed" }]);
    expect(run.stderr).toContain("JOBGOBLIN_RUN_TOKEN is not set");
    expect(server.authorizationHeaders).toEqual([]);
  });

  it("ends the run with an error result when the run input lacks something the script needs", async () => {
    // An ask run without an applicationId has nothing to look at.
    const run = await runAsk({ playbook: aPlaybook("ask", { question: "Anything?" }) });

    expect(run.result).toMatchObject({ subtype: "error_during_execution", is_error: true });
    expect(run.result?.result).toContain("applicationId");
    expect(run.exitCode).toBe(1);
  });
});
