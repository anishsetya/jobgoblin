import fs from "node:fs";
import path from "node:path";
import { RunInput } from "@jobgoblin/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { JOB_BOARD_DOMAINS } from "./claudeArgs";
import { buildPlaybook, createRunDirectory, runDirectoryPath } from "./runDirectory";
import { makeTempDir, removeTempDirs } from "./testSupport";

afterEach(removeTempDirs);

// A resources folder with small playbooks, so these tests do not depend on the real playbook text.
function aResourcesDir(): string {
  const resourcesDir = makeTempDir();
  fs.mkdirSync(path.join(resourcesDir, "playbooks", "agents"), { recursive: true });
  for (const kind of ["hunt", "tailor", "ask"]) {
    fs.writeFileSync(path.join(resourcesDir, "playbooks", `${kind}.md`), `# ${kind} playbook\r\nDo the ${kind} work.`);
  }
  fs.writeFileSync(path.join(resourcesDir, "playbooks", "agents", "screener.md"), "---\nname: screener\n---\nScreen jobs.\n");
  return resourcesDir;
}

type ProjectSettings = { permissions: { allow: string[]; deny: string[] } };

function readProjectSettings(directory: string): ProjectSettings {
  return JSON.parse(fs.readFileSync(path.join(directory, ".claude", "settings.json"), "utf8")) as ProjectSettings;
}

describe("buildPlaybook", () => {
  it("starts with the run kind on line 1 and the run input as JSON on line 2", () => {
    const input: RunInput = { applicationId: "app-1", question: "How is it going?" };

    const lines = buildPlaybook("ask", input, aResourcesDir()).split("\n");

    expect(lines[0]).toBe("<!-- run-kind: ask -->");
    expect(lines[1]).toBe(`<!-- run-input: ${JSON.stringify(input)} -->`);
  });

  it("follows the two header lines with the playbook file's text, one line ending everywhere", () => {
    const playbook = buildPlaybook("tailor", {}, aResourcesDir());

    expect(playbook).toBe("<!-- run-kind: tailor -->\n<!-- run-input: {} -->\n\n# tailor playbook\nDo the tailor work.\n");
  });

  it("keeps the run input on one line and readable back, even when a note contains a comment ending", () => {
    const input: RunInput = { editNote: "Shorter -->\nand lead with the API work" };

    const secondLine = buildPlaybook("tailor", input, aResourcesDir()).split("\n")[1] ?? "";
    const json = /^<!-- run-input: (.*) -->$/.exec(secondLine)?.[1] ?? "";

    expect(RunInput.parse(JSON.parse(json))).toEqual(input);
  });

  it("fails clearly when the playbook for a kind is missing", () => {
    expect(() => buildPlaybook("setup", {}, aResourcesDir())).toThrow(/setup\.md/);
  });
});

describe("createRunDirectory", () => {
  function create(kind: "hunt" | "tailor", runId = "run-1") {
    const appDataDir = makeTempDir();
    const resourcesDir = aResourcesDir();
    const playbookText = buildPlaybook(kind, {}, resourcesDir);
    const { directory } = createRunDirectory({ appDataDir, resourcesDir, run: { id: runId, kind }, port: 47615, playbookText });
    return { directory, appDataDir, playbookText };
  }

  it("makes <appData>/runs/<runId>/ and writes the playbook there", () => {
    const { directory, appDataDir, playbookText } = create("tailor");

    expect(directory).toBe(path.join(appDataDir, "runs", "run-1"));
    expect(fs.readFileSync(path.join(directory, "PLAYBOOK.md"), "utf8")).toBe(playbookText);
  });

  it("writes mcp.json with the run token as a reference, never as the token itself", () => {
    const { directory } = create("tailor");

    const text = fs.readFileSync(path.join(directory, "mcp.json"), "utf8");

    expect(JSON.parse(text)).toEqual({
      mcpServers: {
        jobgoblin: {
          type: "http",
          url: "http://127.0.0.1:47615/mcp",
          headers: { Authorization: "Bearer ${JOBGOBLIN_RUN_TOKEN}" },
        },
      },
    });
    // Whatever the header holds, it must be the literal placeholder: nothing after "Bearer " but ${...}.
    expect(text).not.toMatch(/Bearer (?!\$\{JOBGOBLIN_RUN_TOKEN\})/);
  });

  it("gives a hunt run its screener subagent and WebFetch rules for job-board domains only", () => {
    const { directory } = create("hunt");

    expect(fs.readFileSync(path.join(directory, ".claude", "agents", "screener.md"), "utf8")).toContain("name: screener");
    const settings = readProjectSettings(directory);
    expect(settings.permissions.allow).toEqual([
      "WebSearch",
      ...JOB_BOARD_DOMAINS.map((domain) => `WebFetch(domain:${domain})`),
      "Agent",
    ]);
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(["Bash", "PowerShell", "Read", "Edit", "Write"]));
    expect(settings.permissions.deny).not.toContain("WebFetch");
    expect(settings.permissions.allow).not.toContain("WebFetch");
  });

  it("denies every built-in tool, and starts no subagent, for a run that has none", () => {
    const { directory } = create("tailor");

    const settings = readProjectSettings(directory);
    expect(settings.permissions.allow).toEqual([]);
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining(["Bash", "PowerShell", "Read", "Edit", "Write", "WebFetch", "WebSearch", "Agent"]),
    );
    expect(fs.readdirSync(path.join(directory, ".claude", "agents"))).toEqual([]);
  });

  it("can be created again for the same run without error", () => {
    const appDataDir = makeTempDir();
    const resourcesDir = aResourcesDir();
    const input = { appDataDir, resourcesDir, run: { id: "run-1", kind: "ask" as const }, port: 1, playbookText: "text" };

    createRunDirectory(input);

    expect(() => createRunDirectory(input)).not.toThrow();
  });
});

describe("runDirectoryPath", () => {
  it.each(["", ".", "..", "../outside", "a/b", "a\\b"])("refuses %j as a run id, because it becomes a folder name", (runId) => {
    expect(() => runDirectoryPath("C:\\data", runId)).toThrow(/run folder/);
  });

  it("accepts the UUID the server makes", () => {
    const runId = "3f2b8a0e-6d1c-4b7e-9a55-0c2d6f1e4a10";

    expect(runDirectoryPath(path.join("data"), runId)).toBe(path.join("data", "runs", runId));
  });
});
