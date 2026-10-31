// Reads the playbook the runner pipes to `claude -p` on stdin. The fake ignores the prose; it only needs
// the two header lines that say which run kind this is and what it was started for.
// Spec: ARCHITECTURE.md decision D6 (line 1 is `<!-- run-kind: <kind> -->`, line 2 is `<!-- run-input: <RunInput JSON> -->`).
import { RunInput, RunKind } from "@jobgoblin/schemas";

export type PlaybookHeader = { kind: RunKind; input: RunInput };

// Reads all of stdin. The playbook is always read, even by a run that is about to fail on purpose: the
// runner writes it to a pipe, and a process that exits without reading would make that write fail.
export async function readStandardInput(): Promise<string> {
  if (process.stdin.isTTY) return ""; // someone ran the fake by hand; do not wait for typing
  process.stdin.setEncoding("utf8");

  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

const RUN_KIND_LINE = /^<!--\s*run-kind:\s*(\S+?)\s*-->$/;
// The JSON may itself contain "-->", so the pattern is anchored to the end of the line.
const RUN_INPUT_LINE = /^<!--\s*run-input:\s*(.*?)\s*-->$/;

export function parsePlaybookHeader(playbook: string): PlaybookHeader {
  const [firstLine = "", secondLine = ""] = playbook.split(/\r?\n/);

  const kindMatch = RUN_KIND_LINE.exec(firstLine.trim());
  const inputMatch = RUN_INPUT_LINE.exec(secondLine.trim());
  if (!kindMatch || !inputMatch) {
    throw new Error(
      "The playbook on stdin must start with a run-kind line and a run-input line (decision D6).",
    );
  }

  const kind = RunKind.parse(kindMatch[1]);
  const input = RunInput.parse(JSON.parse(inputMatch[1] ?? ""));
  return { kind, input };
}
