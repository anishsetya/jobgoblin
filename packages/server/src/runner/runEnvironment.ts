// The environment a run (or any other `claude` command) starts with: the person's own, minus every variable
// that could move billing or redirect requests, plus the run token.
// Threat: an ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL or Bedrock/Vertex setting in the person's shell would bill a
// different account or send the run's traffic somewhere else. Runs must always use the person's Claude plan.
// Spec: ARCHITECTURE.md section 10 (step 5); tech spec "Runner" (launch step 3).
import { RUN_TOKEN_ENV_VAR } from "./runConstants";

// Matched without regard to case: on Windows `Anthropic_Api_Key` and `ANTHROPIC_API_KEY` are the same variable,
// and a copy of process.env keeps whichever spelling the person's shell used.
const REMOVED_PREFIXES = ["ANTHROPIC_", "CLAUDE_CODE_USE_"];

function startsWithRemovedPrefix(name: string): boolean {
  const upperName = name.toUpperCase();
  return REMOVED_PREFIXES.some((prefix) => upperName.startsWith(prefix));
}

// A copy of the environment without the variables above. Used for `claude --version`, `auth status` and
// the like, so the sign-in check describes exactly how a run will authenticate.
export function scrubClaudeEnvironment(processEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(processEnv)) {
    if (value === undefined || startsWithRemovedPrefix(name)) continue;
    scrubbed[name] = value;
  }
  return scrubbed;
}

export function buildRunEnvironment(processEnv: NodeJS.ProcessEnv, runToken: string): NodeJS.ProcessEnv {
  const environment = scrubClaudeEnvironment(processEnv);

  // A leftover spelling such as `jobgoblin_run_token` must not shadow the real one on Windows.
  for (const name of Object.keys(environment)) {
    if (name.toUpperCase() === RUN_TOKEN_ENV_VAR) delete environment[name];
  }
  environment[RUN_TOKEN_ENV_VAR] = runToken;
  return environment;
}
