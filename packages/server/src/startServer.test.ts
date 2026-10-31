// startServer on a real port (127.0.0.1, port 0, so any free one) with temporary folders: it answers with the
// session token, writes server.json while it runs, stops cleanly, and marks runs the last session left going
// as interrupted. Feeds are read from the demo fixtures, so nothing leaves this computer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Run } from "@jobgoblin/schemas";
import { getRun, insertRun } from "@jobgoblin/storage";
import type { StartOptions } from "./context";
import { openServerDatabase } from "./services/serverDatabase";
import { repoRoot, demoFeedsDir } from "./services/testSupport";
import { SERVER_JSON_FILE_NAME, startServer, type RunningServer } from "./startServer";

const runningServers: RunningServer[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  for (const server of runningServers.splice(0)) await server.stop();
  for (const directory of tempDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
});

function appDataDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jobgoblin-start-"));
  tempDirectories.push(directory);
  return directory;
}

function optionsFor(appDataDir: string): StartOptions {
  return {
    appDataDir,
    resourcesDir: repoRoot(),
    port: 0,
    claudeCommand: null,
    claudeInstallCommand: null,
    feedFixturesDir: demoFeedsDir(),
    devOrigin: null,
  };
}

async function started(appDataDir: string): Promise<RunningServer> {
  const server = await startServer(optionsFor(appDataDir));
  runningServers.push(server);
  return server;
}

function aRun(overrides: Partial<Run>): Run {
  return {
    id: "run-from-last-session",
    kind: "hunt",
    status: "running",
    model: "sonnet",
    input: {},
    sessionId: null,
    pid: 4242,
    step: "Checking job boards",
    progressDone: 0,
    progressTotal: null,
    outcomeMessage: null,
    resultText: null,
    retryOf: null,
    queuedAt: "2026-10-31T09:00:00.000Z",
    startedAt: "2026-10-31T09:00:05.000Z",
    endedAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

describe("startServer", () => {
  it("listens on 127.0.0.1 and answers only a request that carries the session token", async () => {
    const server = await started(appDataDirectory());

    const refused = await fetch(`http://127.0.0.1:${server.port}/api/today`);
    const answered = await fetch(`http://127.0.0.1:${server.port}/api/today`, {
      headers: { Authorization: `Bearer ${server.sessionToken}` },
    });

    expect(server.url).toBe(`http://127.0.0.1:${server.port}/#token=${server.sessionToken}`);
    expect(refused.status).toBe(401);
    expect(answered.status).toBe(200);
    expect(await answered.json()).toMatchObject({ needsYou: [], running: [], setupComplete: false });
  });

  it("writes server.json without any secret while it runs, and removes it and the port when it stops", async () => {
    const appDataDir = appDataDirectory();
    const server = await started(appDataDir);
    const serverJsonPath = path.join(appDataDir, SERVER_JSON_FILE_NAME);

    const info = JSON.parse(fs.readFileSync(serverJsonPath, "utf8")) as Record<string, unknown>;
    await server.stop();

    expect(Object.keys(info).sort()).toEqual(["pid", "port", "startedAt", "version"]);
    expect(info.port).toBe(server.port);
    expect(fs.existsSync(serverJsonPath)).toBe(false);
    expect(server.ctx.db.sqlite.isOpen).toBe(false);
    await expect(fetch(`http://127.0.0.1:${server.port}/api/today`)).rejects.toThrow();
  });

  it("marks a run the last session left going as interrupted, and leaves a waiting run alone", async () => {
    const appDataDir = appDataDirectory();
    const earlierDb = openServerDatabase({ appDataDir, resourcesDir: repoRoot(), now: () => new Date() });
    insertRun(earlierDb, aRun({ id: "going" }), []);
    insertRun(earlierDb, aRun({ id: "waiting", kind: "tailor", status: "waiting", pid: null }), []);
    earlierDb.close();

    const server = await started(appDataDir);

    expect(getRun(server.ctx.db, "going")).toMatchObject({ status: "interrupted", outcomeMessage: "This run was interrupted", pid: null });
    expect(getRun(server.ctx.db, "waiting")?.status).toBe("waiting");
  });
});
