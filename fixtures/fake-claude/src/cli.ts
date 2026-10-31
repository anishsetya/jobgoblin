// The fake `claude` command. The runner starts it exactly like the real one (decision D3):
//   node dist/cli.mjs -p --output-format stream-json ... < playbook      a scripted run
//   node dist/cli.mjs --version | auth status | auth login
// This file only decides which of those was asked for; the work is in printMode.ts and versionAndAuth.ts.
// Spec: ARCHITECTURE.md decision D3 and section 14.
import { parseArguments, UsageError } from "./arguments";
import { runPrintMode } from "./printMode";
import { readFakeSettings } from "./settings";
import { EXIT_USAGE, printVersion, runAuthCommand } from "./versionAndAuth";

async function main(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const { command, notes } = parseArguments(args);
  for (const note of notes) process.stderr.write(`fake-claude: ${note}\n`);

  switch (command.kind) {
    case "version":
      return printVersion();
    case "auth":
      return runAuthCommand(command.action, readFakeSettings(env));
    case "print":
      return runPrintMode(command.options, env);
    case "unsupported":
      process.stderr.write("fake-claude: only `-p`, `--version` and `auth status|login` are supported\n");
      return EXIT_USAGE;
  }
}

// Exits only after stdout and stderr are written out: when they are pipes, a write can still be
// waiting when the process ends, and the runner would lose the last lines, including `result`.
async function exitAfterFlushing(exitCode: number): Promise<void> {
  await Promise.all([flush(process.stdout), flush(process.stderr)]);
  process.exit(exitCode);
}

function flush(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => stream.write("", () => resolve()));
}

function reportProblem(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`fake-claude: ${error instanceof UsageError ? message : `stopped: ${message}`}\n`);
  return EXIT_USAGE;
}

main(process.argv.slice(2), process.env)
  .catch(reportProblem)
  .then(exitAfterFlushing);
