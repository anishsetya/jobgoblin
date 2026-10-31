// The command-line flags of one `claude -p` run. This is where a run is sealed: which model, which built-in
// tools (never Bash, PowerShell, Read, Edit or Write), which MCP tools, and which settings are read.
// The README next to this file explains why each flag is there.
// Spec: ARCHITECTURE.md section 10 (step 4); tech spec "Runner" (launch step 2).
import { RUN_KIND_TOOLS } from "@jobgoblin/schemas";
import type { Run, RunKind, RunKindSettings } from "@jobgoblin/schemas";
import { MCP_CONFIG_FILE_NAME, mcpToolName } from "./runConstants";

// The only sites a hunt run may fetch. They are the job boards Jobgoblin's own feeds read, so a posting that
// tells the run "fetch this address" cannot send anything to a site of the attacker's choice.
// Threat: prompt injection in a posting trying to leak the person's data through a fetch.
export const JOB_BOARD_DOMAINS: readonly string[] = [
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "boards-api.greenhouse.io",
  "jobs.lever.co",
  "api.lever.co",
  "jobs.ashbyhq.com",
  "api.ashbyhq.com",
  "news.ycombinator.com",
  "hn.algolia.com",
  "www.ycombinator.com",
  "remoteok.com",
  "weworkremotely.com",
];

// The permission rule that allows a fetch from one site. Claude Code writes it "WebFetch(domain:example.com)".
export function webFetchRules(): string[] {
  return JOB_BOARD_DOMAINS.map((domain) => `WebFetch(domain:${domain})`);
}

// The tools a run is allowed to call, as permission rules (`--allowedTools`).
// A bare "WebFetch" is never listed: as an allow rule it would permit every site. The kind's WebFetch becomes
// the job-board rules instead. `--tools` still lists "WebFetch", which makes the tool exist at all.
export function allowedToolsFor(kind: RunKind, settings: RunKindSettings): string[] {
  const jobgoblinTools = RUN_KIND_TOOLS[kind].map(mcpToolName);

  const builtInRules = settings.builtInTools.flatMap((tool) => (tool === "WebFetch" ? webFetchRules() : [tool]));
  return [...jobgoblinTools, ...builtInRules];
}

// A run is described by its kind and the model chosen when it was queued. The model is the kind's default
// (RUN_KIND_SETTINGS) unless the queue overrode it, which is how a tailor retry runs on sonnet.
export function buildClaudeArgs(run: Pick<Run, "kind" | "model">, settings: RunKindSettings): string[] {
  return [
    "-p", // print mode: one non-interactive run; the playbook arrives on stdin (decision D6)
    "--output-format", "stream-json", // one JSON object per line: init, tool calls, result
    "--verbose", // stream-json needs it
    "--model", run.model,
    "--mcp-config", MCP_CONFIG_FILE_NAME, // relative: the run directory is the working directory
    "--strict-mcp-config", // use only this file; the person's own MCP servers are never loaded
    "--tools", settings.builtInTools.join(","), // "" means no built-in tools at all
    "--allowedTools", allowedToolsFor(run.kind, settings).join(","),
    "--setting-sources", "project", // the person's own settings, hooks and plugins are not loaded
    "--permission-mode", "dontAsk", // anything not allowed above is refused, never asked about
    "--max-turns", String(settings.maxTurns),
  ];
}
