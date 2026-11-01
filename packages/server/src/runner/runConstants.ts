// The few names every part of the runner must agree on: the MCP server's name, the environment variable that
// carries the run token, and the file names inside a run directory. One file, so a rename touches one place.
// Spec: ARCHITECTURE.md section 10 (steps 3 to 7).

// Claude Code names an MCP tool "mcp__<server>__<tool>". The server is called "jobgoblin" in mcp.json.
export const MCP_SERVER_NAME = "jobgoblin";

export function mcpToolName(tool: string): string {
  return `mcp__${MCP_SERVER_NAME}__${tool}`;
}

// The run token travels only in this variable. It is deliberately not a name Claude Code knows (it would
// blank a credential-looking variable), and mcp.json refers to it as ${JOBGOBLIN_RUN_TOKEN}.
export const RUN_TOKEN_ENV_VAR = "JOBGOBLIN_RUN_TOKEN";

// Inside <appData>/runs/<runId>/. Claude Code starts with this folder as its working directory.
export const MCP_CONFIG_FILE_NAME = "mcp.json";
export const PLAYBOOK_FILE_NAME = "PLAYBOOK.md";
export const TRANSCRIPT_FILE_NAME = "transcript.jsonl";
