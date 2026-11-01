// The launcher with the real fake claude, against a real server on a free port (startServer, port 0) with the demo
// feeds and Alex Rivera's profile. Nothing is replaced except Claude Code itself: the runs are real processes that
// call the real /mcp endpoint. Build the fake first: pnpm --filter @jobgoblin/fake-claude build
// The fake's switches are environment variables, so a test sets them BEFORE it starts its server: the server
// reads the environment when it starts, exactly as it would on the person's computer.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ApplicationStatus, Run } from "@jobgoblin/schemas";
import {
  getApplication,
  getRun,
  insertRun,
  listApplicationsByStatus,
  listQuestionsForApplication,
  listRecentRuns,
} from "@jobgoblin/storage";
import { afterEach, describe, expect, it } from "vitest";
import type { StartOptions } from "../context";
import { addPastedJob } from "../services/jobs";
import { answerQuestion } from "../services/questions";
import { cancelRun, queueRun, retryRun, startHunt } from "../services/runs";
import { chooseFolder } from "../services/settings";
import { openServerDatabase } from "../services/serverDatabase";
import { requestTailor } from "../services/tailoring";
import { aScoredApplication, demoFeedsDir, repoRoot, seedAlexRivera } from "../services/testSupport";
import { startServer, type RunningServer } from "../startServer";
import { isProcessAlive } from "./processes";
import { aRun } from "./testSupport";

const FAKE_CLAUDE_PATH = path.join(repoRoot(), "fixtures", "fake-claude", "dist", "cli.mjs");
const RUN_TIMEOUT_MS = 90_000; // these tests start real processes and render real PDFs

const servers: RunningServer[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("FAKE_CLAUDE_")) delete process.env[name];
  }
  for (const directory of tempDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
});

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function makeTempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jobgoblin-launcher-"));
  tempDirectories.push(directory);
  return directory;
}

function optionsFor(appDataDir: string): StartOptions {
  if (!fs.existsSync(FAKE_CLAUDE_PATH)) throw new Error("The fake claude is not built. Run: pnpm --filter @jobgoblin/fake-claude build");
  return {
    appDataDir,
    resourcesDir: repoRoot(),
    port: 0,
    claudeCommand: [process.execPath, FAKE_CLAUDE_PATH],
    claudeInstallCommand: null,
    feedFixturesDir: demoFeedsDir(),
    devOrigin: null,
  };
}

// A server for Alex Rivera, who has finished setup and chosen a folder. `fakeEnvironment` is the fake's switches.
async function startedServer(fakeEnvironment: Record<string, string> = {}): Promise<RunningServer> {
  Object.assign(process.env, fakeEnvironment);
  const server = await startServer(optionsFor(makeTempDir()));
  servers.push(server);
  seedAlexRivera(server.ctx);
  chooseFolder(server.ctx, makeTempDir());
  return server;
}

