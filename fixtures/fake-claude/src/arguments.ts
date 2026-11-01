// Reads the command line the runner gives the fake, with the same flags as the real `claude`.
// The runner passes the flags listed in ARCHITECTURE.md section 10 step 4; anything else is ignored with
// a note on stderr, so a new real flag never breaks a test.
// Spec: ARCHITECTURE.md sections 10 (step 4) and 14.

// What `claude -p ...` was asked to do. A flag that was not given stays null (or false, or empty).
export type PrintOptions = {
  outputFormat: string | null;
  verbose: boolean;
  model: string;
  mcpConfigPath: string | null;
  strictMcpConfig: boolean;
  tools: string[] | null; // null: --tools was not given; []: it was given as "" (no built-in tools)
  allowedTools: string[];
  settingSources: string | null;
  permissionMode: string | null;
  maxTurns: number | null;
};

export type Command =
  | { kind: "version" }
  | { kind: "auth"; action: string | null } // `claude auth status` or `claude auth login`
  | { kind: "print"; options: PrintOptions }
  | { kind: "unsupported" }; // anything else, such as starting the interactive screen

export type ParsedArguments = { command: Command; notes: string[] };

// A flag that is missing its value or has a value that makes no sense. The caller prints it and exits 2.
export class UsageError extends Error {}

// Real Claude Code would choose its own default model; the fake just needs a name for the init line.
const DEFAULT_MODEL = "sonnet";

// Flags that take exactly one value.
const SINGLE_VALUE_FLAGS = new Set([
  "--output-format",
  "--model",
  "--mcp-config",
  "--setting-sources",
  "--permission-mode",
  "--max-turns",
]);

// Flags that take a list: `--allowedTools a,b`, `--allowedTools a b`, or `--tools ""` for none.
const LIST_FLAGS = new Set(["--tools", "--allowedTools", "--allowed-tools"]);

export function parseArguments(args: readonly string[]): ParsedArguments {
  const notes: string[] = [];
  const positionals: string[] = [];
  const options = emptyPrintOptions();
  let isPrint = false;
  let wantsVersion = false;

  const queue = [...args];
  for (let token = queue.shift(); token !== undefined; token = queue.shift()) {
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }

    const { flag, inlineValue } = splitInlineValue(token);

    if (flag === "-p" || flag === "--print") isPrint = true;
    else if (flag === "--version" || flag === "-v" || flag === "-V") wantsVersion = true;
    else if (flag === "--verbose") options.verbose = true;
    else if (flag === "--strict-mcp-config") options.strictMcpConfig = true;
    else if (SINGLE_VALUE_FLAGS.has(flag)) {
      const value = inlineValue ?? takeValue(flag, queue);
      applySingleValue(options, flag, value);
    } else if (LIST_FLAGS.has(flag)) {
      const values = inlineValue === undefined ? takeList(queue) : splitList(inlineValue);
      applyList(options, flag, values);
    } else {
      notes.push(`ignoring unknown flag ${flag}`);
    }
  }

  return { command: chooseCommand({ wantsVersion, isPrint, positionals, options, notes }), notes };
}

function emptyPrintOptions(): PrintOptions {
  return {
    outputFormat: null,
    verbose: false,
    model: DEFAULT_MODEL,
    mcpConfigPath: null,
    strictMcpConfig: false,
    tools: null,
    allowedTools: [],
    settingSources: null,
    permissionMode: null,
    maxTurns: null,
  };
}

// `--max-turns=5` and `--max-turns 5` both work.
function splitInlineValue(token: string): { flag: string; inlineValue: string | undefined } {
  const equalsAt = token.indexOf("=");
  if (!token.startsWith("--") || equalsAt === -1) return { flag: token, inlineValue: undefined };
  return { flag: token.slice(0, equalsAt), inlineValue: token.slice(equalsAt + 1) };
}

function takeValue(flag: string, queue: string[]): string {
  const value = queue.shift();
  if (value === undefined) throw new UsageError(`${flag} needs a value`);
  return value;
}

// A list flag reads values until the next flag. An empty string is a value: `--tools ""` means "no tools".
function takeList(queue: string[]): string[] {
  const values: string[] = [];
  for (let next = queue[0]; next !== undefined && (next === "" || !next.startsWith("-")); next = queue[0]) {
    queue.shift();
    values.push(...splitList(next));
  }
  return values;
}

function splitList(value: string): string[] {
  return value.split(/[,\s]+/).filter((entry) => entry !== "");
}

function applySingleValue(options: PrintOptions, flag: string, value: string): void {
  if (flag === "--output-format") options.outputFormat = value;
  else if (flag === "--model") options.model = value;
  else if (flag === "--mcp-config") options.mcpConfigPath = value;
  else if (flag === "--setting-sources") options.settingSources = value;
  else if (flag === "--permission-mode") options.permissionMode = value;
  else if (flag === "--max-turns") options.maxTurns = parseMaxTurns(value);
}

function applyList(options: PrintOptions, flag: string, values: string[]): void {
  if (flag === "--tools") options.tools = values;
  else options.allowedTools.push(...values);
}

function parseMaxTurns(value: string): number {
  const turns = Number(value);
  if (!Number.isInteger(turns) || turns < 1) {
    throw new UsageError(`--max-turns needs a whole number of 1 or more, got "${value}"`);
  }
  return turns;
}

type CommandChoice = {
  wantsVersion: boolean;
  isPrint: boolean;
  positionals: string[];
  options: PrintOptions;
  notes: string[];
};

function chooseCommand(choice: CommandChoice): Command {
  if (choice.wantsVersion) return { kind: "version" };

  if (choice.isPrint) {
    // The playbook arrives on stdin (decision D6), so a prompt given as an argument is not used.
    for (const extra of choice.positionals) choice.notes.push(`ignoring the argument "${extra}"`);
    return { kind: "print", options: choice.options };
  }

  if (choice.positionals[0] === "auth") return { kind: "auth", action: choice.positionals[1] ?? null };
  return { kind: "unsupported" };
}
