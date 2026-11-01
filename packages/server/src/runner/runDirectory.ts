// Builds the folder one run works in, `<appData>/runs/<runId>/`, and the playbook text a run is given.
// Claude Code starts with this folder as its working directory and reads its project settings and subagent
// files from it, so what is written here is part of how the run is sealed.
// Spec: ARCHITECTURE.md section 10 (launch step 3) and decision D6 (the first two lines of the playbook).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { RUN_KIND_SETTINGS } from "@jobgoblin/schemas";
import type { Run, RunInput, RunKind, RunKindSettings } from "@jobgoblin/schemas";
import { webFetchRules } from "./claudeArgs";
import { MCP_CONFIG_FILE_NAME, MCP_SERVER_NAME, PLAYBOOK_FILE_NAME, RUN_TOKEN_ENV_VAR } from "./runConstants";

// The subagents a run kind may use. Only the hunt run has one: the cheap screener (Haiku).
const SUBAGENTS_BY_KIND: Partial<Record<RunKind, readonly string[]>> = { hunt: ["screener"] };

// Every built-in tool Claude Code could offer a run. A kind's settings list the few it may use; the rest are
// denied here as well, in case a flag ever fails to remove one.
const ALL_BUILT_IN_TOOLS = [
  "Bash", "PowerShell", "Read", "Edit", "Write", "Glob", "Grep", "NotebookEdit", "WebSearch", "WebFetch", "Agent",
];

// ---------------------------------------------------------------------------------------------
// The playbook
// ---------------------------------------------------------------------------------------------

// Line 1 is the run kind and line 2 the run input as JSON (decision D6), so every run gets its input in one
// known place. The rest is the playbook for the kind, from playbooks/<kind>.md.
export function buildPlaybook(kind: RunKind, input: RunInput, resourcesDir: string): string {
  const body = readResourceText(resourcesDir, "playbooks", `${kind}.md`);
  return `<!-- run-kind: ${kind} -->\n<!-- run-input: ${JSON.stringify(input)} -->\n\n${body}`;
}

function readResourceText(resourcesDir: string, ...segments: string[]): string {
  const text = readFileSync(path.join(resourcesDir, ...segments), "utf8");
  // One line ending everywhere, whatever git did to the file on this computer.
  const withoutBom = text.startsWith("﻿") ? text.slice(1) : text;
  const unixText = withoutBom.replace(/\r\n/g, "\n");
  return unixText.endsWith("\n") ? unixText : `${unixText}\n`;
}

// ---------------------------------------------------------------------------------------------
// The run directory
// ---------------------------------------------------------------------------------------------

export type CreateRunDirectoryInput = {
  appDataDir: string;
  resourcesDir: string;
  run: Pick<Run, "id" | "kind">;
  port: number;
  playbookText: string;
};

export function runDirectoryPath(appDataDir: string, runId: string): string {
  // A run id is a UUID the server made, but it becomes a folder name, so a stray separator is refused.
  if (runId === "" || runId === "." || runId === ".." || /[\\/]/.test(runId)) {
    throw new Error(`"${runId}" cannot be used as a run folder name.`);
  }
  return path.join(appDataDir, "runs", runId);
}

// Writes the run's files and returns the folder. The run token is NOT written anywhere: mcp.json names it
// only as ${JOBGOBLIN_RUN_TOKEN}, which Claude Code fills in from the run's environment.
export function createRunDirectory(input: CreateRunDirectoryInput): { directory: string } {
  const directory = runDirectoryPath(input.appDataDir, input.run.id);
  const settings = RUN_KIND_SETTINGS[input.run.kind];

  mkdirSync(path.join(directory, ".claude", "agents"), { recursive: true });
  writeFileSync(path.join(directory, PLAYBOOK_FILE_NAME), input.playbookText);
  writeFileSync(path.join(directory, MCP_CONFIG_FILE_NAME), toJsonFile(buildMcpConfig(input.port)));
  writeFileSync(path.join(directory, ".claude", "settings.json"), toJsonFile(buildProjectSettings(settings)));

  for (const agentName of SUBAGENTS_BY_KIND[input.run.kind] ?? []) {
    const agentText = readResourceText(input.resourcesDir, "playbooks", "agents", `${agentName}.md`);
    writeFileSync(path.join(directory, ".claude", "agents", `${agentName}.md`), agentText);
  }

  return { directory };
}

function toJsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// The only MCP server a run has. The server binds to 127.0.0.1 only, and the header carries the run token by
// reference: the literal text "${JOBGOBLIN_RUN_TOKEN}" is what is stored.
export function buildMcpConfig(port: number): object {
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: "http",
        url: `http://127.0.0.1:${port}/mcp`,
        headers: { Authorization: `Bearer \${${RUN_TOKEN_ENV_VAR}}` },
      },
    },
  };
}

// Project settings, the only settings file a run reads (--setting-sources project).
// Hunt: WebSearch and the job-board fetch rules are allowed. Every other built-in tool, and every built-in tool
// for the other kinds, is denied outright. Deny rules win over allow rules, so a flag mistake cannot open a tool.
export function buildProjectSettings(settings: RunKindSettings): object {
  const allowed = settings.builtInTools.flatMap((tool) => (tool === "WebFetch" ? webFetchRules() : [tool]));
  const denied = ALL_BUILT_IN_TOOLS.filter((tool) => !settings.builtInTools.some((builtIn) => builtIn === tool));
  return { permissions: { allow: allowed, deny: denied } };
}