async function waitUntil(condition: () => boolean, what: string, timeoutMs = RUN_TIMEOUT_MS): Promise<void> {
  const giveUpAt = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > giveUpAt) throw new Error(`Gave up waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// Nothing is queued or running. Polled every 100 ms and the launcher queues a follow-up run in the same tick that
// it records an end, so this can never see the gap between a hunt and its tailor run.
async function waitForQueueToEmpty(server: RunningServer): Promise<void> {
  await waitUntil(() => listRecentRuns(server.ctx.db, 50).every((run) => run.status !== "queued" && run.status !== "running"), "the runs to finish");
}

function runsOfKind(server: RunningServer, kind: Run["kind"]): Run[] {
  return listRecentRuns(server.ctx.db, 50).filter((run) => run.kind === kind).reverse();
}

function applicationsWith(server: RunningServer, status: ApplicationStatus): string[] {
  return listApplicationsByStatus(server.ctx.db, [status]).map((application) => `${application.company} ${application.title}`).sort();
}

// The tool calls a run made, in order, read back from its transcript.jsonl (the `assistant` lines).
function toolCallsInTranscript(server: RunningServer, runId: string): string[] {
  const text = fs.readFileSync(path.join(server.ctx.appDataDir, "runs", runId, "transcript.jsonl"), "utf8");
  const events = text.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as StreamLine);
  return events.flatMap((event) => (event.type === "assistant" ? event.message.content.map((block) => block.name) : []));
}

type StreamLine = { type: "assistant"; message: { content: { name: string }[] } } | { type: "system" | "result" };

function aSecondJob() {
  return { jobId: "greenhouse:acmecloud:1002", title: "Platform Engineer" };
}

// ---------------------------------------------------------------------------------------------
// The whole pipeline
// ---------------------------------------------------------------------------------------------

describe("a hunt run", () => {
  it("scores the demo jobs, then a tailor run makes resumes for the ones worth applying to", async () => {
    const server = await startedServer();

    const hunt = startHunt(server.ctx);
    await waitForQueueToEmpty(server);

    expect(getRun(server.ctx.db, hunt.id)).toMatchObject({ status: "done", outcomeMessage: "Finished", pid: null, step: null });
    expect(runsOfKind(server, "tailor")).toMatchObject([{ status: "done", progressDone: 2, progressTotal: 2 }]);
    expect(applicationsWith(server, "Awaiting approval")).toEqual(["Acme Cloud Backend Engineer", "Brightpath Platform Engineer"]);
    expect(applicationsWith(server, "Long shot")).toEqual(["Copperleaf AI Software Engineer, Applied AI"]);
    expect(applicationsWith(server, "Skipped (low fit)")).toEqual(["Copperleaf AI Data Analyst"]);
  }, RUN_TIMEOUT_MS);

  it("keeps a transcript of the run and the id of its Claude session", async () => {
    const server = await startedServer();

    const hunt = startHunt(server.ctx);
    await waitForQueueToEmpty(server);

    expect(toolCallsInTranscript(server, hunt.id)).toContain("mcp__jobgoblin__record_fit");
    expect(getRun(server.ctx.db, hunt.id)?.sessionId).not.toBeNull();
  }, RUN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// Tailor runs
// ---------------------------------------------------------------------------------------------

describe("a tailor run", () => {
  it("still ends with the application awaiting approval when the first draft invents a bullet, because the errors were values", async () => {
    const server = await startedServer({ FAKE_CLAUDE_INVENT_BULLET: "1" });
    const applicationId = aScoredApplication(server.ctx);

    const run = requestTailor(server.ctx, applicationId);
    await waitForQueueToEmpty(server);

    expect(getRun(server.ctx.db, run.id)?.status).toBe("done");
    expect(getApplication(server.ctx.db, applicationId)?.status).toBe("Awaiting approval");
    expect(toolCallsInTranscript(server, run.id).filter((tool) => tool === "mcp__jobgoblin__submit_resume_draft")).toHaveLength(2); // refused once, then accepted
  }, RUN_TIMEOUT_MS);

  it("leaves an application with a question open while the rest are done, and answering it queues one more run", async () => {
    const server = await startedServer({ FAKE_CLAUDE_ASK_FIRST: "1" });
    const asked = aScoredApplication(server.ctx);
    const other = aScoredApplication(server.ctx, aSecondJob());

    const run = queueRun(server.ctx, { kind: "tailor", applicationIds: [asked, other], input: {} });
    await waitForQueueToEmpty(server);

    expect(getRun(server.ctx.db, run.id)).toMatchObject({ status: "waiting", outcomeMessage: "Waiting for your answer" });
    expect(getApplication(server.ctx.db, other)?.status).toBe("Awaiting approval");
    expect(getApplication(server.ctx.db, asked)?.status).toBe("Scored");
    const [question] = listQuestionsForApplication(server.ctx.db, asked);
    expect(question?.answer).toBeNull();

    answerQuestion(server.ctx, question?.id ?? "", "Lead with the backend work.");
    await waitForQueueToEmpty(server);

    expect(getApplication(server.ctx.db, asked)?.status).toBe("Awaiting approval");
    expect(runsOfKind(server, "tailor")).toHaveLength(2);
    expect(getRun(server.ctx.db, run.id)?.status).toBe("done");
  }, RUN_TIMEOUT_MS);

  it("is tried once more on sonnet when it fails, and then tells the person why", async () => {
    const server = await startedServer({ FAKE_CLAUDE_MODE: "crash" });
    const applicationId = aScoredApplication(server.ctx);

    const first = requestTailor(server.ctx, applicationId);
    await waitForQueueToEmpty(server);

    const [firstRun, retry, ...others] = runsOfKind(server, "tailor");
    expect(others).toEqual([]);
    expect(firstRun).toMatchObject({ id: first.id, status: "failed", model: "haiku" });
    expect(retry).toMatchObject({ status: "failed", model: "sonnet", retryOf: first.id });
    expect(getApplication(server.ctx.db, applicationId)).toMatchObject({
      status: "Scored",
      tailorAttempts: 1,
      tailorError: expect.stringContaining("Couldn't tailor this one:"),
    });
  }, RUN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// How runs end
// ---------------------------------------------------------------------------------------------

// A paste run is the cheapest run that makes three tool calls (so max-turns, which stops after two, bites).
async function pasteRun(server: RunningServer): Promise<Run> {
  const added = await addPastedJob(server.ctx, { company: "Gridline Energy", title: "Backend Engineer", text: "Python and PostgreSQL. 2 years." });
  const run = getRun(server.ctx.db, added.runId ?? "");
  if (run === null) throw new Error("The paste run was not queued.");
  return run;
}

describe("a run that does not go well", () => {
  it.each([
    ["usage-limit", "blocked", "Your Claude plan limit is reached. It resets"],
    ["crash", "failed", "This run stopped before finishing"],
    ["max-turns", "failed", "This run stopped before finishing"],
    ["extra-tools", "failed", "This run was stopped for safety"],
  ])("ends %s as %s", async (mode, status, message) => {
    const server = await startedServer({ FAKE_CLAUDE_MODE: mode });

    const run = await pasteRun(server);
    await waitForQueueToEmpty(server);

    expect(getRun(server.ctx.db, run.id)).toMatchObject({ status, pid: null, outcomeMessage: expect.stringContaining(message) });
  }, RUN_TIMEOUT_MS);

  it("is blocked before it starts when Claude Code is signed out, and pauses the queue until it is retried", async () => {
    const server = await startedServer({ FAKE_CLAUDE_MODE: "signed-out" });

    const blocked = await pasteRun(server);
    await waitUntil(() => getRun(server.ctx.db, blocked.id)?.status === "blocked", "the run to be blocked");
    const waitingBehind = queueRun(server.ctx, { kind: "ask", applicationIds: [], input: { applicationId: "nothing", question: "q" } });

    expect(getRun(server.ctx.db, blocked.id)).toMatchObject({ outcomeMessage: "Sign in with Claude again", sessionId: null });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(getRun(server.ctx.db, waitingBehind.id)?.status).toBe("queued");
    await cancelRun(server.ctx, waitingBehind.id); // otherwise it would be the first run the retry lets through

    const retried = retryRun(server.ctx, blocked.id);
    await waitUntil(() => getRun(server.ctx.db, retried.id)?.status === "blocked", "the retry to be tried");

    expect(getRun(server.ctx.db, retried.id)?.retryOf).toBe(blocked.id);
  }, RUN_TIMEOUT_MS);

  it("can be cancelled while it works, and its process is gone when the cancel returns", async () => {
    const server = await startedServer({ FAKE_CLAUDE_MODE: "slow" });
    const run = await pasteRun(server);
    await waitUntil(() => getRun(server.ctx.db, run.id)?.sessionId != null, "the process to say hello");
    const pid = getRun(server.ctx.db, run.id)?.pid ?? 0;
    expect(isProcessAlive(pid)).toBe(true);

    const cancelled = await cancelRun(server.ctx, run.id);

    expect(cancelled).toMatchObject({ status: "cancelled", outcomeMessage: "This run was cancelled", pid: null });
    expect(isProcessAlive(pid)).toBe(false);
  }, RUN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------------------------

describe("start-up recovery", () => {
  it("marks a running run whose process is gone as interrupted, and leaves a waiting run alone", async () => {
    const appDataDir = makeTempDir();
    const deadPid = spawnSync(process.execPath, ["-e", "0"]).pid;
    const earlierDb = openServerDatabase({ appDataDir, resourcesDir: repoRoot(), now: () => new Date() });
    insertRun(earlierDb, aRun({ id: "was-going", kind: "hunt", status: "running", pid: deadPid }), []);
    insertRun(earlierDb, aRun({ id: "was-waiting", kind: "tailor", status: "waiting", pid: null }), []);
    earlierDb.close();

    const server = await startServer(optionsFor(appDataDir));
    servers.push(server);

    expect(getRun(server.ctx.db, "was-going")).toMatchObject({ status: "interrupted", outcomeMessage: "This run was interrupted", pid: null });
    expect(getRun(server.ctx.db, "was-waiting")?.status).toBe("waiting");
  });
});
