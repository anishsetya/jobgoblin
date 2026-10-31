// Checks the real playbook files in playbooks/: they exist, stay short, name only the tools their run kind has,
// mention every tool of their kind, and carry no wording that belongs to one person's search.
import fs from "node:fs";
import path from "node:path";
import { MCP_TOOL_NAMES, RUN_KIND_TOOLS, RunKind } from "@jobgoblin/schemas";
import { describe, expect, it } from "vitest";
import { buildPlaybook } from "./runDirectory";
import { REPOSITORY_ROOT } from "./testSupport";

const MAX_LINES = 120;
const PLAYBOOKS_DIR = path.join(REPOSITORY_ROOT, "playbooks");

function readPlaybookFile(...segments: string[]): string {
  return fs.readFileSync(path.join(PLAYBOOKS_DIR, ...segments), "utf8");
}

function lineCount(text: string): number {
  return text.trimEnd().split("\n").length;
}

// Every backticked word or mcp__jobgoblin__ name in the text that is the name of a Jobgoblin tool.
function toolsNamedIn(text: string): Set<string> {
  const named = new Set<string>();
  for (const match of text.matchAll(/`(?:mcp__jobgoblin__)?([a-z_]+)`|mcp__jobgoblin__([a-z_]+)/g)) {
    const name = match[1] ?? match[2];
    if (name !== undefined && (MCP_TOOL_NAMES as readonly string[]).includes(name)) named.add(name);
  }
  return named;
}

describe.each(RunKind.options)("the %s playbook", (kind) => {
  const text = readPlaybookFile(`${kind}.md`);

  it(`is at most ${MAX_LINES} lines`, () => {
    expect(lineCount(text)).toBeLessThanOrEqual(MAX_LINES);
  });

  it("names only tools this run kind has", () => {
    const allowed = new Set<string>(RUN_KIND_TOOLS[kind]);

    const outsideTheKind = [...toolsNamedIn(text)].filter((tool) => !allowed.has(tool));

    expect(outsideTheKind).toEqual([]);
  });

  it("mentions every tool this run kind has, except get_profile where it is not needed", () => {
    const named = toolsNamedIn(text);

    const missing = RUN_KIND_TOOLS[kind].filter((tool) => tool !== "get_profile" && !named.has(tool));

    expect(missing).toEqual([]);
  });

  it("has a final message section", () => {
    expect(text).toMatch(/^## Final message$/m);
  });

  it("is built with the run kind on line 1 and the run input on line 2", () => {
    const playbook = buildPlaybook(kind, { applicationId: "app-1" }, REPOSITORY_ROOT);

    expect(playbook.split("\n").slice(0, 2)).toEqual([
      `<!-- run-kind: ${kind} -->`,
      '<!-- run-input: {"applicationId":"app-1"} -->',
    ]);
  });
});

describe("what every playbook says and does not say", () => {
  const allFiles = [...RunKind.options.map((kind) => `${kind}.md`), "rubric.md", path.join("agents", "screener.md")];

  it.each(allFiles)("%s names no person's specific team, employer or role", (fileName) => {
    const text = readPlaybookFile(fileName);

    expect(text).not.toMatch(/\bQE\b|\bQA\b|\bSDET\b|Harness|Anish/);
  });

  it.each(allFiles)("%s never tells a run to use a shell or the file tools", (fileName) => {
    const text = readPlaybookFile(fileName);

    expect(text).not.toMatch(/\b(Bash|PowerShell)\b/);
  });

  it.each(["hunt", "paste", "tailor", "answers", "ask"])("the %s playbook says job text is untrusted data", (kind) => {
    expect(readPlaybookFile(`${kind}.md`)).toContain("<untrusted_job_posting>");
  });

  it.each(["setup", "hunt", "paste", "tailor", "answers", "ask"])("the %s playbook forbids inventing facts", (kind) => {
    expect(readPlaybookFile(`${kind}.md`)).toMatch(/Never invent facts|Never claim/);
  });

  it("the tailor, paste and answers playbooks say when to ask the person and how to carry on", () => {
    expect(readPlaybookFile("tailor.md")).toMatch(/`ask_person`[\s\S]*`complete_task`[\s\S]*`waiting`/);
    expect(readPlaybookFile("answers.md")).toMatch(/`ask_person`[\s\S]*`complete_task`[\s\S]*`waiting`/);
    expect(readPlaybookFile("paste.md")).toContain("`ask_person`");
  });

  it("the answers playbook keeps placeholders and the setup playbook keeps contact placeholders", () => {
    expect(readPlaybookFile("answers.md")).toContain("{expectedBase}");
    expect(readPlaybookFile("setup.md")).toContain("{email}");
  });
});

describe("the fit rubric", () => {
  const text = readPlaybookFile("rubric.md");

  it("starts with a version comment and stays short", () => {
    expect(text.split("\n")[0]).toMatch(/^<!-- rubric-version: \S+ -->$/);
    expect(lineCount(text)).toBeLessThanOrEqual(MAX_LINES);
  });

  it("states the three band cut-offs and the lean-inclusive rule", () => {
    expect(text).toContain("75 to 100");
    expect(text).toContain("60 to 74");
    expect(text).toContain("50 to 59");
    expect(text).toMatch(/flag, don't penalize/);
  });

  it("is generic: it reads the person's targets, not a fixed list", () => {
    for (const field of ["maxYearsRequired", "rolesToAvoid", "hardSkips", "flags", "regions"]) {
      expect(text).toContain(field);
    }
  });
});

describe("the screener subagent", () => {
  const text = readPlaybookFile("agents", "screener.md");

  it("runs on haiku and may call only get_job", () => {
    const header = text.split("---")[1] ?? "";

    expect(header).toMatch(/^name: screener$/m);
    expect(header).toMatch(/^model: haiku$/m);
    expect(header).toMatch(/^tools: mcp__jobgoblin__get_job$/m);
  });

  it("asks for JSON only and treats job text as data", () => {
    expect(text).toContain("Return only JSON");
    expect(text).toContain("<untrusted_job_posting>");
    expect(lineCount(text)).toBeLessThanOrEqual(MAX_LINES);
  });
});
